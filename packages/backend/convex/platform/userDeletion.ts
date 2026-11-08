/**
 * Deleting a user (platform/docs/tenancy-and-billing.md). A user deletes themselves after a grace
 * period (`userDeletionGraceDays`): the request signs them out everywhere, and until the date
 * signing in offers only cancelling or continuing. The platform admin's delete is immediate.
 * Both are refused while the user is the last member, or the last owner, of a billing
 * organization that pays for other organizations' plans. Everything goes except billing history.
 */
import { v } from "convex/values";
import { appConfig } from "@web-app-starter/app-config";
import { components, internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { adminMutation, authedMutation, authedQuery } from "./functions";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { createAuth } from "./auth";
import { findById, findMembership, listMemberships, parseRole, removeMemberships, type AccountDeletionActor } from "./organizationAccess";
import { needsSuccessor, organizationSeats, setMemberRole, successorsNeededForBan } from "./organizationOwnership";
import { makeFunctionReference } from "convex/server";
import { scheduledDeletion } from "./billingAccess";
import { sendLimitedAuthEmail } from "./authRateLimits";
import { userDeletionBlockedEmail, userDeletionScheduledEmail } from "./sendAuthEmail";

type Reader = Pick<QueryCtx, "runQuery" | "db">;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_DAYS = 14;

export type DeletionBlocker = { code: "BILLING_ORGANIZATION_IN_USE" | "BILLING_OWNER_REQUIRED"; organizationId: string; organizationName: string };

/**
 * Why this user can't be deleted now: they are the last member of a billing organization that
 * pays for other organizations' plans, or its last owner while others remain (an owner is made
 * deliberately, never passed on automatically).
 */
export async function deletionBlocker(ctx: Reader, userId: string): Promise<DeletionBlocker | null> {
  for (const member of await listMemberships(ctx, userId)) {
    if (!(await ctx.runQuery(components.platform.billing.billingInUse, { organizationId: member.organizationId }))) continue;
    const organizationName = (await findById(ctx, "organization", member.organizationId))?.name ?? "";
    const others = (await organizationSeats(ctx, member.organizationId)).filter((seat) => seat.member._id !== member._id);
    if (others.length === 0) return { code: "BILLING_ORGANIZATION_IN_USE", organizationId: member.organizationId, organizationName };
    if (parseRole(member.role) === "owner" && needsSuccessor(others)) return { code: "BILLING_OWNER_REQUIRED", organizationId: member.organizationId, organizationName };
  }
  return null;
}

function blockerMessage(blocker: Pick<DeletionBlocker, "code" | "organizationName">): string {
  return blocker.code === "BILLING_ORGANIZATION_IN_USE"
    ? `you are the last member of ${blocker.organizationName}, which pays for other organizations' plans. Invite another owner or downgrade those organizations first.`
    : `you are the last owner of ${blocker.organizationName}, which pays for other organizations' plans. Make another member an owner first.`;
}

async function graceDaysSetting(ctx: Reader): Promise<number> {
  const value = await ctx.runQuery(components.platform.appSettings.get, { key: "userDeletionGraceDays" });
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : DEFAULT_GRACE_DAYS;
}

function signInUrl(): string {
  const origin = (process.env.SITE_URL ?? "").split(",")[0]?.trim() ?? "";
  return `${origin}/sign-in`;
}

/** Delete every session of a user, a page at a time. */
async function revokeSessions(ctx: Pick<MutationCtx, "runMutation">, userId: string) {
  let done = false;
  while (!done) {
    const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model: "session", where: [{ field: "userId", value: userId }] },
      paginationOpts: { cursor: null, numItems: 100 },
    });
    done = result.isDone;
  }
}

/**
 * A user with a pending deletion no longer counts as able to act (`organizationSeats`). Where the
 * requester is the only owner who can act while other members can, make the successor the
 * deletion would pick an owner now, so the organization keeps an owner who can act during the
 * grace period. The requester stays an owner: cancelling loses nothing. Billing organizations
 * never get here: `deletionBlocker` refuses those first (`BILLING_OWNER_REQUIRED`).
 */
