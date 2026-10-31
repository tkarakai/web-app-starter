import { rememberNative, captureNativeBuilder } from "./nativeCapabilities";
import { components } from "../_generated/api";
import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import { v, type ObjectType, type PropertyValidators } from "convex/values";

import { authorizedSession } from "./sessionPolicy";
import { ensurePersonalOrganization, resolveActiveOrganization, type ActiveOrganization } from "./organizationAccess";
import { rateLimit } from "./rateLimits";
import {
  LEGACY_EMAIL_VERIFICATION_REQUIRED_KEY,
  getEmailVerificationRequiredKey,
  getPolicyScopeFromRole,
} from "./securityPolicies";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, mutation, query } from "../_generated/server";

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
 * `getAuth` plus the caller's active organization, for functions that can't use
 * `orgQuery`/`orgMutation` (internal functions called from an action). `null` when the
 * caller is not authenticated or belongs to no organization.
 */
export async function getOrgAuth(ctx: QueryCtx): Promise<(AuthInfo & ActiveOrganization) | null> {
  const auth = await getAuth(ctx);
  if (!auth) return null;
  const organization = await resolveActiveOrganization(ctx, auth.user, auth.session);
  return organization ? { ...auth, ...organization } : null;
}

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

/**
 * Organization-scoped query builder: use it for every read of app data.
 * Handlers receive `ctx.organizationId` and `ctx.organizationRole` (the caller's active
 * organization, membership re-checked on every call) as well as `ctx.user` and `ctx.ownerId`.
 * Returns `null` when the caller is not authenticated or belongs to no organization.
 * Filter every read by `ctx.organizationId`; never accept an organization ID as an argument.
 */
export function orgQuery<
  ArgsValidator extends PropertyValidators,
  Output,
>(func: {
  args: ArgsValidator;
  handler: (
    ctx: QueryCtx & AuthInfo & ActiveOrganization,
    args: ObjectType<ArgsValidator>,
  ) => Output | Promise<Output>;
}) {
  // Deliberately not registered as a native capability: agent surfaces would bypass the
  // organization resolution below.
  return query({
    args: func.args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: async (ctx: QueryCtx, args: any): Promise<Output | null> => {
      const auth = await getOrgAuth(ctx);
      if (!auth) return null;
      return func.handler({ ...ctx, ...auth }, args);
    },
  });
}

/**
 * Organization-scoped mutation builder: use it for every write of app data.
 * Like `authedMutation`, plus `ctx.organizationId` and `ctx.organizationRole`. Stamp new
 * rows with `ctx.organizationId`. A user who belongs to no organization (only possible
 * while an upgrade migrates, or after leaving every organization) gets a personal one.
 */
export const orgMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const auth = await getAuth(ctx);
    if (!auth) throw new Error("NOT_AUTHENTICATED");

    await rateLimit(ctx, {
      name: "mutationGlobal",
      key: auth.ownerId,
      throws: true,
    });

    const organization = await resolveActiveOrganization(ctx, auth.user, auth.session)
      ?? await ensurePersonalOrganization(ctx, auth.user);
    return { ...auth, ...organization };
  }),
);

/**
 * Builds the app's cleanup for a deleted organization. Export it as `deleteOrganizationData`
 * from `convex/organizationData.ts`; the platform runs it after an owner deletes an
 * organization. Each call deletes one batch of the organization's rows and returns `true`
 * once none are left; the platform calls it again until then. Without it, a deleted
 * organization's rows stay in the database, unreachable. See platform/docs/organizations.md.
 */
export function organizationDataCleanup(deleteBatch: (ctx: MutationCtx, organizationId: string) => Promise<boolean>) {
  return internalMutation({
    args: { organizationId: v.string() },
    returns: v.object({ done: v.boolean() }),
    handler: async (ctx, args) => ({ done: await deleteBatch(ctx, args.organizationId) }),
  });
}

/** Administrative writes additionally require recent authentication under current policy. */
export const adminMutation = captureNativeBuilder(customMutation(
  mutation,
  customCtx(async ctx => {
    const auth = await getAuth(ctx);
    if (!auth) throw new Error("NOT_AUTHENTICATED");
    if (getPolicyScopeFromRole(auth.user.role) !== "admin") throw new Error("NOT_ADMIN");
    if (!auth.assurance.recent) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
    await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
    return auth;
  }),
), "mutation");

export { MAX_NAME_LENGTH, MAX_DESCRIPTION_LENGTH, assertMaxLength } from "@web-app-starter/convex-platform/validation";
