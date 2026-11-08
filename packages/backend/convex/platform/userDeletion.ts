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
import type { Doc as AppDoc } from "../_generated/dataModel";
import { batchLimits, isCurrentRun, jobStale, newRunId } from "./backgroundJobs";
import { adminMutation, authedMutation, authedQuery } from "./functions";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { createAuth } from "./auth";
import { findById, findMembership, listMemberships, otherMemberExists, parseRole, removeMembership, type AccountDeletionActor } from "./organizationAccess";
import { canAct, invalidateTenancyCheck, ownersNeededForReactivation, setMemberRole, successorNeeded, successorRequiredMessage, successorsNeededForBan } from "./organizationOwnership";
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
    if (!(await otherMemberExists(ctx, member.organizationId, member._id))) return { code: "BILLING_ORGANIZATION_IN_USE", organizationId: member.organizationId, organizationName };
    if (parseRole(member.role) === "owner" && await successorNeeded(ctx, member.organizationId, member._id)) return { code: "BILLING_OWNER_REQUIRED", organizationId: member.organizationId, organizationName };
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
 * blocker, if any, with nothing written; otherwise the cleanup is recorded, with a run of its job
 * (`advanceCleanup`), before the user row goes, so it can be retried without the user. Then
 * delete the user, then `finishUserDeletion`.
 */
export async function beginUserDeletion(ctx: Pick<MutationCtx, "runQuery" | "db" | "scheduler">, input: UserDeletionInput): Promise<DeletionBlocker | null> {
  const blocker = await deletionBlocker(ctx, input.userId);
  if (blocker) return blocker;
  if (await cleanupFor(ctx, input.userId)) return null;
  const id = await ctx.db.insert("userDeletionCleanups", { ...input, state: "pending", attempts: 0, createdAt: Date.now(), removedMemberships: 0, runId: newRunId() });
  // A safety run: it does nothing while the user row exists, and starts the cleanup if the
  // deletion's second half never runs.
  await scheduleCleanupRun(ctx, (await ctx.db.get(id))!, 1000);
  return null;
}

/**
 * The second half, once the user row is gone. Memberships go first, one organization per
 * transaction, as a job (`advanceCleanup`, the only production caller of `removeMembership`):
 * this starts it and returns, and the job calls this again once none are left. Then app-owned
 * user data, platform profiles and plan choices, the deletion request and the cleanup record.
 * Idempotent; also the cleanup retry. `actor` is who deleted the user, for organizations the
 * deletion empties (default: the user).
 */
export async function finishUserDeletion(
  ctx: MutationCtx,
  args: { userId: string; ownerId?: string; cleanupOnly?: boolean; actor?: AccountDeletionActor },
) {
  const cleanup = await cleanupFor(ctx, args.userId);
  if (args.cleanupOnly && !cleanup) return;
  const ownerId = cleanup?.ownerId ?? args.ownerId ?? args.userId;
  if (cleanup && !(await findById(ctx, "user", args.userId)) && await anyMembership(ctx, args.userId)) {
    await startMembershipRemoval(ctx, cleanup, args.actor);
    return;
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
    await invalidateTenancyCheck(ctx);
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

type DeletionRow = AppDoc<"userDeletions">;

/**
 * Whether a `deleting` request is stuck: its `execute` run died before finishing or recording why
 * (backgroundJobs.ts). An administrator retries it (`adminRetry`).
 */
async function deletionStale(ctx: Pick<QueryCtx, "db">, row: DeletionRow, now = Date.now()): Promise<boolean> {
  return row.state === "deleting" && await jobStale(ctx, row, row.claimedAt ?? row.deleteAt, now);
}

/** Nothing of the user has been deleted yet: the user row and a sign-in account are still there. */
async function userIntact(ctx: Pick<QueryCtx, "runQuery">, userId: string): Promise<boolean> {
  if (!(await findById(ctx, "user", userId))) return false;
  return !!(await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "userId", value: userId }] }));
}

/**
 * Whether the request can still be cancelled: anything but a deletion under way. A stale
 * deletion can be cancelled only while the user is intact; a partly deleted user can only be
 * retried.
 */
async function cancelRefusal(ctx: Pick<QueryCtx, "db" | "runQuery">, row: DeletionRow): Promise<string | null> {
  if (row.state !== "deleting") return null;
  if (!(await deletionStale(ctx, row))) return "USER_DELETION_IN_PROGRESS";
  return await userIntact(ctx, row.userId) ? null : "USER_DELETION_INCOMPLETE";
}

