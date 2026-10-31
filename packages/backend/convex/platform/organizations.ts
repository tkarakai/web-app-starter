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
import type { Doc } from "./betterAuth/_generated/dataModel";
import { evaluateSession, identitySession } from "./sessionPolicy";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { authedQuery, orgMutation, orgQuery } from "./functions";
import {
  ensurePersonalOrganization,
  removeMemberships,
  findById,
  findMembership,
  listMemberships,
  listOrganizationMembers,
  parseRole,
  pendingInvitationsFor,
  resolveActiveOrganization,
  type OrganizationRole,
} from "./organizationAccess";

function present<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** The organizations the caller belongs to, and which one is active. Drives the switcher. */
export const mine = authedQuery({
  args: {},
  handler: async (ctx) => {
    const [memberships, active] = await Promise.all([
      listMemberships(ctx, ctx.user._id),
      resolveActiveOrganization(ctx, ctx.user, ctx.session),
    ]);
    const organizations = await Promise.all(memberships.map(async (member) => {
      const organization = await findById(ctx, "organization", member.organizationId);
      return organization && { id: organization._id, name: organization.name, role: parseRole(member.role) };
    }));
    return {
      activeOrganizationId: active?.organizationId ?? null,
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
      ? await organizationInvitations(ctx, ctx.organizationId, new Set(members.map((member) => member.email.toLowerCase())))
      : [];

    return {
      id: organization._id,
      name: organization.name,
      role: ctx.organizationRole,
      memberCount: members.length,
      members,
      invitations,
    };
  },
});

/** How long a declined invitation stays listed for the people who manage the organization. */
const DECLINED_LISTED_MS = 30 * 24 * 60 * 60 * 1000;

export type InvitationStatus = "pending" | "expired" | "declined";

/**
 * The organization's invitations for its owners and admins: pending ones, expired ones still
 * pending, and recently declined ones, so the inviter sees what became of each. One row per
 * address (the latest), leaving out anyone who has since joined.
 */
async function organizationInvitations(ctx: Pick<QueryCtx, "runQuery">, organizationId: string, memberEmails: Set<string>) {
  const byStatus = async (status: string) => (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "invitation",
    where: [{ field: "organizationId", value: organizationId }, { field: "status", value: status }],
    paginationOpts: { numItems: 200, cursor: null },
  })).page as Doc<"invitation">[];
  const now = Date.now();
  const rows = [...await byStatus("pending"), ...(await byStatus("rejected")).filter((row) => row.createdAt > now - DECLINED_LISTED_MS)]
    .sort((a, b) => b.createdAt - a.createdAt);
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
  return invitations;
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

/** Sign-up hook: every new account starts with its own organization. */
export const provisionPersonal = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await findById(ctx, "user", args.userId);
    if (!user) return null;
    return (await ensurePersonalOrganization(ctx, user)).organizationId;
  },
});

/** Sign-up gate: a pending invitation admits its address even when public sign-up is off. */
export const hasPendingInvitation = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => (await pendingInvitationsFor(ctx, args.email)).length > 0,
});

/** Account deletion through Better Auth (`databaseHooks.user.delete`). */
export const removeUserMemberships = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => await removeMemberships(ctx, args.userId),
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
const deleteOrganizationData = makeFunctionReference<"mutation", { organizationId: string }, { done: boolean }>(
  "organizationData:deleteOrganizationData",
);
const CLEANUP_BATCHES_PER_RUN = 50;

/**
 * After an organization is deleted, run the app's cleanup until it reports done. Its rows are
 * already unreachable (nobody is a member), so this only frees storage. Without the app's
 * `organizationData.ts` there is nothing to run.
 */
export const deleteOrganizationAppData = internalAction({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    for (let batch = 0; batch < CLEANUP_BATCHES_PER_RUN; batch++) {
      let result: { done: boolean };
      try {
        result = await ctx.runMutation(deleteOrganizationData, args);
      } catch (error) {
        // The app has no organizationData.ts: Convex can't resolve the function.
        if (error instanceof Error && /Couldn't resolve|Could not find/i.test(error.message)) {
          console.warn(`No organizationData:deleteOrganizationData; data of deleted organization ${args.organizationId} is kept.`);
          return;
        }
        throw error;
      }
      if (result.done) return;
    }
    await ctx.scheduler.runAfter(0, internal.platform.organizations.deleteOrganizationAppData, args);
  },
});
