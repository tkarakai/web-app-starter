/**
 * Organization reads for the UI: `api.platform.organizations.*`.
 *
 * These are reactive Convex queries over the Better Auth component's organization rows.
 * Every change (create, rename, invite, accept, remove, role change, switch) goes through
 * Better Auth's `/organization/*` endpoints (`authClient.organization.*`), which enforce
 * the roles; these queries update by themselves when those rows change.
 */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { components, internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery, query, type QueryCtx } from "../_generated/server";
import { isCurrentRun } from "./backgroundJobs";
import { cleanupRow, scheduleCleanupRun, startOrganizationCleanup } from "./organizationCleanup";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { evaluateSession, identitySession } from "./sessionPolicy";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { authedQuery, orgMutation, orgQuery } from "./functions";
import { actorOf, provisionOrganizationPlan, readTenancyMode } from "./billingAccess";
import { successorNeeded } from "./organizationOwnership";
import {
  deleteInvitationBatch,
  ensurePersonalOrganization,
  removeMemberships,
  findById,
  findMembership,
  INVITATION_EXPIRY_MS,
  invitationsExpiringAfter,
  isDeleting,
  listMemberships,
  listOrganizationMembers,
  parseRole,
  pendingInvitationsFor,
  resolveOrganizationSelection,
  type OrganizationRole,
} from "./organizationAccess";

function present<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** The organizations the caller belongs to, and which one is active. Drives the switcher. */
export const mine = authedQuery({
  args: {},
  handler: async (ctx) => {
    const [memberships, selection] = await Promise.all([
      listMemberships(ctx, ctx.user._id),
      resolveOrganizationSelection(ctx, ctx.user, ctx.session),
    ]);
    const active = selection.active;
    const organizations = await Promise.all(memberships.map(async (member) => {
      const organization = await findById(ctx, "organization", member.organizationId);
      return organization && !isDeleting(organization) ? { id: organization._id, name: organization.name, role: parseRole(member.role) } : null;
    }));
    return {
      activeOrganizationId: active?.organizationId ?? null,
      /**
       * The session still selects an organization the user can no longer use: reads show
       * `activeOrganizationId`, but writes are refused until the session switches to it.
       */
      selectionStale: selection.stale,
      organizations: organizations.filter(present),
    };
  },
});

/**
 * The active organization's settings view: its members and, for owners and admins, the
 * invitations still pending. Every member may see who else belongs to the organization.
 */
export const active = orgQuery({
  args: {},
  handler: async (ctx) => {
    const organization = await findById(ctx, "organization", ctx.organizationId);
    if (!organization) return null;

    const rows = await listOrganizationMembers(ctx, ctx.organizationId);
    const members = (await Promise.all(rows.map(async (member) => {
      const user = await findById(ctx, "user", member.userId);
      return user && {
        memberId: member._id,
        name: user.name,
        email: user.email,
        role: parseRole(member.role),
        joinedAt: member.createdAt,
        isYou: user._id === ctx.user._id,
      };
    }))).filter(present);

    const canManage = ctx.organizationRole !== "member";
    const invitations = canManage
      ? (await organizationInvitations(ctx, ctx.organizationId, new Set(members.map((member) => member.email.toLowerCase())))).invitations
      : [];

    // An owner may leave only if an owner who can sign in stays (organizationOwnership.ts).
    // Reads the owners, and other members only when no other owner can act.
    const own = rows.find((member) => member.userId === ctx.user._id);
    const lastOwner = ctx.organizationRole === "owner" && !!own && await successorNeeded(ctx, ctx.organizationId, own._id);

    return {
      id: organization._id,
      name: organization.name,
      role: ctx.organizationRole,
      lastOwner,
      memberCount: members.length,
      members,
      invitations,
    };
  },
});

/** How long a declined or expired invitation stays listed for the people who manage the organization, after it was last sent. */
const LISTED_AFTER_SEND_MS = 30 * 24 * 60 * 60 * 1000;

