/**
 * Platform-administrator view and support actions over every organization: the admin app's
 * Organizations page and the `organizations_*` agent capabilities share these functions.
 *
 * Administrators see organization metadata, members and invitations, never the organization's
 * app data. Their actions are limited to support: transfer ownership, cancel invitations and
 * delete an organization. Every write keeps the organization owned (organizationOwnership.ts)
 * and is audited as `admin.organization.*`.
 */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { components, internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { adminMutation, authedQuery } from "./functions";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { findById, findMembership, listMemberships, listOrganizationMembers, parseRole } from "./organizationAccess";
import { canAct, isBanned, markOrganizationDeleting, needsSuccessor, organizationSeats, pickSuccessor, setMemberRole, successorsNeededForBan } from "./organizationOwnership";
import { organizationInvitations } from "./organizations";

type Reader = Pick<QueryCtx, "runQuery">;
type AdminCtx = Pick<MutationCtx, "runQuery" | "runMutation" | "scheduler"> & { user: Doc<"user">; ownerId: string };

function requireAdmin(user: Doc<"user">) {
  if (user.role !== "admin") throw new Error("NOT_ADMIN");
}

async function target(ctx: Reader, organizationId: string) {
  const organization = await findById(ctx, "organization", organizationId);
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
  return organization;
}

async function membersWithUsers(ctx: Reader, organizationId: string) {
  const rows = await listOrganizationMembers(ctx, organizationId);
  return await Promise.all(rows.map(async (member) => {
    const user = await findById(ctx, "user", member.userId);
    return {
      memberId: member._id,
      userId: member.userId,
      name: user?.name ?? "",
      email: user?.email ?? "",
      role: parseRole(member.role),
      joinedAt: member.createdAt,
      banned: isBanned(user),
    };
  }));
}

async function summary(ctx: Reader, organization: Doc<"organization">) {
  const members = await membersWithUsers(ctx, organization._id);
  const pending = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "invitation",
    where: [{ field: "organizationId", value: organization._id }, { field: "status", value: "pending" }],
    paginationOpts: { numItems: 200, cursor: null },
  });
  const now = Date.now();
  return {
    id: organization._id,
    name: organization.name,
    createdAt: organization.createdAt,
    memberCount: members.length,
    owners: members.filter((m) => m.role === "owner").map(({ userId, name, email, banned }) => ({ userId, name, email, banned })),
    pendingInvitations: (pending.page as Doc<"invitation">[]).filter((row) => row.expiresAt > now).length,
  };
}

/** Every organization, newest first, with owners and counts. `search` matches the name (case-sensitive, native adapter semantics). */
export const list = authedQuery({
  args: { paginationOpts: paginationOptsValidator, search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user);
    if (args.paginationOpts.numItems > 100) throw new Error("INVALID_PAGE_SIZE");
    const search = args.search?.trim();
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "organization",
      paginationOpts: args.paginationOpts,
      where: search ? [{ field: "name", operator: "contains", value: search }] : [],
      sortBy: { field: "createdAt", direction: "desc" },
    });
    return { ...result, page: await Promise.all((result.page as Doc<"organization">[]).map((row) => summary(ctx, row))) };
  },
});

/** One organization: members with roles, and its pending, expired and recently declined invitations. */
export const get = authedQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    requireAdmin(ctx.user);
    const organization = await target(ctx, organizationId);
    const members = await membersWithUsers(ctx, organizationId);
    const invitations = await organizationInvitations(ctx, organizationId, new Set(members.map((m) => m.email.toLowerCase())));
    return { ...(await summary(ctx, organization)), members, invitations };
  },
});

/**
 * A user's memberships; what deleting the account would do to each organization (hand ownership
 * to a successor, or delete an organization the user is the only member of); and which
 * organizations need a new owner before the user can be banned, with who could take over.
 */
export const forUser = authedQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    requireAdmin(ctx.user);
    const memberships = await listMemberships(ctx, userId);
    const banBlockers = new Map((await successorsNeededForBan(ctx, userId)).map((n) => [n.organizationId, n]));
    return await Promise.all(memberships.map(async (membership) => {
      const organization = await findById(ctx, "organization", membership.organizationId);
      const seats = await organizationSeats(ctx, membership.organizationId);
      const others = seats.filter((s) => s.member._id !== membership._id);
      const role = parseRole(membership.role);
      const successor = role === "owner" && needsSuccessor(others) ? pickSuccessor(others) : undefined;
      const onBan = banBlockers.get(membership.organizationId);
      return {
        organizationId: membership.organizationId,
        name: organization?.name ?? "",
        role,
        memberCount: seats.length,
        soleOwner: role === "owner" && !others.some((s) => s.role === "owner"),
        onAccountDeletion: others.length === 0 ? "organizationDeleted" as const : successor ? "ownershipPasses" as const : "membershipRemoved" as const,
        successor: successor ? { userId: successor.member.userId, name: successor.user?.name ?? "", email: successor.user?.email ?? "" } : null,
        /** Present when banning needs a new owner here first: choose one of `candidates`. */
        banSuccessor: onBan ? { candidates: onBan.candidates, suggested: onBan.suggested } : null,
      };
    }));
  },
});

