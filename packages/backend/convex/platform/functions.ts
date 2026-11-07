import { rememberNative, captureNativeBuilder } from "./nativeCapabilities";
import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import { v, type ObjectType, type PropertyValidators } from "convex/values";

import { authorizedSession, emailVerificationRequired } from "./sessionPolicy";
import { resolveActiveOrganization, resolveOrganizationSelection, type ActiveOrganization } from "./organizationAccess";
import { appBlocker } from "./billingAccess";
import { rateLimit } from "./rateLimits";
import { getPolicyScopeFromRole } from "./securityPolicies";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, mutation, query } from "../_generated/server";

/**
 * Whether email verification is required for this user's platform role. The same reader the
 * session policy enforces with: unset falls back to the legacy key, then `true`; any value other
 * than `false` counts as required.
 */
export async function isEmailVerificationRequired(
  ctx: QueryCtx,
  user: Record<string, unknown>,
): Promise<boolean> {
  return await emailVerificationRequired(ctx, user.role);
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
 * The organization a write goes to: the session's selected organization. When the selection is
 * no longer a live membership (the caller was removed, or it was deleted), the write is refused
 * with `ORGANIZATION_CHANGED` rather than sent to another organization; only a session that
 * never selected one starts in the oldest membership. `NO_ORGANIZATION` without any.
 */
async function writeOrganization(ctx: QueryCtx, auth: AuthInfo): Promise<ActiveOrganization> {
  const selection = await resolveOrganizationSelection(ctx, auth.user, auth.session);
  if (!selection.active) throw new Error("NO_ORGANIZATION");
  if (selection.stale) throw new Error("ORGANIZATION_CHANGED");
  return selection.active;
}

/**
 * `getAuth` plus the caller's active organization, for functions that can't use
 * `orgQuery`/`orgMutation` (internal functions called from an action). `null` when the
 * caller is not authenticated, is a platform administrator (administrators don't use app
 * data), or belongs to no organization. Pass `{ write: true }` from a function that writes:
 * it then follows `orgMutation`'s rule and throws `ORGANIZATION_CHANGED` for a stale selection.
 */
export async function getOrgAuth(ctx: QueryCtx, options: { write?: boolean } = {}): Promise<(AuthInfo & ActiveOrganization) | null> {
  const auth = await getAuth(ctx);
  if (!auth || getPolicyScopeFromRole(auth.user.role) === "admin") return null;
  // A scheduled deletion or a plan still to choose keeps the app closed (billingAccess.ts).
  if (await appBlocker(ctx, auth.user._id)) return null;
  if (options.write) {
    const selection = await resolveOrganizationSelection(ctx, auth.user, auth.session);
    if (!selection.active) return null;
    if (selection.stale) throw new Error("ORGANIZATION_CHANGED");
    return { ...auth, ...selection.active };
  }
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
 * Returns `null` when the caller is not authenticated, is a platform administrator, or belongs
 * to no organization. Filter every read by `ctx.organizationId`; never accept an organization ID as an argument.
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
 * rows with `ctx.organizationId`. A signed-in user with no membership gets
 * `NO_ORGANIZATION`, a platform administrator `NOT_APPLICATION_USER`; ordinary app operations
 * never create an organization.
 *
 * Every function built with it also takes an optional `expectedOrganizationId`: the
 * organization the caller's UI showed when the write was composed. When the active
 * organization has changed since (the caller was removed, the organization deleted, another
 * tab switched), the write is refused with `ORGANIZATION_CHANGED` instead of landing where
 * other people can see it. It is a precondition only, never the organization written to.
 * Pass it on every write that doesn't name an existing record (creates); a record ID already
 * pins the organization through its access check.
 */
export const orgMutation = customMutation(mutation, {
  args: { expectedOrganizationId: v.optional(v.string()) },
  input: async (ctx, { expectedOrganizationId }) => {
    const auth = await getAuth(ctx);
    if (!auth) throw new Error("NOT_AUTHENTICATED");
    // Platform administrators manage organizations in the admin app; they don't use app data.
    if (getPolicyScopeFromRole(auth.user.role) === "admin") throw new Error("NOT_APPLICATION_USER");

    await rateLimit(ctx, {
      name: "mutationGlobal",
      key: auth.ownerId,
      throws: true,
    });

    const blocker = await appBlocker(ctx, auth.user._id);
    if (blocker) throw new Error(blocker);
    const organization = await writeOrganization(ctx, auth);
    if (expectedOrganizationId !== undefined && expectedOrganizationId !== organization.organizationId) {
      throw new Error("ORGANIZATION_CHANGED");
    }
    return { ctx: { ...auth, ...organization }, args: {} };
  },
});

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