export type InvitationStatus = "pending" | "expired" | "declined";

type Reader = Pick<QueryCtx, "runQuery">;

/**
 * Live pending invitations of the organization, latest expiry first: every one, or the first
 * `limit`. Expired ones, which stay `pending`, are not read.
 */
export async function livePendingInvitations(ctx: Reader, organizationId: string, limit?: number): Promise<Doc<"invitation">[]> {
  return await invitationsExpiringAfter(ctx, { organizationId }, "pending", Date.now(), limit);
}

/**
 * The organization's invitations for its owners and admins: pending ones, expired ones still
 * pending, and declined ones, each sent (or resent) within the last 30 days, so the inviter sees
 * what became of each. One row per address (the latest sent), leaving out anyone who has since
 * joined. Every send sets `expiresAt` to the expiry period after it, so the window is an
 * `expiresAt` range and older history is never read; a live invitation is always inside it,
 * however long resends have kept it alive. `livePending` counts the live pending rows read.
 */
export async function organizationInvitations(ctx: Reader, organizationId: string, memberEmails: Set<string>) {
  const now = Date.now();
  // Last sent within the window <=> expiresAt (last send + expiry) after this.
  const expiresAfter = now - (LISTED_AFTER_SEND_MS - INVITATION_EXPIRY_MS);
  const pending = await invitationsExpiringAfter(ctx, { organizationId }, "pending", expiresAfter);
  const rows = [...pending, ...await invitationsExpiringAfter(ctx, { organizationId }, "rejected", expiresAfter)]
    .sort((a, b) => b.expiresAt - a.expiresAt || b.createdAt - a.createdAt);
  const seen = new Set<string>();
  const invitations: { id: string; email: string; role: OrganizationRole; status: InvitationStatus; sentAt: number; expiresAt: number }[] = [];
  for (const row of rows) {
    const email = row.email.toLowerCase();
    if (seen.has(email) || memberEmails.has(email)) continue;
    seen.add(email);
    invitations.push({
      id: row._id,
      email: row.email,
      role: parseRole(row.role ?? "member"),
      status: row.status === "rejected" ? "declined" : row.expiresAt <= now ? "expired" : "pending",
      sentAt: row.createdAt,
      expiresAt: row.expiresAt,
    });
  }
  return { invitations, livePending: pending.filter((row) => row.expiresAt > now).length };
}

async function invitationView(
  ctx: Pick<QueryCtx, "runQuery"> & { user: Doc<"user"> },
  invitation: Doc<"invitation">,
) {
  const [organization, inviter, membership] = await Promise.all([
    findById(ctx, "organization", invitation.organizationId),
    findById(ctx, "user", invitation.inviterId),
    findMembership(ctx, ctx.user._id, invitation.organizationId),
  ]);
  return {
    id: invitation._id,
    organizationName: organization?.name ?? "",
    inviterName: inviter?.name || inviter?.email || "",
    email: invitation.email,
    role: parseRole(invitation.role ?? "member"),
    emailVerified: ctx.user.emailVerified,
    alreadyMember: membership !== null,
  };
}

/** Invitations waiting for the caller's address, for the dashboard banner. */
export const myInvitations = authedQuery({
  args: {},
  handler: async (ctx) => {
    const invitations = await pendingInvitationsFor(ctx, ctx.user.email);
    const views = await Promise.all(invitations.map((invitation) => invitationView(ctx, invitation)));
    return views.filter((view) => !view.alreadyMember && view.organizationName);
  },
});

/**
 * One invitation, for the page its email links to, as the state the page shows. Only the
 * invited address learns anything about the invitation; anyone else signed in is told only
 * that it is for another account. Accepted, declined, canceled, expired and unknown
 * invitations all read as `invalid`, so the link reveals nothing once it is spent. Answers
 * any signed-in session, including one that must still verify its email or finish security
 * setup, so the page can say what is missing. `null` when signed out.
 */