async function audit(ctx: AdminCtx, action: "admin.organization.owner_added" | "admin.organization.owner_removed" | "admin.organization.invitation_canceled" | "admin.organization.deleted", organizationId: string, meta?: Record<string, string>, values?: { oldValue: string; newValue: string }) {
  await scheduleAuditEvent(ctx, {
    actor: ctx.user.email,
    authenticatedUserId: ctx.ownerId,
    sourceDetail: "admin-organizations",
    action,
    resource: `organization:${organizationId}`,
    status: "succeeded",
    meta: meta ? JSON.stringify(meta) : undefined,
    ...values,
  });
}

async function memberOf(ctx: Reader, organizationId: string, userId: string) {
  await target(ctx, organizationId);
  const member = await findMembership(ctx, userId, organizationId);
  if (!member) throw new Error("MEMBER_NOT_FOUND");
  return member;
}

/**
 * Make an existing member an owner, alongside any current owners. A banned member, or a platform
 * administrator, can't be made an owner: owners must be able to act for the organization.
 * Shared with `agentUsers`.
 */
export async function promoteToOwner(ctx: AdminCtx, organizationId: string, userId: string, meta: Record<string, string> = {}) {
  const member = await memberOf(ctx, organizationId, userId);
  const previous = parseRole(member.role);
  if (previous === "owner") return;
  const user = await findById(ctx, "user", userId);
  if (isBanned(user)) throw new Error("MEMBER_BANNED");
  if (!canAct(user)) throw new Error("MEMBER_IS_ADMINISTRATOR");
  await setMemberRole(ctx, member._id, "owner");
  await audit(ctx, "admin.organization.owner_added", organizationId, { userId, ...meta }, { oldValue: previous, newValue: "owner" });
}

export const addOwner = adminMutation({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => await promoteToOwner(ctx, organizationId, userId),
});

/**
 * Make an owner an admin or member. Refused for the organization's only owner, and for its only
 * owner who isn't banned while members can sign in: add another owner first. Together with `addOwner` this transfers ownership.
 */
export const removeOwner = adminMutation({
  args: { organizationId: v.string(), userId: v.string(), role: v.union(v.literal("admin"), v.literal("member")) },
  handler: async (ctx, { organizationId, userId, role }) => {
    const member = await memberOf(ctx, organizationId, userId);
    if (parseRole(member.role) !== "owner") throw new Error("NOT_AN_OWNER");
    const others = (await organizationSeats(ctx, organizationId)).filter((s) => s.member._id !== member._id);
    if (!others.some((s) => s.role === "owner")) throw new Error("LAST_OWNER");
    const active = canAct(await findById(ctx, "user", userId));
    if (active && others.some((s) => s.active) && !others.some((s) => s.active && s.role === "owner")) throw new Error("LAST_OWNER");
    await setMemberRole(ctx, member._id, role);
    await audit(ctx, "admin.organization.owner_removed", organizationId, { userId }, { oldValue: "owner", newValue: role });
  },
});

/** Cancel a pending invitation; its link then reads as no longer valid. */
export const cancelInvitation = adminMutation({
  args: { invitationId: v.string() },
  handler: async (ctx, { invitationId }) => {
    const invitation = await findById(ctx, "invitation", invitationId);
    if (!invitation) throw new Error("INVITATION_NOT_FOUND");
    if (invitation.status !== "pending") throw new Error("INVITATION_NOT_PENDING");
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: { model: "invitation", where: [{ field: "_id", value: invitationId }], update: { status: "canceled" } },
    });
    await audit(ctx, "admin.organization.invitation_canceled", invitation.organizationId, { invitationId });
  },
});

async function deleteAll(ctx: AdminCtx, model: "member" | "invitation", organizationId: string) {
  // Memberships and invitations are capped well below this (organizationPlugin.ts limits).
  for (let i = 0; i < 20; i++) {
    const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model, where: [{ field: "organizationId", value: organizationId }] },
      paginationOpts: { cursor: null, numItems: 100 },
    });
    if (result.isDone) return;
  }
  throw new Error("TOO_MANY_ORGANIZATION_RECORDS");
}

/**
 * Delete an organization, as its owner could: memberships, invitations and the organization in
 * one transaction, then the app's own data through `organizationData.ts`. Accounts are kept;
 * members whose session was in it continue in another of their organizations, or none.
 */
export const remove = adminMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    const organization = await target(ctx, organizationId);
    await markOrganizationDeleting(ctx, organizationId);
    await deleteAll(ctx, "member", organizationId);
    await deleteAll(ctx, "invitation", organizationId);
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "organization", where: [{ field: "_id", value: organizationId }] },
    });
    await ctx.scheduler.runAfter(0, internal.platform.organizations.deleteOrganizationAppData, { organizationId });
    await audit(ctx, "admin.organization.deleted", organizationId, { name: organization.name });
  },
});
