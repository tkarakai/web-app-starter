/** Grant-compatible admin operations over the native Better Auth component; never expose credentials. */
import { v } from "convex/values";
import { createFunctionHandle, paginationOptsValidator } from "convex/server";
import { components, internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { adminMutation, authedQuery } from "./functions";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { findMembership } from "./organizationAccess";
import { beginUserDeletion, finishUserDeletion } from "./userDeletion";
import { promoteToOwner } from "./adminOrganizations";
import { canAct, ownersNeededForReactivation, setMemberRole, successorRequiredMessage, successorsNeededForBan } from "./organizationOwnership";

const userArgs = { userId: v.string() };
function userResult(user: Doc<"user">) {
  return { id: user._id, name: user.name, email: user.email, role: user.role ?? "user", emailVerified: user.emailVerified, banned: user.banned ?? false, banReason: user.banReason, banExpires: user.banExpires, twoFactorEnabled: user.twoFactorEnabled ?? false, createdAt: user.createdAt, updatedAt: user.updatedAt, image: user.image };
}
async function target(ctx: QueryCtx, userId: string) {
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: userId }] }) as Doc<"user"> | null;
  if (!user) throw new Error("USER_NOT_FOUND");
  return user;
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
/** A user write through the ownership trigger (`userTriggers`), so it commits only with an owner kept. */
async function updateUser(ctx: MutationCtx, userId: string, update: Record<string, unknown>) {
  await ctx.runMutation(components.betterAuth.adapter.updateOne, {
    input: { model: "user", where: [{ field: "_id", value: userId }], update: { ...update, updatedAt: Date.now() } },
    onUpdateHandle: await createFunctionHandle(internal.platform.authTriggers.onUpdate),
  });
}

const successorsArg = v.optional(v.array(v.object({ organizationId: v.string(), userId: v.string() })));
type Successor = { organizationId: string; userId: string };

/** At most one successor per organization, never the user losing the ability to act, and only where one is needed. */
function checkSuccessors(successors: Successor[], userId: string, needed: { organizationId: string; candidates?: { userId: string }[] }[], allowSelf = false) {
  const organizations = new Set(successors.map((s) => s.organizationId));
  if (successors.length > 50 || organizations.size !== successors.length) throw new Error("INVALID_SUCCESSOR");
  for (const successor of successors) {
    if (!allowSelf && successor.userId === userId) throw new Error("INVALID_SUCCESSOR");
    const need = needed.find((n) => n.organizationId === successor.organizationId);
    if (!need) throw new Error("INVALID_SUCCESSOR");
    if (need.candidates && !need.candidates.some((c) => c.userId === successor.userId)) throw new Error("INVALID_SUCCESSOR");
  }
}

/**
 * Before a user stops being able to act (banned, or made an administrator): make the named
 * successors owners where this user is the only owner who can act. With any organization left
 * uncovered, refuse; the user trigger would anyway, in the same transaction.
 */
async function handOver(ctx: Parameters<typeof promoteToOwner>[0], userId: string, successors: Successor[], meta: Record<string, string>, change: string) {
  checkSuccessors(successors, userId, await successorsNeededForBan(ctx, userId));
  for (const successor of successors) {
    await promoteToOwner(ctx, successor.organizationId, successor.userId, meta);
  }
  const uncovered = await successorsNeededForBan(ctx, userId);
  if (uncovered.length > 0) throw new Error(successorRequiredMessage(uncovered, change));
}

/**
 * Before a user can act again (unbanned, or no longer an administrator): where their
 * organizations' owners are all banned, make the named successors owners. The successor may be
 * this user. With any organization left uncovered, refuse.
 */
async function takeOver(ctx: Parameters<typeof promoteToOwner>[0], userId: string, successors: Successor[], change: string) {
  checkSuccessors(successors, userId, await ownersNeededForReactivation(ctx, userId, true), true);
  for (const successor of successors) {
    if (successor.userId === userId) {
      const member = await findMembership(ctx, userId, successor.organizationId);
      if (!member) throw new Error("INVALID_SUCCESSOR");
      await setMemberRole(ctx, member._id, "owner");
    } else {
      await promoteToOwner(ctx, successor.organizationId, successor.userId, { reason: "reactivation_successor", reactivatedUserId: userId });
    }
  }
  const uncovered = await ownersNeededForReactivation(ctx, userId, true);
  if (uncovered.length > 0) throw new Error(successorRequiredMessage(uncovered, change));
}