async function handOverForDeletion(ctx: Pick<MutationCtx, "runQuery" | "runMutation" | "db">, userId: string) {
  const successors: { organizationId: string; userId: string }[] = [];
  for (const need of await successorsNeededForBan(ctx, userId)) {
    const member = need.suggested ? await findMembership(ctx, need.suggested, need.organizationId) : null;
    if (!member) throw new Error("OWNER_SUCCESSOR_REQUIRED");
    await setMemberRole(ctx, member._id, "owner");
    successors.push({ organizationId: need.organizationId, userId: member.userId });
  }
  return successors;
}

export type UserDeletionInput = { userId: string; ownerId: string; email: string; name: string };

/**
 * The first half of every user deletion (Better Auth's delete hooks, `agentUsers.remove`): the
 * blocker, if any, with nothing written; otherwise the cleanup inputs are recorded before the
 * user row goes, so cleanup can be retried without it. Then delete the user, then
 * `finishUserDeletion`.
 */
export async function beginUserDeletion(ctx: Pick<MutationCtx, "runQuery" | "db" | "scheduler">, input: UserDeletionInput): Promise<DeletionBlocker | null> {
  const blocker = await deletionBlocker(ctx, input.userId);
  if (blocker) return blocker;
  if (await cleanupFor(ctx, input.userId)) return null;
  await ctx.db.insert("userDeletionCleanups", { ...input, state: "pending", attempts: 0, createdAt: Date.now() });
  await ctx.scheduler.runAfter(1000, internal.platform.userDeletion.runCleanup, { userId: input.userId });
  return null;
}

/**
 * The second half, once the user row is gone: memberships (`removeMemberships`, the only
 * production caller), app-owned user data, platform profiles and plan choices, the deletion
 * request and the cleanup record. Idempotent; also the cleanup retry. `actor` is who deleted the
 * user, for organizations the deletion empties (default: the user).
 */
export async function finishUserDeletion(
  ctx: MutationCtx,
  args: { userId: string; ownerId?: string; cleanupOnly?: boolean; actor?: AccountDeletionActor },
) {
  const cleanup = await cleanupFor(ctx, args.userId);
  if (args.cleanupOnly && !cleanup) return;
  const ownerId = cleanup?.ownerId ?? args.ownerId ?? args.userId;
  if (cleanup && !(await findById(ctx, "user", args.userId))) {
    await removeMemberships(ctx, args.userId, args.actor ?? { email: cleanup.email, userId: args.userId });
  }
  try {
    await ctx.runMutation(makeFunctionReference<"mutation", { userId: string; ownerId: string }>("userData:deleteUserData"), { userId: args.userId, ownerId });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("userData:deleteUserData") || !/Couldn't resolve|Could not find/i.test(error.message)) throw error;
  }
  for (const profileOwnerId of new Set([args.userId, ownerId])) {
    for (const profile of await ctx.db.query("userProfiles").withIndex("by_owner", q => q.eq("ownerId", profileOwnerId)).collect()) await ctx.db.delete(profile._id);
  }
  for (const choice of await ctx.db.query("pendingPlanChoices").withIndex("by_user", q => q.eq("userId", args.userId)).collect()) await ctx.db.delete(choice._id);
  if (cleanup) await ctx.db.delete(cleanup._id);
  const row = await scheduledDeletion(ctx, args.userId);
  if (!row) return;
  if (row.state === "scheduled") {
    const job = await ctx.db.system.get(row.jobId);
    if (job && job.state.kind === "pending") await ctx.scheduler.cancel(row.jobId);
  }
  await ctx.db.delete(row._id);
}

// ---------------------------------------------------------------------------
// The user
// ---------------------------------------------------------------------------

