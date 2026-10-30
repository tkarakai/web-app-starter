/**
 * Organization reads for the UI: `api.platform.organizations.*`.
 *
 * These are reactive Convex queries over the Better Auth component's organization rows.
 * Every change (create, rename, invite, accept, remove, role change, switch) goes through
 * Better Auth's `/organization/*` endpoints (`authClient.organization.*`), which enforce
 * the roles; these queries update by themselves when those rows change.
 */
import { v } from "convex/values";

import { components } from "../_generated/api";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { authedMutation, authedQuery, orgQuery } from "./functions";
import {
  ensurePersonalOrganization,
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
    let invitations: { id: string; email: string; role: OrganizationRole; expiresAt: number; expired: boolean }[] = [];
    if (canManage) {
      const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "invitation",
        where: [
          { field: "organizationId", value: ctx.organizationId },
          { field: "status", value: "pending" },
        ],
        paginationOpts: { numItems: 200, cursor: null },
      });
      const now = Date.now();
      invitations = (result.page as Doc<"invitation">[])
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((invitation) => ({
          id: invitation._id,
          email: invitation.email,
          role: parseRole(invitation.role ?? "member"),
          expiresAt: invitation.expiresAt,
          expired: invitation.expiresAt <= now,
        }));
    }

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
    status: invitation.status,
    expired: invitation.expiresAt <= Date.now(),
    isRecipient: invitation.email.toLowerCase() === ctx.user.email.toLowerCase(),
    signedInAs: ctx.user.email,
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
 * One invitation, for the page its email links to. The link carries the invitation ID,
 * so anyone signed in who holds it sees whom it is for; only that address can accept it.
 */
export const invitation = authedQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const row = await findById(ctx, "invitation", args.id);
    return row ? await invitationView(ctx, row) : null;
  },
});

/**
 * Give a signed-in user with no organization a personal one. The protected layout calls
 * this when `mine` comes back empty: after an upgrade (before the data migration reaches
 * them), for accounts created outside sign-up, or after leaving every organization.
 */
export const ensure = authedMutation({
  args: {},
  handler: async (ctx) => {
    return (await ensurePersonalOrganization(ctx, ctx.user)).organizationId;
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

/**
 * Account deletion: drop the user's memberships. An organization that would be left with
 * members but no owner passes ownership to its longest-standing remaining member, so it
 * always stays administrable.
 */
export const removeUserMemberships = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    for (const member of await listMemberships(ctx, args.userId)) {
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: "member", where: [{ field: "_id", value: member._id }] },
      });
      if (parseRole(member.role) !== "owner") continue;
      const remaining = await listOrganizationMembers(ctx, member.organizationId);
      if (remaining.length === 0 || remaining.some((m) => parseRole(m.role) === "owner")) continue;
      const successor = remaining.find((m) => parseRole(m.role) === "admin") ?? remaining[0];
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: { model: "member", where: [{ field: "_id", value: successor._id }], update: { role: "owner" } },
      });
    }
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