export const invitation = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const pair = await identitySession(ctx);
    if (!pair || pair.session.authPurpose === "mcp-authorization") return null;
    const { user } = pair;
    const row = await findById(ctx, "invitation", args.id);
    const live = row && row.status === "pending" && row.expiresAt > Date.now();
    const recipient = row && row.email.toLowerCase() === user.email.toLowerCase();
    if (row && recipient && await findMembership(ctx, user._id, row.organizationId)) {
      const organization = await findById(ctx, "organization", row.organizationId);
      if (organization) return { state: "member" as const, organizationId: organization._id, organizationName: organization.name };
    }
    if (!live) return { state: "invalid" as const };
    if (!recipient) return { state: "wrongAccount" as const, signedInAs: user.email };
    const view = await invitationView({ ...ctx, user }, row);
    if (!view.organizationName) return { state: "invalid" as const };
    const details = { organizationName: view.organizationName, inviterName: view.inviterName, role: view.role, email: view.email };
    if (!user.emailVerified) return { state: "verify" as const, ...details };
    if (!(await evaluateSession(ctx, pair)).allowed) return { state: "security" as const, ...details };
    return { state: "open" as const, ...details };
  },
});

/**
 * Delete an invitation from the active organization's list, whatever its state: owners and
 * admins only. The list shows one row per address, so this deletes every invitation to that
 * address in the organization except accepted ones (which only record how a member joined);
 * otherwise an older declined or expired invitation would take the deleted one's place.
 * A deleted pending invitation's link then reads as no longer valid. Better Auth has no route
 * for this; it only cancels pending invitations.
 */
export const deleteInvitation = orgMutation({
  args: { invitationId: v.string() },
  handler: async (ctx, args) => {
    if (ctx.organizationRole === "member") throw new Error("NOT_ALLOWED");
    const invitation = await findById(ctx, "invitation", args.invitationId);
    if (!invitation || invitation.organizationId !== ctx.organizationId) throw new Error("INVITATION_NOT_FOUND");
    const deleted: Doc<"invitation">[] = [];
    let cursor: string | null = null;
    // Read every page before deleting: invitation history can accumulate across re-invites.
    do {
      const rows: { page: unknown[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "invitation",
        where: [{ field: "email", value: invitation.email }, { field: "organizationId", value: ctx.organizationId }],
        paginationOpts: { numItems: 100, cursor },
      });
      deleted.push(...(rows.page as Doc<"invitation">[]).filter((row) => row.status !== "accepted"));
      cursor = rows.isDone ? null : rows.continueCursor;
    } while (cursor);
    for (const row of deleted) {
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: "invitation", where: [{ field: "_id", value: row._id }] },
      });
    }
    await scheduleAuditEvent(ctx, {
      actor: ctx.user.email,
      authenticatedUserId: ctx.user._id,
      sourceDetail: "organization-mutation",
      action: "organization.invitation.deleted",
      resource: `organization:${ctx.organizationId}`,
      status: "succeeded",
      meta: JSON.stringify({ invitationIds: deleted.map((row) => row._id), statuses: deleted.map((row) => row.status) }),
    });
  },
});

/**
 * Sign-up hook: a new user starts with their own organization, on its first plan
 * (platform/docs/tenancy-and-billing.md). Platform administrators get none. In organizations mode
 * a user who signed up through an organization invitation gets only the organization they were
 * invited into. When there is a plan to choose, the user picks it before using the app.
 */
export const provisionPersonal = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await findById(ctx, "user", args.userId);
    if (!user) return null;
    if (user.role === "admin" || await ctx.runQuery(components.platform.adminInvitations.requiresEnrollment, { email: user.email })) return null;
    const mode = await readTenancyMode(ctx);
    if (mode === "organizations" && (await pendingInvitationsFor(ctx, user.email)).length > 0) return null;
    const existing = (await listMemberships(ctx, user._id)).length > 0;
    const { organizationId } = await ensurePersonalOrganization(ctx, user);
    if (!existing) {
      const organization = await findById(ctx, "organization", organizationId);
      await provisionOrganizationPlan(ctx, { id: organizationId, name: organization?.name ?? "" }, mode, actorOf(user), user._id);
    }
    return organizationId;
  },
});