/** Schedule the caller's deletion after the grace period, sign them out everywhere and email them. */
export const request = authedMutation({
  args: {},
  handler: async (ctx) => {
    if (ctx.user.role === "admin") throw new Error("NOT_APPLICATION_USER");
    if (!ctx.assurance.recent) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
    if (await scheduledDeletion(ctx, ctx.user._id)) throw new Error("USER_DELETION_ALREADY_SCHEDULED");
    const blocker = await deletionBlocker(ctx, ctx.user._id);
    if (blocker) throw new Error(blocker.code);
    const successors = await handOverForDeletion(ctx, ctx.user._id);
    const now = Date.now();
    const deleteAt = now + (await graceDaysSetting(ctx)) * DAY_MS;
    const requestId = `${now}-${Math.random()}`;
    const jobId = await ctx.scheduler.runAt(deleteAt, internal.platform.userDeletion.execute, { userId: ctx.user._id, requestId });
    await ctx.db.insert("userDeletions", { userId: ctx.user._id, requestId, requestedAt: now, deleteAt, jobId, state: "scheduled" });
    await revokeSessions(ctx, ctx.user._id);
    await ctx.scheduler.runAfter(0, internal.platform.userDeletion.notify, { userId: ctx.user._id, kind: "scheduled" });
    await scheduleAuditEvent(ctx, {
      actor: ctx.user.email, authenticatedUserId: ctx.user._id, sourceDetail: "user-deletion", action: "user.deletion.requested",
      resource: `user:${ctx.user._id}`, status: "succeeded", meta: JSON.stringify({ deleteAt, ...(successors.length ? { successors } : {}) }),
    });
    return { deleteAt };
  },
});

async function cancelDeletion(ctx: Pick<MutationCtx, "db" | "scheduler" | "runQuery">, userId: string, actor: { email: string; userId: string }) {
  const row = await scheduledDeletion(ctx, userId);
  if (!row) return false;
  if (row.state === "deleting") throw new Error("USER_DELETION_IN_PROGRESS");
  if (row.state === "cleanup_pending" || (!(await findById(ctx, "user", userId)) && await cleanupFor(ctx, userId))) throw new Error("USER_CLEANUP_PENDING");
  if (row.state === "scheduled") await ctx.scheduler.cancel(row.jobId);
  await ctx.db.delete(row._id);
  const cleanup = await cleanupFor(ctx, userId);
  if (cleanup) await ctx.db.delete(cleanup._id);
  await scheduleAuditEvent(ctx, {
    actor: actor.email, authenticatedUserId: actor.userId, sourceDetail: "user-deletion", action: "user.deletion.canceled",
    resource: `user:${userId}`, status: "succeeded",
  });
  return true;
}

/** How many days a self-deletion waits, for the settings page. */
export const graceDays = authedQuery({
  args: {},
  handler: async (ctx) => await graceDaysSetting(ctx),
});

/** Keep the caller: cancel their scheduled (or blocked) deletion. */
export const cancel = authedMutation({
  args: {},
  handler: async (ctx) => {
    await cancelDeletion(ctx, ctx.user._id, { email: ctx.user.email, userId: ctx.user._id });
  },
});

// ---------------------------------------------------------------------------
// Platform admins
// ---------------------------------------------------------------------------

/** Scheduled and blocked deletions, soonest first, for the admin app's Users page. */
export const list = authedQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN");
    const rows = await ctx.db.query("userDeletions").withIndex("by_deleteAt").take(500);
    const cleanups = await ctx.db.query("userDeletionCleanups").take(500);
    const orphaned = [];
    for (const cleanup of cleanups) if (!(await findById(ctx, "user", cleanup.userId))) orphaned.push(cleanup);
    const all = [...rows, ...orphaned.filter(cleanup => !rows.some(row => row.userId === cleanup.userId)).map(cleanup => ({ userId: cleanup.userId, requestedAt: cleanup.createdAt, deleteAt: cleanup.createdAt, state: "cleanup_pending" as const, blockedReason: cleanup.error }))];
    return await Promise.all(all.map(async row => {
      const user = await findById(ctx, "user", row.userId);
      const cleanup = cleanups.find(entry => entry.userId === row.userId);
      return { userId: row.userId, email: user?.email ?? cleanup?.email ?? "", name: user?.name ?? cleanup?.name ?? "", requestedAt: row.requestedAt, deleteAt: row.deleteAt,
        state: !user && cleanup ? "cleanup_pending" as const : row.state,
        blockedReason: !user && cleanup ? cleanup.error ?? null : row.blockedReason ?? null };
    }));
  },
});