export const list = authedQuery({
  args: { paginationOpts: paginationOptsValidator, search: v.optional(v.string()), searchField: v.optional(v.union(v.literal("email"), v.literal("name"))), sortBy: v.optional(v.union(v.literal("email"), v.literal("name"), v.literal("createdAt"))), sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))), role: v.optional(v.union(v.literal("user"), v.literal("admin"))), status: v.optional(v.union(v.literal("active"), v.literal("banned"))), emailVerified: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN");
    if (args.paginationOpts.numItems > 100) throw new Error("INVALID_PAGE_SIZE");
    const where: { field: "email" | "name" | "role" | "banned" | "emailVerified"; operator: "contains" | "eq" | "ne"; value: string | boolean }[] = [];
    if (args.search) where.push({ field: args.searchField ?? "email", operator: "contains", value: args.searchField === "name" ? args.search : args.search.toLowerCase() });
    if (args.role) where.push({ field: "role", operator: "eq", value: args.role });
    if (args.status) where.push({ field: "banned", operator: args.status === "banned" ? "eq" : "ne", value: true });
    if (args.emailVerified !== undefined) where.push({ field: "emailVerified", operator: "eq", value: args.emailVerified });
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, { model: "user", paginationOpts: args.paginationOpts, where, sortBy: { field: args.sortBy ?? "createdAt", direction: args.sortDirection ?? "desc" } });
    return { ...result, page: result.page.map((user: Doc<"user">) => userResult(user as Doc<"user">)) };
  },
});
export const get = authedQuery({ args: userArgs, handler: async (ctx, { userId }) => { if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN"); return userResult(await target(ctx, userId)); } });
/**
 * Ban a user. Every organization with members who can act must keep an owner who can: where
 * this user is that only owner, name a successor in `successors` (see
 * `organizations_forUser`'s `banSuccessor`), one per such organization and only for those.
 * Successors are made owners and the user banned in one transaction; with any organization left
 * uncovered, or a successor that isn't needed or isn't a candidate, nothing changes. The admin
 * app's ban dialog uses this too.
 */
export const ban = adminMutation({
  args: {
    ...userArgs, reason: v.optional(v.string()), expiresInSeconds: v.optional(v.number()),
    successors: successorsArg,
  }, handler: async (ctx, args) => {
    const user = await protectedTarget(ctx, args.userId);
    if (args.userId === ctx.user._id) throw new Error("CANNOT_BAN_SELF");
    if (args.reason && args.reason.length > 1000 || args.expiresInSeconds !== undefined && (!Number.isFinite(args.expiresInSeconds) || args.expiresInSeconds <= 0 || args.expiresInSeconds > 31_536_000)) throw new Error("INVALID_BAN");
    await handOver(ctx, args.userId, args.successors ?? [], { reason: "ban_successor", bannedUserId: args.userId }, "banning");
    await updateUser(ctx, user._id, { banned: true, banReason: args.reason ?? null, banExpires: args.expiresInSeconds ? Date.now() + args.expiresInSeconds * 1000 : null });
    await deleteSessions(ctx, user._id);
    await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: "agent-users", action: "admin.user.banned", resource: `user:${user._id}`, status: "succeeded", reason: args.reason });
  },
});
/**
 * Unban a user. Where all of an organization's owners are banned, the user can act there again
 * only with a new owner: name one in `successors` (the user themself is allowed). Otherwise
 * refused with `OWNER_SUCCESSOR_REQUIRED`, naming the organizations; unbanning one of their
 * owners first also works.
 */
export const unban = adminMutation({ args: { ...userArgs, successors: successorsArg }, handler: async (ctx, { userId, successors }) => {
  const user = await target(ctx, userId);
  if (!canAct(user) && canAct({ ...user, banned: false, banExpires: null })) await takeOver(ctx, userId, successors ?? [], "unbanning");
  else if ((successors?.length ?? 0) > 0) throw new Error("INVALID_SUCCESSOR");
  await updateUser(ctx, userId, { banned: false, banReason: null, banExpires: null });
  await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: "agent-users", action: "admin.user.unbanned", resource: `user:${userId}`, status: "succeeded" });
} });
/**
 * Change a user's platform role. Administrators can't act in organizations, so making the only
 * owner who can act in an organization an administrator needs `successors`, as a ban does; the
 * reverse needs them where that organization's owners are all banned.
 */
