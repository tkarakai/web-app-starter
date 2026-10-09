import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { nativeDefinition, nativeOperation } from "./nativeCapabilities";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { components } from "../_generated/api";
import { requireGrantById } from "./agentAccess";
import { authorizedSession } from "./sessionPolicy";
import { operationExposure, LEGACY_APP_OPERATOR_EXPOSURE } from "./agentExposure";
import { requireAppOperator, requireAppOperatorTarget } from "./appOperatorAccess";
import { filterAppOperatorEmails } from "./appOperatorDirectory";
import { ownedTask } from "./agentTaskModel";

/** Resolve current persisted authority, never an injected user/assurance/ownerId snapshot. */
export async function canonicalAppOperatorAuth(ctx: QueryCtx, supplied: unknown, recent = false) {
  const source = supplied as { user?: { _id?: string }; grantId?: Id<"agentGrants">; resource?: string } | null;
  const auth = source?.grantId && typeof source.resource === "string"
    ? await requireGrantById(ctx, source.grantId, source.resource, recent)
    : await authorizedSession(ctx);
  if (!auth || auth.user.role !== "admin" || auth.user._id !== source?.user?._id) throw new Error("NOT_ADMIN");
  return { ...auth, ...await requireAppOperator({ ...ctx, ...auth }, { write: recent }) };
}

/** Independent of Convex builders: invokeNative executes their captured bodies. */
export async function authorizeNativeOperation(ctx: QueryCtx, supplied: unknown, operation: string, input: unknown, write: boolean) {
  const policy = operationExposure(operation);
  if (!policy.native || ![LEGACY_APP_OPERATOR_EXPOSURE.control, LEGACY_APP_OPERATOR_EXPOSURE.identity, "self-service"].includes(policy.classification)) throw new Error("NATIVE_OPERATION_DENIED");
  const auth = await canonicalAppOperatorAuth(ctx, supplied, write);
  const args = input as Record<string, unknown>;
  if (policy.target === LEGACY_APP_OPERATOR_EXPOSURE.directory && args.role !== undefined && args.role !== "admin") throw new Error("OPERATOR_TARGET_REQUIRED");
  if (policy.target === LEGACY_APP_OPERATOR_EXPOSURE.principal) {
    if (typeof args.userId !== "string") throw new Error("OPERATOR_TARGET_REQUIRED");
    await requireAppOperatorTarget(ctx, args.userId);
    if (operation === "platform/agentUsers:setRole" && args.role !== "admin") throw new Error("OPERATOR_ROLE_TRANSITION_UNSUPPORTED");
  }
  if (policy.target === "organization" && operation !== "platform/organizations:list") {
    if (typeof args.organizationId !== "string" || !args.organizationId) throw new Error("ORGANIZATION_UNAVAILABLE");
    await ctx.runQuery(components.betterAuth.organizations.contacts, { organizationId: args.organizationId, operatorId: auth.user._id });
    // The exact validated immutable ID is passed unchanged to the parent wrapper. Its body
    // resolves the same projection/organization availability; component primitives are not native capabilities.
  }
  if (policy.target === "self") {
    if (operation === "platform/agentAccess:revoke") {
      const grant = await ctx.db.get(args.grantId as Id<"agentGrants">);
      if (!grant || grant.userId !== auth.user._id) throw new Error("GRANT_NOT_FOUND");
    }
    if (operation === "platform/agentTaskAdmin:get" || operation === "platform/agentTaskAdmin:cancel") await ownedTask(ctx, auth.user._id, args.taskId as string);
    if (operation === "platform/agentRegistry:renamePasskey" || operation === "platform/agentRegistry:removePasskey") {
      const key = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "passkey", where: [{ field: "_id", value: args.passkeyId as string }] });
      if (!key || key.userId !== auth.user._id) throw new Error("PASSKEY_NOT_FOUND");
    }
  }
  if (operation === "platform/adminAuth:listAdminPasskeyUserIds") {
    if (!Array.isArray(args.userIds)) throw new Error("OPERATOR_TARGET_REQUIRED");
    for (const userId of args.userIds) {
      if (typeof userId !== "string") throw new Error("OPERATOR_TARGET_REQUIRED");
      await requireAppOperatorTarget(ctx, userId);
    }
  }
  return auth;
}

/** Output projection is also enforced inside invokeNative, not only by transport adapters. */
export async function projectNativeResult(ctx: QueryCtx, operation: string, result: unknown) {
  if (operationExposure(operation).target === LEGACY_APP_OPERATOR_EXPOSURE.emailDirectory) {
    if (!Array.isArray(result)) throw new Error("NATIVE_RESULT_DENIED");
    return filterAppOperatorEmails(ctx, result.filter((email): email is string => typeof email === "string"), true);
  }
  if (operation === "platform/waitlistTokens:listByEntry" && Array.isArray(result)) {
    return result.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([key]) => key !== "tokenHash")));
  }
  return result;
}

/** @deprecated Use canonicalAppOperatorAuth. */
export const canonicalOperatorAuth = canonicalAppOperatorAuth;

/** Keep policy execution separate from builder capture to avoid initialization cycles. */
export async function invokeNative(registered: object, ctx: QueryCtx | MutationCtx, auth: unknown, input: unknown) {
  const definition = nativeDefinition(registered);
  validate(v.object(definition.args), input, { throw: true, db: ctx.db });
  const operation = nativeOperation(registered);
  const canonical = await authorizeNativeOperation(ctx, auth, operation, input, definition.kind === "mutation");
  const bounded = operationExposure(operation).target === LEGACY_APP_OPERATOR_EXPOSURE.directory ? { ...(input as Record<string, unknown>), role: "admin" } : input;
  return projectNativeResult(ctx, operation, await definition.handler({ ...ctx, ...canonical }, bounded));
}