/** Sign-up gate: a pending invitation admits its address even when public sign-up is off. */
export const hasPendingInvitation = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => (await pendingInvitationsFor(ctx, args.email)).length > 0,
});

/** Every membership of a user in one transaction: tests and fixtures. Account deletion runs it per organization (userDeletion.ts). */
export const removeUserMemberships = internalMutation({
  args: { userId: v.string(), email: v.string() },
  handler: async (ctx, args) => await removeMemberships(ctx, args.userId, { email: args.email, userId: args.userId }),
});

/** The rest of a deleted organization's invitations, a batch per run (`removeMembership`). */
export const deleteOrganizationInvitations = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (await deleteInvitationBatch(ctx, args.organizationId)) return;
    await ctx.scheduler.runAfter(0, internal.platform.organizations.deleteOrganizationInvitations, args);
  },
});

/**
 * The rest of a deleted organization's memberships or invitations, a batch per run
 * (`adminOrganizations.remove`). Only once the organization row is gone.
 */
export const deleteOrganizationRows = internalMutation({
  args: { organizationId: v.string(), model: v.union(v.literal("member"), v.literal("invitation")) },
  handler: async (ctx, args) => {
    if (await findById(ctx, "organization", args.organizationId)) return;
    const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model: args.model, where: [{ field: "organizationId", value: args.organizationId }] },
      paginationOpts: { cursor: null, numItems: 200 },
    });
    if (!result.isDone) await ctx.scheduler.runAfter(0, internal.platform.organizations.deleteOrganizationRows, args);
  },
});

/** New sessions start in the organization the user last switched to, if still a member. */
export const startingOrganization = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await findById(ctx, "user", args.userId);
    const last = user?.lastActiveOrganizationId;
    return last && await findMembership(ctx, args.userId, last) ? last : null;
  },
});

/** Remember the organization a user last switched to, so their next sign-in starts there. */
export const rememberActive = internalMutation({
  args: { userId: v.string(), organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!await findMembership(ctx, args.userId, args.organizationId)) return;
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "user",
        where: [{ field: "_id", value: args.userId }],
        update: { lastActiveOrganizationId: args.organizationId },
      },
    });
  },
});

/** The app's cleanup for a deleted organization's data (`organizationDataCleanup`). */
const DELETE_ORGANIZATION_DATA = "organizationData:deleteOrganizationData";
const deleteOrganizationData = makeFunctionReference<"mutation", { organizationId: string }, { done: boolean }>(DELETE_ORGANIZATION_DATA);
const CLEANUP_BATCHES_PER_RUN = 50;
/** Failed runs in a row before the cleanup stops and waits for an administrator's retry. */
export const CLEANUP_MAX_ATTEMPTS = 5;
const CLEANUP_RETRY_BASE_MS = 60_000;

/** Convex can't resolve the app's cleanup at all: the app has no `organizationData.ts`. */
export function isMissingCleanup(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return message.includes(DELETE_ORGANIZATION_DATA) && /Couldn't resolve|Could not find/i.test(message);
}

/** `startOrganizationCleanup` for Better Auth's organization-delete hook, which runs in an action. */
export const startCleanup = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => await startOrganizationCleanup(ctx, organizationId),
});

/**
 * Start (or resume) a cleanup run. `false` when it has already finished, or when the run is not
 * the row's current chain (a late run after a retry), so a duplicate or late delivery does nothing.
 */