export const adminCancel = adminMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN");
    if (!(await cancelDeletion(ctx, args.userId, { email: ctx.user.email, userId: ctx.user._id }))) throw new Error("USER_DELETION_NOT_FOUND");
  },
});

// ---------------------------------------------------------------------------
// Running the deletion
// ---------------------------------------------------------------------------

export const blockerFor = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await deletionBlocker(ctx, args.userId),
});

export const pending = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await scheduledDeletion(ctx, args.userId),
});

export const markBlocked = internalMutation({
  args: { userId: v.string(), requestId: v.optional(v.string()), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await scheduledDeletion(ctx, args.userId);
    if (!row || row.requestId !== args.requestId) return;
    await ctx.db.patch(row._id, { state: "blocked", blockedReason: args.reason });
    const user = await findById(ctx, "user", args.userId);
    await scheduleAuditEvent(ctx, {
      actor: "system", sourceDetail: "user-deletion", action: "user.deletion.blocked",
      resource: `user:${args.userId}`, status: "failed.blocked", reason: args.reason, meta: user ? JSON.stringify({ email: user.email }) : undefined,
    });
  },
});

/** Better Auth's `user.delete.after`, and cleanup retries: `finishUserDeletion`. */
export const forget = internalMutation({
  args: { userId: v.string(), ownerId: v.optional(v.string()), cleanupOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => await finishUserDeletion(ctx, args),
});

export const recordCompleted = internalMutation({
  args: { userId: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    await scheduleAuditEvent(ctx, {
      actor: args.email, authenticatedUserId: args.userId, sourceDetail: "user-deletion", action: "user.deletion.completed",
      resource: `user:${args.userId}`, status: "succeeded",
    });
  },
});

/** Claim and cancellation serialize on the same row. A claimed request cannot be canceled. */
export const claim = internalMutation({
  args: { userId: v.string(), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await scheduledDeletion(ctx, args.userId);
    if (!row || row.state !== "scheduled" || row.requestId !== args.requestId || row.deleteAt > Date.now()) return false;
    const blocker = await deletionBlocker(ctx, args.userId);
    if (blocker) {
      await ctx.runMutation(internal.platform.userDeletion.markBlocked, { userId: args.userId, requestId: args.requestId, reason: blocker.code });
      return blocker;
    }
    await ctx.db.patch(row._id, { state: "deleting" });
    return true;
  },
});

/** The grace period is over: atomically claim this specific request before destructive calls. */
export const execute = internalAction({
  args: { userId: v.string(), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const pendingCleanup = await ctx.runQuery(internal.platform.userDeletion.cleanupStatus, { userId: args.userId });
    if (pendingCleanup && !(await ctx.runQuery(internal.platform.userDeletion.userRow, { userId: args.userId }))) {
      await ctx.runAction(internal.platform.userDeletion.runCleanup, { userId: args.userId });
      return;
    }
    const claim = await ctx.runMutation(internal.platform.userDeletion.claim, args);
    if (claim !== true) {
      if (claim) await ctx.runAction(internal.platform.userDeletion.notify, { userId: args.userId, kind: "blocked", reason: blockerMessage(claim) });
      return;
    }
    try {
      const auth = createAuth(ctx);
      const context = await auth.$context;
      const user = await context.internalAdapter.findUserById(args.userId);
      if (!user) {
        await ctx.runMutation(internal.platform.userDeletion.forget, { userId: args.userId });
        return;
      }
      await context.internalAdapter.deleteUser(args.userId);
      await ctx.runMutation(internal.platform.userDeletion.recordCompleted, { userId: args.userId, email: user.email });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 1000) : "Deletion failed";
      if (await ctx.runQuery(internal.platform.userDeletion.userRow, { userId: args.userId })) {
        await ctx.runMutation(internal.platform.userDeletion.markBlocked, { ...args, reason });
      } else {
        await ctx.runMutation(internal.platform.userDeletion.cleanupFailed, { userId: args.userId, error: reason });
      }
      throw error;
    }
  },
});