async function cancelDeletion(ctx: Pick<MutationCtx, "db" | "scheduler" | "runQuery">, userId: string, actor: { email: string; userId: string }) {
  const row = await scheduledDeletion(ctx, userId);
  if (!row) return false;
  const refusal = await cancelRefusal(ctx, row);
  if (refusal) throw new Error(refusal);
  if (row.state === "cleanup_pending" || (!(await findById(ctx, "user", userId)) && await cleanupFor(ctx, userId))) throw new Error("USER_CLEANUP_PENDING");
  const user = await findById(ctx, "user", userId);
  if (user && canAct(user)) {
    const needed = await ownersNeededForReactivation(ctx, userId, true);
    if (needed.length) throw new Error(successorRequiredMessage(needed, "canceling deletion for"));
  }
  await invalidateTenancyCheck(ctx);
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

/** Keep the caller: cancel their scheduled (or blocked, or stale but intact) deletion. */
export const cancel = authedMutation({
  args: {},
  handler: async (ctx) => {
    await cancelDeletion(ctx, ctx.user._id, { email: ctx.user.email, userId: ctx.user._id });
  },
});

// ---------------------------------------------------------------------------
// Platform admins
// ---------------------------------------------------------------------------

/** Deletion requests and cleanups listed at most; beyond that `list` says there are more. */
const LIST_LIMIT = 200;

/**
 * Scheduled and blocked deletions, soonest first, then cleanups of deleted users that are still
 * owed, for the admin app's Users page: at most `LIST_LIMIT` of each (`more` says there are
 * more). `stale` marks a deletion under way, or a cleanup, whose run died (`adminRetry`,
 * `adminRetryCleanup`); `cancelable` whether `adminCancel` accepts it; `retryable` whether
 * `adminRetryCleanup` does. Each user is looked up once.
 */
export const list = authedQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN");
    const requests = await ctx.db.query("userDeletions").withIndex("by_deleteAt").take(LIST_LIMIT + 1);
    const cleanups = await ctx.db.query("userDeletionCleanups").take(LIST_LIMIT + 1);
    const more = requests.length > LIST_LIMIT || cleanups.length > LIST_LIMIT;
    const requestRows = requests.slice(0, LIST_LIMIT);
    const cleanupByUser = new Map(cleanups.slice(0, LIST_LIMIT).map((cleanup) => [cleanup.userId, cleanup]));
    const userIds = new Set([...requestRows.map((row) => row.userId), ...cleanupByUser.keys()]);
    const users = new Map(await Promise.all([...userIds].map(async (userId) => [userId, await findById(ctx, "user", userId)] as const)));
    const now = Date.now();
    const cleanupView = async (cleanup: CleanupRow) => {
      const stale = await cleanupStale(ctx, cleanup, now);
      return { state: "cleanup_pending" as const, blockedReason: cleanup.error ?? null, stale, cancelable: false, retryable: cleanup.state !== "running" || stale, removedMemberships: cleanup.removedMemberships ?? 0 };
    };
    const rows = await Promise.all(requestRows.map(async (row) => {
      const user = users.get(row.userId) ?? null;
      const cleanup = cleanupByUser.get(row.userId);
      const identity = { userId: row.userId, email: user?.email ?? cleanup?.email ?? "", name: user?.name ?? cleanup?.name ?? "", requestedAt: row.requestedAt, deleteAt: row.deleteAt };
      if (!user && cleanup) {
        const view = await cleanupView(cleanup);
        // The deletion's own run may be the one that died (`adminRetry` resumes it into the cleanup).
        const stale = view.stale || await deletionStale(ctx, row, now);
        return { ...identity, ...view, stale, retryable: view.retryable || stale };
      }
      return { ...identity, state: row.state, blockedReason: row.blockedReason ?? null, stale: await deletionStale(ctx, row, now),
        cancelable: !(await cancelRefusal(ctx, row)), retryable: false, removedMemberships: 0 };
    }));
    const requested = new Set(requestRows.map((row) => row.userId));
    for (const cleanup of cleanupByUser.values()) {
      if (requested.has(cleanup.userId) || users.get(cleanup.userId)) continue;
      rows.push({ userId: cleanup.userId, email: cleanup.email, name: cleanup.name, requestedAt: cleanup.createdAt, deleteAt: cleanup.createdAt, ...(await cleanupView(cleanup)) });
    }
    return { rows, more };
  },
});

export const adminCancel = adminMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN");
    if (!(await cancelDeletion(ctx, args.userId, { email: ctx.user.email, userId: ctx.user._id }))) throw new Error("USER_DELETION_NOT_FOUND");
  },
});

/**
 * Run a stale deletion again: `execute` resumes the same request under a new run token, so a late
 * run of the dead one does nothing. Every step is idempotent; where the user row is already gone
 * it continues into the cleanup (`advanceCleanup`).
 */
