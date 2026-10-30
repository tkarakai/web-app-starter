/** @deprecated API namespace retained for compatibility; these are app-operator operations. */
import { LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS } from "./appOperatorAuditCompatibility";
/** Grant-compatible admin operations over the native Better Auth component; never expose credentials. */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { components } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { appOperatorMutation, authedQuery } from "./functions";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { requireAppOperator, requireAppOperatorTarget } from "./appOperatorAccess";

const userArgs = { userId: v.string() };
function userResult(user: Doc<"user">) {
  return { id: user._id, name: user.name, email: user.email, role: user.role ?? "user", emailVerified: user.emailVerified, banned: user.banned ?? false, banReason: user.banReason, banExpires: user.banExpires, twoFactorEnabled: user.twoFactorEnabled ?? false, createdAt: user.createdAt, updatedAt: user.updatedAt, image: user.image };
}
async function target(ctx: QueryCtx, userId: string) {
  return await requireAppOperatorTarget(ctx, userId);
}
async function protectedTarget(ctx: QueryCtx, userId: string) {
  const user = await target(ctx, userId);
  const emails = await ctx.runQuery(components.platform.adminEmails.list, {});
  if (emails.some(row => row.email.toLowerCase() === user.email.toLowerCase())) throw new Error("PROTECTED_ADMIN");
  return user;
}
async function deleteSessions(ctx: MutationCtx, userId: string) {
  // Component deletion is paginated. Finish every page atomically; a cap fails rather than silently truncates.
  for (let i = 0; i < 100; i++) {
    const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, { input: { model: "session", where: [{ field: "userId", value: userId }] }, paginationOpts: { cursor: null, numItems: 100 } });
    if (result.isDone) return;
  }
  throw new Error("TOO_MANY_SESSIONS");
}
export const list = authedQuery({
  args: { paginationOpts: paginationOptsValidator, search: v.optional(v.string()), searchField: v.optional(v.union(v.literal("email"), v.literal("name"))), sortBy: v.optional(v.union(v.literal("email"), v.literal("name"), v.literal("createdAt"))), sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))), role: v.optional(v.union(v.literal("user"), v.literal("admin"))), status: v.optional(v.union(v.literal("active"), v.literal("banned"))), emailVerified: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await requireAppOperator(ctx);
    if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100) throw new Error("INVALID_PAGE_SIZE");
    if (args.role === "user") return { page: [], isDone: true, continueCursor: "" };
    // Name/email index cursors can contain identities excluded by the canonical check below.
    if (args.sortBy && args.sortBy !== "createdAt") throw new Error("UNSUPPORTED_OPERATOR_SORT");
    return ctx.runQuery(components.betterAuth.appOperators.listDirectory, {
      operatorId: actor.user._id, paginationOpts: args.paginationOpts,
      search: args.search, searchField: args.searchField, sortDirection: args.sortDirection,
      status: args.status, emailVerified: args.emailVerified,
    });
  },
});
export const get = authedQuery({ args: userArgs, handler: async (ctx, { userId }) => { await requireAppOperator(ctx); return userResult(await target(ctx, userId)); } });
export const ban = appOperatorMutation({
  args: { ...userArgs, reason: v.optional(v.string()), expiresInSeconds: v.optional(v.number()) }, handler: async (ctx, args) => {
    const actor = await requireAppOperator(ctx, { write: true });
    const user = await protectedTarget(ctx, args.userId);
    if (args.userId === ctx.user._id) throw new Error("CANNOT_BAN_SELF");
    if (args.reason && args.reason.length > 1000 || args.expiresInSeconds !== undefined && (!Number.isFinite(args.expiresInSeconds) || args.expiresInSeconds <= 0 || args.expiresInSeconds > 31_536_000)) throw new Error("INVALID_BAN");
    await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: user._id }], update: { banned: true, banReason: args.reason ?? null, banExpires: args.expiresInSeconds ? Date.now() + args.expiresInSeconds * 1000 : null, updatedAt: Date.now() } } });
    await deleteSessions(ctx, user._id);
    await scheduleAuditEvent(ctx, { actor: actor.user.email, authenticatedUserId: actor.user._id, sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.identityAdministration, action: "admin.user.banned", resource: `user:${user._id}`, status: "succeeded", reason: args.reason });
  },
});
export const unban = appOperatorMutation({ args: userArgs, handler: async (ctx, { userId }) => {
  const actor = await requireAppOperator(ctx, { write: true });
  await target(ctx, userId);
  await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: userId }], update: { banned: false, banReason: null, banExpires: null, updatedAt: Date.now() } } });
  await scheduleAuditEvent(ctx, { actor: actor.user.email, authenticatedUserId: actor.user._id, sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.identityAdministration, action: "admin.user.unbanned", resource: `user:${userId}`, status: "succeeded" });
} });
export const setRole = appOperatorMutation({ args: { ...userArgs, role: v.union(v.literal("user"), v.literal("admin")) }, handler: async (ctx, { userId, role }) => {
  await requireAppOperator(ctx, { write: true });
  await target(ctx, userId);
  if (role !== "admin") throw new Error("OPERATOR_ROLE_TRANSITION_UNSUPPORTED");
  // The only supported value already holds. App-operator onboarding is the exclusive grant path.
} });
export const update = appOperatorMutation({ args: { ...userArgs, name: v.string(), image: v.optional(v.union(v.string(), v.null())) }, handler: async (ctx, { userId, name, image }) => {
  const actor = await requireAppOperator(ctx, { write: true });
  await target(ctx, userId);
  if (!name.trim() || name.length > 200 || image && image.length > 2000) throw new Error("INVALID_PROFILE");
  await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: userId }], update: { name: name.trim(), ...(image !== undefined ? { image } : {}), updatedAt: Date.now() } } });
  await scheduleAuditEvent(ctx, { actor: actor.user.email, authenticatedUserId: actor.user._id, sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.identityAdministration, action: "user.profile_updated", resource: `user:${userId}`, status: "succeeded" });
} });
export const remove = appOperatorMutation({ args: userArgs, handler: async (ctx, { userId }) => {
  await requireAppOperator(ctx, { write: true });
  await protectedTarget(ctx, userId);
  if (userId === ctx.user._id) throw new Error("CANNOT_DELETE_SELF");
  // App-owned tables may refer to this identity (including legacy private app-operator data).
  // No reviewed deletion/ownership mapping exists yet; retain identity, factors and references.
  throw new Error("OPERATOR_DELETION_REQUIRES_REVIEWED_MAPPING");
} });
export const sessions = authedQuery({ args: { ...userArgs, paginationOpts: paginationOptsValidator }, handler: async (ctx, { userId, paginationOpts }) => {
  await requireAppOperator(ctx);
  if (!Number.isInteger(paginationOpts.numItems) || paginationOpts.numItems < 1 || paginationOpts.numItems > 100) throw new Error("INVALID_PAGE_SIZE");
  await target(ctx, userId);
  const rows = await ctx.runQuery(components.betterAuth.adapter.findMany, { model: "session", where: [{ field: "userId", value: userId }], paginationOpts });
  return { ...rows, page: rows.page.map((row: Doc<"session">) => ({ id: row._id, userId: row.userId, createdAt: row.createdAt, expiresAt: row.expiresAt, ipAddress: row.ipAddress, userAgent: row.userAgent })) };
} });
export const revokeSession = appOperatorMutation({ args: { ...userArgs, sessionId: v.string() }, handler: async (ctx, { userId, sessionId }) => {
  const actor = await requireAppOperator(ctx, { write: true });
  await target(ctx, userId);
  const row = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "_id", value: sessionId }] });
  if (!row || row.userId !== userId) throw new Error("SESSION_NOT_FOUND");
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: sessionId }] } });
  await scheduleAuditEvent(ctx, { actor: actor.user.email, authenticatedUserId: actor.user._id, sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.identityAdministration, action: "admin.session.revoked", resource: `session:${sessionId}`, status: "succeeded" });
} });
export const revokeSessions = appOperatorMutation({ args: userArgs, handler: async (ctx, { userId }) => {
  const actor = await requireAppOperator(ctx, { write: true });
  await target(ctx, userId); await deleteSessions(ctx, userId);
  await scheduleAuditEvent(ctx, { actor: actor.user.email, authenticatedUserId: actor.user._id, sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.identityAdministration, action: "admin.session.revoked_all", resource: `user:${userId}`, status: "succeeded" });
} });