export const beginCleanup = internalMutation({
  args: { organizationId: v.string(), runId: v.optional(v.string()) },
  handler: async (ctx, { organizationId, runId }) => {
    const row = await cleanupRow(ctx, organizationId);
    const now = Date.now();
    if (!row) {
      // A run scheduled before cleanups were recorded at deletion.
      await ctx.db.insert("organizationCleanups", { organizationId, state: "running", attempts: 0, batches: 0, startedAt: now, updatedAt: now, runId });
      return true;
    }
    if (row.state !== "running" || !isCurrentRun(row, runId)) return false;
    await ctx.db.patch(row._id, { updatedAt: now });
    return true;
  },
});

/**
 * Record what a run did and schedule what comes next, in one transaction: continue after
 * progress, retry with backoff after an error, stop as `failed` after `CLEANUP_MAX_ATTEMPTS`.
 */
export const recordCleanup = internalMutation({
  args: {
    organizationId: v.string(),
    runId: v.optional(v.string()),
    batches: v.number(),
    outcome: v.union(v.literal("progress"), v.literal("done"), v.literal("retained"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { organizationId, runId, batches, outcome, error }) => {
    const row = await cleanupRow(ctx, organizationId);
    if (!row || row.state !== "running" || !isCurrentRun(row, runId)) return;
    const now = Date.now();
    const total = row.batches + batches;
    if (outcome === "done" || outcome === "retained") {
      await ctx.db.patch(row._id, { state: outcome, batches: total, attempts: 0, lastError: undefined, updatedAt: now });
      return;
    }
    if (outcome === "progress") {
      await scheduleCleanupRun(ctx, row, 0, { batches: total, attempts: 0, updatedAt: now });
      return;
    }
    const attempts = row.attempts + 1;
    const failed = attempts >= CLEANUP_MAX_ATTEMPTS;
    const patch = { state: failed ? "failed" as const : "running" as const, batches: total, attempts, lastError: (error ?? "").slice(0, 500), updatedAt: now };
    if (failed) {
      await ctx.db.patch(row._id, patch);
      console.error(`Cleanup of deleted organization ${organizationId} failed ${attempts} times; retry it from the admin app.`);
      return;
    }
    await scheduleCleanupRun(ctx, row, CLEANUP_RETRY_BASE_MS * 2 ** (attempts - 1), patch);
  },
});

/**
 * After an organization is deleted, run the app's cleanup until it reports done. Its rows are
 * already unreachable (nobody is a member), so this only frees storage. Progress is recorded in
 * `organizationCleanups`: a failed run is retried with backoff, then left `failed` for an
 * administrator to retry (`adminOrganizations.retryCleanup`). Without the app's
 * `organizationData.ts` the data is deliberately kept (`retained`). Convex runs an action at most
 * once: a run killed before it records its outcome leaves the row `running`, reported stale
 * (`cleanupStale`) for an administrator to retry. `runId` is the chain's run token.
 */
export const deleteOrganizationAppData = internalAction({
  args: { organizationId: v.string(), runId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await ctx.runMutation(internal.platform.organizations.beginCleanup, args))) return;
    let batches = 0;
    try {
      while (batches < CLEANUP_BATCHES_PER_RUN) {
        const result = await ctx.runMutation(deleteOrganizationData, { organizationId: args.organizationId });
        batches++;
        if (result.done) {
          await ctx.runMutation(internal.platform.organizations.recordCleanup, { ...args, batches, outcome: "done" });
          return;
        }
      }
    } catch (error) {
      if (batches === 0 && isMissingCleanup(error)) {
        console.warn(`No ${DELETE_ORGANIZATION_DATA}; data of deleted organization ${args.organizationId} is kept.`);
        await ctx.runMutation(internal.platform.organizations.recordCleanup, { ...args, batches, outcome: "retained" });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.platform.organizations.recordCleanup, { ...args, batches, outcome: "error", error: message });
      return;
    }
    await ctx.runMutation(internal.platform.organizations.recordCleanup, { ...args, batches, outcome: "progress" });
  },
});