export const adminRetry = adminMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN");
    const row = await scheduledDeletion(ctx, args.userId);
    if (!row) throw new Error("USER_DELETION_NOT_FOUND");
    if (!(await deletionStale(ctx, row))) throw new Error("USER_DELETION_NOT_STALE");
    const runId = newRunId();
    const jobId = await ctx.scheduler.runAfter(0, internal.platform.userDeletion.execute, { userId: args.userId, requestId: row.requestId, runId });
    await ctx.db.patch(row._id, { jobId, runId, claimedAt: Date.now() });
    await scheduleAuditEvent(ctx, {
      actor: ctx.user.email, authenticatedUserId: ctx.user._id, sourceDetail: "user-deletion", action: "user.deletion.retried",
      resource: `user:${args.userId}`, status: "succeeded",
    });
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

/**
 * Claim and cancellation serialize on the same row. A claimed request cannot be canceled until
 * it is stale. With `runId`, an administrator's retry re-claims its own `deleting` request.
 */
export const claim = internalMutation({
  args: { userId: v.string(), requestId: v.optional(v.string()), runId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await scheduledDeletion(ctx, args.userId);
    if (!row || row.requestId !== args.requestId) return false;
    if (args.runId !== undefined) {
      if (row.state !== "deleting" || row.runId !== args.runId) return false;
      await ctx.db.patch(row._id, { claimedAt: Date.now() });
      return true;
    }
    if (row.state !== "scheduled" || row.deleteAt > Date.now()) return false;
    const blocker = await deletionBlocker(ctx, args.userId);
    if (blocker) {
      await ctx.runMutation(internal.platform.userDeletion.markBlocked, { userId: args.userId, requestId: args.requestId, reason: blocker.code });
      return blocker;
    }
    await ctx.db.patch(row._id, { state: "deleting", claimedAt: Date.now() });
    return true;
  },
});

/**
 * The grace period is over: atomically claim this specific request before destructive calls.
 * Convex runs an action at most once: killed before it finishes, the request stays `deleting`
 * and is reported stale for an administrator's retry, which runs this again with `runId`.
 */
export const execute = internalAction({
  args: { userId: v.string(), requestId: v.optional(v.string()), runId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.platform.userDeletion.pending, { userId: args.userId });
    // A run of a request an administrator has since retried under a new token.
    if (request && request.requestId === args.requestId && request.state === "deleting" && !isCurrentRun(request, args.runId)) return;
    const pendingCleanup = await ctx.runQuery(internal.platform.userDeletion.cleanupStatus, { userId: args.userId });
    if (pendingCleanup && !(await ctx.runQuery(internal.platform.userDeletion.userRow, { userId: args.userId }))) {
      try {
        await ctx.runMutation(internal.platform.userDeletion.forget, { userId: args.userId, cleanupOnly: true });
      } catch (error) {
        await ctx.runMutation(internal.platform.userDeletion.cleanupFailed, { userId: args.userId, error: error instanceof Error ? error.message : "Cleanup failed" });
      }
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
        await ctx.runMutation(internal.platform.userDeletion.markBlocked, { userId: args.userId, requestId: args.requestId, reason });
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

// ---------------------------------------------------------------------------
// The cleanup job: memberships one organization per run, then user data
// ---------------------------------------------------------------------------

type CleanupRow = AppDoc<"userDeletionCleanups">;

/** Automatic retries of a failing cleanup run, with backoff; then it waits for an administrator. */
const CLEANUP_ATTEMPTS = 5;

async function cleanupFor(ctx: Pick<QueryCtx, "db">, userId: string) {
  return await ctx.db.query("userDeletionCleanups").withIndex("by_user", q => q.eq("userId", userId)).first();
}

/** Whether the user still has a membership (any one). */
async function anyMembership(ctx: Pick<QueryCtx, "runQuery">, userId: string): Promise<Doc<"member"> | null> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "member", where: [{ field: "userId", value: userId }], paginationOpts: { numItems: 1, cursor: null },
  });
  return (result.page[0] as Doc<"member"> | undefined) ?? null;
}

/** Schedule the next run of the cleanup's chain and record its job, in the caller's transaction (backgroundJobs.ts). */
async function scheduleCleanupRun(ctx: Pick<MutationCtx, "db" | "scheduler">, row: CleanupRow, delayMs: number, patch: Partial<CleanupRow> = {}) {
  const runId = patch.runId ?? row.runId;
  const jobId = await ctx.scheduler.runAfter(delayMs, internal.platform.userDeletion.advanceCleanup, { userId: row.userId, runId });
  await ctx.db.patch(row._id, { ...patch, jobId, updatedAt: Date.now() });
}

/**
 * Whether a pending or running cleanup is stuck: its run can no longer move it on, nor record
 * why (backgroundJobs.ts). An administrator retries it (`adminRetryCleanup`).
 */
async function cleanupStale(ctx: Pick<QueryCtx, "db">, row: CleanupRow, now = Date.now()): Promise<boolean> {
  return row.state !== "failed" && await jobStale(ctx, row, row.updatedAt ?? row.createdAt, now);
}

