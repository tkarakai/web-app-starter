import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { components } from "../_generated/api";
import { requireGrantById } from "./agentAccess";
import { authorizedSession } from "./sessionPolicy";
import { operationExposure } from "./agentExposure";
import { isOperatorIdentity, requireOperator, requireOperatorTarget } from "./operatorAccess";
import { ownedTask } from "./agentTaskModel";

/** Resolve current persisted authority, never an injected user/assurance/ownerId snapshot. */
export async function canonicalOperatorAuth(ctx: QueryCtx, supplied: unknown, recent = false) {
  const source = supplied as { user?: { _id?: string }; grantId?: Id<"agentGrants">; resource?: string } | null;
  const auth = source?.grantId && typeof source.resource === "string"
    ? await requireGrantById(ctx, source.grantId, source.resource, recent)
    : await authorizedSession(ctx);
  if (!auth || auth.user.role !== "admin" || auth.user._id !== source?.user?._id) throw new Error("NOT_ADMIN");
  return { ...auth, ...await requireOperator({ ...ctx, ...auth }, { write: recent }) };
}

/** Independent of Convex builders: invokeNative executes their captured bodies. */
export async function authorizeNativeOperation(ctx: QueryCtx, supplied: unknown, operation: string, input: unknown, write: boolean) {
  const policy = operationExposure(operation);
  if (!policy.native || !["operator-control", "operator-identity", "self-service"].includes(policy.classification)) throw new Error("NATIVE_OPERATION_DENIED");
  const auth = await canonicalOperatorAuth(ctx, supplied, write);
  const args = input as Record<string, unknown>;
  if (policy.target === "operator-list" && args.role !== undefined && args.role !== "admin") throw new Error("OPERATOR_TARGET_REQUIRED");
  if (policy.target === "operator") {
    if (typeof args.userId !== "string") throw new Error("OPERATOR_TARGET_REQUIRED");
    await requireOperatorTarget(ctx, args.userId);
    if (operation === "platform/agentUsers:setRole" && args.role !== "admin") throw new Error("OPERATOR_ROLE_TRANSITION_UNSUPPORTED");
  }
  if (policy.target === "organization" && operation !== "platform/organizations:list") {
    if (typeof args.organizationId !== "string" || !args.organizationId) throw new Error("ORGANIZATION_UNAVAILABLE");
    await ctx.runQuery(components.betterAuth.organizations.contacts, { organizationId: args.organizationId, operatorId: auth.user._id });
    // The exact validated immutable ID is passed unchanged to the parent wrapper. Its body
    // resolves the same projection/lifecycle; component primitives are not native capabilities.
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
      await requireOperatorTarget(ctx, userId);
    }
  }
  return auth;
}

/** Output projection is also enforced inside invokeNative, not only by transport adapters. */
export async function projectNativeResult(ctx: QueryCtx, operation: string, result: unknown) {
  if (operationExposure(operation).target === "operator-email-list") {
    if (!Array.isArray(result)) throw new Error("NATIVE_RESULT_DENIED");
    const emails: string[] = [];
    for (const email of result) {
      if (typeof email !== "string") continue;
      const user = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email.toLowerCase() }] });
      if (user && await isOperatorIdentity(ctx, user)) emails.push(email);
    }
    return emails;
  }
  if (operation === "platform/waitlistTokens:listByEntry" && Array.isArray(result)) {
    return result.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([key]) => key !== "tokenHash")));
  }
  return result;
}