export const setRole = adminMutation({ args: { ...userArgs, role: v.union(v.literal("user"), v.literal("admin")), successors: successorsArg }, handler: async (ctx, { userId, role, successors }) => {
  const user = await protectedTarget(ctx, userId);
  const before = canAct(user);
  const after = canAct({ ...user, role });
  if (before && !after) await handOver(ctx, userId, successors ?? [], { reason: "role_successor", promotedUserId: userId }, "making an administrator of");
  else if (!before && after) await takeOver(ctx, userId, successors ?? [], "changing the role of");
  else if ((successors?.length ?? 0) > 0) throw new Error("INVALID_SUCCESSOR");
  await updateUser(ctx, userId, { role });
  await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: "agent-users", action: "admin.role_changed", resource: `user:${userId}`, status: "succeeded", oldValue: user.role ?? "user", newValue: role });
} });
export const update = adminMutation({ args: { ...userArgs, name: v.string(), image: v.optional(v.union(v.string(), v.null())) }, handler: async (ctx, { userId, name, image }) => {
  await target(ctx, userId);
  if (!name.trim() || name.length > 200 || image && image.length > 2000) throw new Error("INVALID_PROFILE");
  await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: userId }], update: { name: name.trim(), ...(image !== undefined ? { image } : {}), updatedAt: Date.now() } } });
  await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: "agent-users", action: "user.profile_updated", resource: `user:${userId}`, status: "succeeded" });
} });
/**
 * Delete a user now, on the same deletion path as Better Auth's delete hooks
 * (`beginUserDeletion` / `finishUserDeletion` in userDeletion.ts): refused with
 * `BILLING_ORGANIZATION_IN_USE` or `BILLING_OWNER_REQUIRED` as they are; memberships, app-owned
 * and platform-owned user data go with the user.
 */
export const remove = adminMutation({ args: userArgs, handler: async (ctx, { userId }) => {
  const user = await protectedTarget(ctx, userId);
  if (userId === ctx.user._id) throw new Error("CANNOT_DELETE_SELF");
  const blocker = await beginUserDeletion(ctx, { userId, ownerId: user.userId ?? userId, email: user.email, name: user.name ?? "" });
  if (blocker) throw new Error(blocker.code);
  await deleteSessions(ctx, userId);
  for (const model of ["account", "twoFactor", "passkey"] as const) {
    for (let i = 0; i < 100; i++) {
      const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, { input: { model, where: [{ field: "userId", value: userId }] }, paginationOpts: { cursor: null, numItems: 100 } });
      if (result.isDone) break;
      if (i === 99) throw new Error("TOO_MANY_USER_RECORDS");
    }
  }
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "user", where: [{ field: "_id", value: userId }] } });
  await finishUserDeletion(ctx, { userId, actor: { email: ctx.user.email, userId: ctx.ownerId } });
  await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: "agent-users", action: "admin.user.deleted", resource: `user:${user._id}`, status: "succeeded" });
} });
export const sessions = authedQuery({ args: { ...userArgs, paginationOpts: paginationOptsValidator }, handler: async (ctx, { userId, paginationOpts }) => {
  if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN");
  if (paginationOpts.numItems > 100) throw new Error("INVALID_PAGE_SIZE");
  await target(ctx, userId);
  const rows = await ctx.runQuery(components.betterAuth.adapter.findMany, { model: "session", where: [{ field: "userId", value: userId }], paginationOpts });
  return { ...rows, page: rows.page.map((row: Doc<"session">) => ({ id: row._id, userId: row.userId, createdAt: row.createdAt, expiresAt: row.expiresAt, ipAddress: row.ipAddress, userAgent: row.userAgent })) };
} });
export const revokeSession = adminMutation({ args: { ...userArgs, sessionId: v.string() }, handler: async (ctx, { userId, sessionId }) => {
  const row = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "_id", value: sessionId }] });
  if (!row || row.userId !== userId) throw new Error("SESSION_NOT_FOUND");
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: sessionId }] } });
  await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: "agent-users", action: "admin.session.revoked", resource: `session:${sessionId}`, status: "succeeded" });
} });
export const revokeSessions = adminMutation({ args: userArgs, handler: async (ctx, { userId }) => {
  await target(ctx, userId); await deleteSessions(ctx, userId);
  await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: "agent-users", action: "admin.session.revoked_all", resource: `user:${userId}`, status: "succeeded" });
} });