/** Start removing the deleted user's memberships, unless a live chain already is. */
async function startMembershipRemoval(ctx: Pick<MutationCtx, "db" | "scheduler">, row: CleanupRow, actor?: AccountDeletionActor) {
  if (row.state === "running" && !(await cleanupStale(ctx, row))) {
    if (actor && !row.actor) await ctx.db.patch(row._id, { actor });
    return;
  }
  await scheduleCleanupRun(ctx, row, 0, { state: "running", runId: newRunId(), ...(actor ? { actor } : {}) });
}

/**
 * The cleanup's driver: a scheduled mutation, which Convex runs exactly once. Each run does one
 * step (`cleanupStep`: one membership, or the rest of the cleanup once none are left) as a
 * sub-transaction with most of the transaction's limits, and records the outcome in its own:
 * progress schedules the next run; a failure rolls the step back, is recorded (the deletion
 * request shows `cleanup_pending`) and retried with backoff, then waits for an administrator.
 * Only a run of the row's current chain (`runId`) does anything, and nothing while the user row
 * still exists.
 */
export const advanceCleanup = internalMutation({
  args: { userId: v.string(), runId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await cleanupFor(ctx, args.userId);
    if (!row || !isCurrentRun(row, args.runId)) return;
    if (await findById(ctx, "user", args.userId)) return;
    const transactionLimits = await batchLimits(ctx);
    try {
      const done = await ctx.runMutation(internal.platform.userDeletion.cleanupStep, { userId: args.userId }, transactionLimits ? { transactionLimits } : {});
      if (!done) await scheduleCleanupRun(ctx, row, 0, { state: "running", attempts: 0, error: undefined, removedMemberships: (row.removedMemberships ?? 0) + 1 });
    } catch (error) {
      await recordCleanupFailure(ctx, row, error instanceof Error ? error.message : "Cleanup failed");
    }
  },
});

/** Record a failed step on the cleanup and its deletion request; retry with backoff (`newChain`: under a new run token). */
async function recordCleanupFailure(ctx: Pick<MutationCtx, "db" | "scheduler">, row: CleanupRow, message: string, newChain = false) {
  const error = message.slice(0, 1000);
  const attempts = row.attempts + 1;
  const request = await scheduledDeletion(ctx, row.userId);
  if (request) await ctx.db.patch(request._id, { state: "cleanup_pending", blockedReason: error });
  const patch = { state: "failed" as const, attempts, error, ...(newChain ? { runId: newRunId() } : {}) };
  if (attempts < CLEANUP_ATTEMPTS) await scheduleCleanupRun(ctx, row, 1000 * 2 ** attempts, patch);
  else await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
}

/**
 * One step of the cleanup, in its own sub-transaction (`advanceCleanup`): remove one membership
 * (`removeMembership`), or, once none are left, the rest (`finishUserDeletion`, which deletes
 * the cleanup row). `true` when the cleanup is complete.
 */
export const cleanupStep = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const row = await cleanupFor(ctx, args.userId);
    if (!row) return true;
    const member = await anyMembership(ctx, args.userId);
    if (member) {
      await removeMembership(ctx, member, args.userId, row.actor ?? { email: row.email, userId: args.userId });
      return false;
    }
    await finishUserDeletion(ctx, { userId: args.userId, cleanupOnly: true });
    return true;
  },
});

/** Better Auth's `user.delete.before`: `beginUserDeletion`, returning the blocker that refuses it. */
export const beginDeletion = internalMutation({
  args: { userId: v.string(), ownerId: v.string(), email: v.string(), name: v.string() },
  handler: async (ctx, args) => await beginUserDeletion(ctx, args),
});

export const cleanupStatus = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await cleanupFor(ctx, args.userId),
});

/** The deletion's second half failed outside the job (Better Auth's after-hook, `execute`): record it and retry. */
export const cleanupFailed = internalMutation({
  args: { userId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const row = await cleanupFor(ctx, args.userId);
    if (!row) return;
    await recordCleanupFailure(ctx, row, args.error, true);
  },
});

/**
 * Run a failed or stalled cleanup again, under a new run token: a late run of the old chain does
 * nothing. Removal resumes with the memberships that are left.
 */
export const adminRetryCleanup = adminMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN");
    const cleanup = await cleanupFor(ctx, args.userId);
    if (!cleanup) throw new Error("USER_CLEANUP_NOT_FOUND");
    if (await findById(ctx, "user", args.userId)) throw new Error("USER_STILL_EXISTS");
    if (cleanup.state === "running" && !(await cleanupStale(ctx, cleanup))) throw new Error("USER_CLEANUP_RUNNING");
    await scheduleCleanupRun(ctx, cleanup, 0, { state: "running", attempts: 0, error: undefined, runId: newRunId() });
  },
});
