import { rememberNative, captureNativeBuilder } from "./nativeCapabilities";
import { components } from "../_generated/api";
import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import type { ObjectType, PropertyValidators } from "convex/values";

import { authorizedSession } from "./sessionPolicy";
import { isAppOperatorIdentity } from "./appOperatorIdentity";
import { rateLimit } from "./rateLimits";
import {
  LEGACY_EMAIL_VERIFICATION_REQUIRED_KEY,
  getEmailVerificationRequiredKey,
  getPolicyScopeFromRole,
} from "./securityPolicies";
import type { QueryCtx } from "../_generated/server";
import { mutation, query } from "../_generated/server";

async function getBooleanSetting(
  ctx: QueryCtx,
  key: string,
  defaultValue: boolean,
): Promise<boolean> {
  const setting = await ctx.runQuery(components.platform.appSettings.getRaw, { key: key });

  if (!setting) return defaultValue;

  try {
    return JSON.parse(setting.value) === true;
  } catch {
    return defaultValue;
  }
}

export async function isEmailVerificationRequired(
  ctx: QueryCtx,
  user: Record<string, unknown>,
): Promise<boolean> {
  const scope = getPolicyScopeFromRole(user.role);
  const scopedKey = getEmailVerificationRequiredKey(scope);
  const scoped = await ctx.runQuery(components.platform.appSettings.getRaw, { key: scopedKey });

  if (scoped) {
    try {
      return JSON.parse(scoped.value) === true;
    } catch {
      return true;
    }
  }

  return await getBooleanSetting(ctx, LEGACY_EMAIL_VERIFICATION_REQUIRED_KEY, true);
}

/**
 * Resolve the authenticated user without throwing.
 * Applies the live session policy and derives the canonical `ownerId`.
 */
export async function getAuth(ctx: QueryCtx) {
  return await authorizedSession(ctx);
}

type AuthInfo = NonNullable<Awaited<ReturnType<typeof getAuth>>>;

/**
 * Authenticated query builder.
 * Handlers receive `ctx.user` and `ctx.ownerId` automatically.
 * Returns `null` when the caller is not authenticated — safe for
 * reactive `useQuery` subscriptions (no thrown errors to crash the UI).
 */
export function authedQuery<
  ArgsValidator extends PropertyValidators,
  Output,
>(func: {
  args: ArgsValidator;
  handler: (
    ctx: QueryCtx & AuthInfo,
    args: ObjectType<ArgsValidator>,
  ) => Output | Promise<Output>;
}) {
  return rememberNative(query({
    args: func.args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: async (ctx: QueryCtx, args: any): Promise<Output | null> => {
      const auth = await getAuth(ctx);
      if (!auth) return null;
      return func.handler({ ...ctx, ...auth }, args);
    },
  }), func, "query");
}

/** App-operator control reads retain signed-out null semantics, but require canonical app-operator authority. */
export function appOperatorQuery<ArgsValidator extends PropertyValidators, Output>(func: {
  args: ArgsValidator;
  handler: (ctx: QueryCtx & AuthInfo, args: ObjectType<ArgsValidator>) => Output | Promise<Output>;
}) {
  return rememberNative(query({
    args: func.args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: async (ctx: QueryCtx, args: any): Promise<Output | null> => {
      const auth = await getAuth(ctx);
      if (!auth) return null;
      if (!await isAppOperatorIdentity(ctx, auth.user)) throw new Error("NOT_ADMIN");
      return func.handler({ ...ctx, ...auth }, args);
    },
  }), func, "query");
}

/**
 * Authenticated mutation builder.
 * Handlers receive `ctx.user` and `ctx.ownerId` automatically.
 * Throws if the caller is not authenticated.
 * Enforces a global per-user rate limit on all mutations.
 */
export const authedMutation = captureNativeBuilder(customMutation(
  mutation,
  customCtx(async (ctx) => {
    const auth = await getAuth(ctx);
    if (!auth) throw new Error("NOT_AUTHENTICATED");

    await rateLimit(ctx, {
      name: "mutationGlobal",
      key: auth.ownerId,
      throws: true,
    });

    return auth;
  }),
), "mutation");

/** App-operator writes additionally require recent authentication under current policy. */
export const appOperatorMutation = captureNativeBuilder(customMutation(
  mutation,
  customCtx(async ctx => {
    const auth = await getAuth(ctx);
    if (!auth) throw new Error("NOT_AUTHENTICATED");
    if (!await isAppOperatorIdentity(ctx, auth.user)) throw new Error("NOT_ADMIN");
    if (!auth.assurance.recent) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
    await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
    return auth;
  }),
), "mutation");

export { MAX_NAME_LENGTH, MAX_DESCRIPTION_LENGTH, assertMaxLength } from "@web-app-starter/convex-platform/validation";

/** @deprecated Use appOperatorQuery for app-control-plane reads. */
export const adminQuery = appOperatorQuery;
/** @deprecated Use appOperatorMutation for app-control-plane writes. */
export const adminMutation = appOperatorMutation;