export const userRow = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<Doc<"user"> | null> => await findById(ctx, "user", args.userId),
});

/** The deletion emails. A failure to send is logged, never retried into a loop. */
export const notify = internalAction({
  args: { userId: v.string(), kind: v.union(v.literal("scheduled"), v.literal("blocked")), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.platform.userDeletion.userRow, { userId: args.userId });
    const row = await ctx.runQuery(internal.platform.userDeletion.pending, { userId: args.userId });
    if (!user || !row) return;
    const productName = appConfig.identity.productName;
    const email = args.kind === "scheduled"
      ? userDeletionScheduledEmail({ productName, deleteOn: new Date(row.deleteAt).toISOString().slice(0, 10), signInUrl: signInUrl() })
      : userDeletionBlockedEmail({ productName, reason: args.reason ?? "", signInUrl: signInUrl() });
    try {
      await sendLimitedAuthEmail(ctx, { to: user.email, type: "custom", urlOrCode: signInUrl(), ...email });
    } catch (error) {
      console.error("User deletion email failed", error instanceof Error ? error.message : error);
    }
  },
});

async function cleanupFor(ctx: Pick<QueryCtx, "db">, userId: string) {
  return await ctx.db.query("userDeletionCleanups").withIndex("by_user", q => q.eq("userId", userId)).first();
}

/** Better Auth's `user.delete.before`: `beginUserDeletion`, returning the blocker that refuses it. */
export const beginDeletion = internalMutation({
  args: { userId: v.string(), ownerId: v.string(), email: v.string(), name: v.string() },
  handler: async (ctx, args) => await beginUserDeletion(ctx, args),
});

export const cleanupStatus = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await cleanupFor(ctx, args.userId),
});

export const cleanupFailed = internalMutation({
  args: { userId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const cleanup = await cleanupFor(ctx, args.userId);
    if (!cleanup) return;
    const attempts = cleanup.state === "pending" ? cleanup.attempts + 1 : cleanup.attempts;
    await ctx.db.patch(cleanup._id, { state: "failed", attempts, error: args.error.slice(0, 1000) });
    const request = await scheduledDeletion(ctx, args.userId);
    if (request) await ctx.db.patch(request._id, { state: "cleanup_pending", blockedReason: args.error.slice(0, 1000) });
    if (attempts < 5) await ctx.scheduler.runAfter(1000 * 2 ** attempts, internal.platform.userDeletion.runCleanup, { userId: args.userId });
  },
});

/** Cleanup has its own durable lifecycle and never claims or deletes an authenticated user. */
export const runCleanup = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (!(await ctx.runMutation(internal.platform.userDeletion.claimCleanup, args))) return;
    try {
      await ctx.runMutation(internal.platform.userDeletion.forget, { ...args, cleanupOnly: true });
    } catch (error) {
      await ctx.runMutation(internal.platform.userDeletion.cleanupFailed, { userId: args.userId, error: error instanceof Error ? error.message : "Cleanup failed" });
    }
  },
});

export const adminRetryCleanup = adminMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN");
    const cleanup = await cleanupFor(ctx, args.userId);
    if (!cleanup) throw new Error("USER_CLEANUP_NOT_FOUND");
    if (await findById(ctx, "user", args.userId)) throw new Error("USER_STILL_EXISTS");
    await ctx.db.patch(cleanup._id, { state: "pending", attempts: 0, error: undefined });
    await ctx.scheduler.runAfter(0, internal.platform.userDeletion.runCleanup, args);
  },
});

/** Serialize cleanup attempts; a crashed lease can be reset by the administrator. */
export const claimCleanup = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const cleanup = await cleanupFor(ctx, args.userId);
    if (!cleanup || cleanup.state === "running" || cleanup.attempts >= 5 || await findById(ctx, "user", args.userId)) return false;
    await ctx.db.patch(cleanup._id, { state: "running", attempts: cleanup.attempts + 1 });
    return true;
  },
});
