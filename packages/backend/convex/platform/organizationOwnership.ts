/**
 * The ownership invariant: an organization that has members always has an owner, and while any
 * member can act, an owner who can (`canActNow`: not banned, not a platform administrator, no
 * self-deletion pending).
 *
 * Better Auth's organization endpoints refuse to remove or demote the last owner, but each check
 * is a read followed by a separate write, so two owners demoting or removing each other at the
 * same moment could both pass. This guard runs inside the transaction of every membership write:
 * Better Auth's writes reach it as component triggers (`authTriggers.ts`, wired in `auth.ts`),
 * and the platform's own writes go through `deleteMember` / `setMemberRole` below, which pass the
 * same trigger handles. Convex serializes transactions that read the same members, so concurrent
 * writes cannot both leave the organization without an owner; the loser fails and rolls back.
 * Banning, or making someone a platform administrator, is the other way to lose an owner who can
 * act; unbanning (or the reverse role change) the way to gain a member who can act. Those user
 * writes are checked in their own transaction too (`userTriggers`).
 *
 * Allowed: an organization with no members at all (account deletion then deletes it), one being
 * deleted, whose members Better Auth removes before the organization row (`markDeleting`), and
 * one whose members are all banned, which needs only an owner. A write that leaves an existing
 * banned-owner-only state as it was is allowed; one that removes the last owner who can sign in
 * is not, and neither is admitting someone who can sign in where no owner can.
 *
 * Joining is checked too: nobody joins an organization that is gone or being deleted, nor
 * beyond `MAX_MEMBERSHIPS_PER_USER`.
 */
import { createFunctionHandle } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { getPolicyScopeFromRole } from "./securityPolicies";
import {
  findById,
  isDeleting,
  listMemberships,
  listOrganizationMembers,
  MAX_MEMBERSHIPS_PER_USER,
  parseRole,
  type OrganizationRole,
} from "./organizationAccess";

type Reader = Pick<QueryCtx, "runQuery" | "db">;
type Writer = Pick<MutationCtx, "runQuery" | "runMutation" | "db">;

export const OWNER_REQUIRED = "ORGANIZATION_OWNER_REQUIRED";
export const SUCCESSOR_REQUIRED = "OWNER_SUCCESSOR_REQUIRED";
export const ORGANIZATION_NOT_FOUND = "ORGANIZATION_NOT_FOUND";
export const MEMBERSHIP_LIMIT_REACHED = "MEMBERSHIP_LIMIT_REACHED";

/** A ban counts until it expires; Better Auth clears an expired ban at the next sign-in. */
export function isBanned(user: Pick<Doc<"user">, "banned" | "banExpires"> | null | undefined): boolean {
  return !!user?.banned && (!user.banExpires || user.banExpires > Date.now());
}

/**
 * Whether a user can act in organizations: they exist, aren't banned, and aren't a platform
 * administrator (administrators can't use the web app or the organization routes).
 */
export function canAct(user: Pick<Doc<"user">, "banned" | "banExpires" | "role"> | null | undefined): boolean {
  return !!user && !isBanned(user) && getPolicyScopeFromRole(user.role) !== "admin";
}

/**
 * `canAct`, and no self-deletion pending: during its grace period the user is refused on
 * organization routes (`USER_DELETION_SCHEDULED`), so they can't act for an organization either.
 */
export async function canActNow(ctx: Pick<QueryCtx, "db">, user: Doc<"user"> | null | undefined): Promise<boolean> {
  if (!user || !canAct(user)) return false;
  return !(await ctx.db.query("userDeletions").withIndex("by_user", (q) => q.eq("userId", user._id)).first());
}

/** A membership with its role and whether its user can act (`canActNow`). */
export type Seat = { member: Doc<"member">; role: OrganizationRole; active: boolean; user: Doc<"user"> | null };

export async function organizationSeats(ctx: Reader, organizationId: string): Promise<Seat[]> {
  const members = await listOrganizationMembers(ctx, organizationId);
  return await Promise.all(members.map(async (member) => {
    const user = await findById(ctx, "user", member.userId);
    return { member, role: parseRole(member.role), active: await canActNow(ctx, user), user };
  }));
}

/** Whether these members, without the departing one, need someone promoted to keep the invariant. */
export function needsSuccessor(others: Seat[]): boolean {
  if (others.length === 0) return false;
  if (!others.some((s) => s.role === "owner")) return true;
  return others.some((s) => s.active) && !others.some((s) => s.active && s.role === "owner");
}

/** The longest-standing admin, else member, preferring people who can sign in. */
export function pickSuccessor(others: Seat[]): Seat | undefined {
  const pick = (seats: Seat[]) => seats.find((s) => s.role === "admin") ?? seats.find((s) => s.role === "member");
  return pick(others.filter((s) => s.active)) ?? pick(others.filter((s) => !s.active));
}

/**
 * Throw unless the organization keeps an owner. `leaving` is a member row about to be deleted in
 * this transaction (bulk deletes run the trigger first); `removedActiveOwner` says the write took
 * away an owner who can sign in.
 */
export async function assertOrganizationHasOwner(
  ctx: Reader,
  organizationId: string,
  change: { leaving?: string; removedActiveOwner?: boolean } = {},
): Promise<void> {
  const organization = await findById(ctx, "organization", organizationId);
  if (!organization) return;
  if (isDeleting(organization)) return;
  const seats = (await organizationSeats(ctx, organizationId)).filter((s) => s.member._id !== change.leaving);
  if (seats.length === 0) return;
  if (!seats.some((s) => s.role === "owner")) throw new Error(OWNER_REQUIRED);
  if (change.removedActiveOwner && seats.some((s) => s.active) && !seats.some((s) => s.active && s.role === "owner")) {
    throw new Error(OWNER_REQUIRED);
  }
}

type MemberRow = Pick<Doc<"member">, "organizationId" | "role" | "userId"> & { _id: string };

async function activeOwner(ctx: Reader, row: MemberRow): Promise<boolean> {
  return parseRole(row.role) === "owner" && await canActNow(ctx, await findById(ctx, "user", row.userId));
}

/**
 * Why this user can't join, or `null`. Only into an organization that exists and isn't being
 * deleted, for a user who exists and is under the membership limit. An active member can't
 * join where no owner can act: nobody could manage the organization for them. `joined` says the
 * membership row is already written (in the trigger) rather than about to be.
 */
async function joinBlocker(
  ctx: Reader,
  row: { organizationId: string; userId: string; role: string },
  joined: boolean,
): Promise<string | null> {
  const organization = await findById(ctx, "organization", row.organizationId);
  if (!organization || isDeleting(organization)) return ORGANIZATION_NOT_FOUND;
  const user = await findById(ctx, "user", row.userId);
  if (!user) return "USER_NOT_FOUND";
  const memberships = (await listMemberships(ctx, row.userId)).length + (joined ? 0 : 1);
  if (memberships > MAX_MEMBERSHIPS_PER_USER) return MEMBERSHIP_LIMIT_REACHED;
  if (await ctx.runQuery(internal.platform.tenancy.membershipMode, {}) === "individuals") {
    const seats = await listOrganizationMembers(ctx, row.organizationId);
    if (memberships > 1 || seats.length + (joined ? 0 : 1) > 1) return "TENANCY_INDIVIDUALS_NOT_ALLOWED";
  }
  if (parseRole(row.role) === "owner" || !canAct(user)) return null;
  const seats = await organizationSeats(ctx, row.organizationId);
  return seats.some((s) => s.active && s.role === "owner") ? null : OWNER_REQUIRED;
}

/**
 * For Better Auth's `beforeAcceptInvitation` hook, so the invitee learns why. The member trigger
 * checks the same in the write's own transaction: Better Auth accepts the invitation and writes
 * the member in separate steps, and a deletion could commit in between.
 */
export const admissionBlocker = internalQuery({
  args: { organizationId: v.string(), userId: v.string(), role: v.string() },
  handler: async (ctx, args) => await joinBlocker(ctx, args, false),
});

/** Better Auth's member writes, checked in their own transaction (see `authTriggers.ts`). */
export const memberTriggers = {
  onCreate: async (ctx: Reader, doc: MemberRow) => {
    const blocker = await joinBlocker(ctx, doc, true);
    if (blocker) throw new Error(blocker);
    await assertOrganizationHasOwner(ctx, doc.organizationId);
  },
  onUpdate: async (ctx: Reader, doc: MemberRow, old: MemberRow) => {
    if (doc.organizationId !== old.organizationId || doc.userId !== old.userId) {
      const blocker = await joinBlocker(ctx, doc, true);
      if (blocker) throw new Error(blocker);
    }
    const demoted = parseRole(doc.role) !== "owner" || old.organizationId !== doc.organizationId;
    const removedActiveOwner = demoted && await activeOwner(ctx, old);
    await assertOrganizationHasOwner(ctx, old.organizationId, { removedActiveOwner });
    if (old.organizationId !== doc.organizationId) await assertOrganizationHasOwner(ctx, doc.organizationId);
  },
  onDelete: async (ctx: Reader, doc: MemberRow) =>
    assertOrganizationHasOwner(ctx, doc.organizationId, { leaving: doc._id, removedActiveOwner: await activeOwner(ctx, doc) }),
};

/** An organization that needs a new owner before this user can be banned, with who could take over. */
export type SuccessorNeeded = {
  organizationId: string;
  name: string;
  candidates: { userId: string; name: string; email: string; role: OrganizationRole }[];
  suggested: string | null;
};

/**
 * Organizations where this user is the only owner who can sign in while other members still can:
 * banning them would leave those members without an owner who can act.
 */
export async function successorsNeededForBan(ctx: Reader, userId: string): Promise<SuccessorNeeded[]> {
  const needed: SuccessorNeeded[] = [];
  for (const membership of await listMemberships(ctx, userId)) {
    if (parseRole(membership.role) !== "owner") continue;
    const others = (await organizationSeats(ctx, membership.organizationId)).filter((s) => s.member._id !== membership._id);
    if (!others.some((s) => s.active) || others.some((s) => s.active && s.role === "owner")) continue;
    const organization = await findById(ctx, "organization", membership.organizationId);
    const candidates = others.filter((s) => s.active);
    needed.push({
      organizationId: membership.organizationId,
      name: organization?.name ?? "",
      candidates: candidates.map((s) => ({ userId: s.member.userId, name: s.user?.name ?? "", email: s.user?.email ?? "", role: s.role })),
      suggested: pickSuccessor(candidates)?.member.userId ?? null,
    });
  }
  return needed;
}

/** Thrown while a ban or role change would leave an organization without an owner who can act. */
export function successorRequiredMessage(needed: Pick<SuccessorNeeded, "name" | "organizationId">[], change = "banning"): string {
  return `${SUCCESSOR_REQUIRED}: make another member an owner of ${needed.map((n) => n.name || n.organizationId).join(", ")} before ${change} this user`;
}

/**
 * Organizations that would have members who can act but no owner who can, once this user can act
 * again (unbanned, or no longer a platform administrator): they are not an owner there, and its
 * owners are all banned. With `assumeActive`, as if the user could act already.
 */
export async function ownersNeededForReactivation(
  ctx: Reader,
  userId: string,
  assumeActive = false,
): Promise<{ organizationId: string; name: string }[]> {
  const needed: { organizationId: string; name: string }[] = [];
  for (const membership of await listMemberships(ctx, userId)) {
    const seats = (await organizationSeats(ctx, membership.organizationId))
      .map((s) => assumeActive && s.member._id === membership._id ? { ...s, active: true } : s);
    if (!seats.some((s) => s.active) || seats.some((s) => s.active && s.role === "owner")) continue;
    const organization = await findById(ctx, "organization", membership.organizationId);
    needed.push({ organizationId: membership.organizationId, name: organization?.name ?? "" });
  }
  return needed;
}

type UserRow = Pick<Doc<"user">, "banned" | "banExpires" | "role"> & { _id: string };

/**
 * Better Auth's user writes, checked in their own transaction (see `authTriggers.ts`), whatever
 * the path: `/admin/ban-user`, `/admin/unban-user`, `/admin/set-role`, or the platform's own
 * mutations. Losing the ability to act (a ban, becoming a platform administrator) needs a
 * successor where this user is the only owner who can act; regaining it (an unban, ceasing to
 * be an administrator) must not leave members who can act without an owner who can. A ban that
 * simply expires is not a write, and the sign-in that clears it changes nothing here.
 */
export const userTriggers = {
  onUpdate: async (ctx: Reader, doc: UserRow, old: UserRow) => {
    const before = canAct(old);
    const after = canAct(doc);
    if (before && !after) {
      const needed = await successorsNeededForBan(ctx, doc._id);
      if (needed.length > 0) throw new Error(successorRequiredMessage(needed, isBanned(doc) ? "banning" : "making an administrator of"));
    } else if (!before && after) {
      const needed = await ownersNeededForReactivation(ctx, doc._id);
      if (needed.length > 0) throw new Error(successorRequiredMessage(needed, "reactivating"));
    }
  },
};

/** For Better Auth's `/admin/ban-user` request hook, which runs in an action. */
export const banBlockers = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await successorsNeededForBan(ctx, args.userId),
});

/** For the `/admin/unban-user` and `/admin/set-role` request hooks: what a change of this user's ability to act would need. */
export const statusChangeBlockers = internalQuery({
  args: { userId: v.string(), banned: v.optional(v.boolean()), role: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await findById(ctx, "user", args.userId);
    if (!user) return [];
    const next = { ...user, ...(args.banned === false ? { banned: false, banExpires: null } : {}), ...(args.role !== undefined ? { role: args.role } : {}) };
    const before = canAct(user);
    const after = canAct(next);
    if (before && !after) return (await successorsNeededForBan(ctx, args.userId)).map(({ organizationId, name }) => ({ organizationId, name }));
    if (!before && after) return await ownersNeededForReactivation(ctx, args.userId, true);
    return [];
  },
});

/** Delete one membership through the guard. Every platform membership deletion uses this. */
export async function deleteMember(ctx: Writer, memberId: string): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input: { model: "member", where: [{ field: "_id", value: memberId }] },
    onDeleteHandle: await createFunctionHandle(internal.platform.authTriggers.onDelete),
  });
}

/** Change one membership's role through the guard. Every platform role change uses this. */
export async function setMemberRole(ctx: Writer, memberId: string, role: OrganizationRole): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.updateOne, {
    input: { model: "member", where: [{ field: "_id", value: memberId }], update: { role } },
    onUpdateHandle: await createFunctionHandle(internal.platform.authTriggers.onUpdate),
  });
}

/** Exempt an organization from the guard while it is deleted (members go before the row). */
export async function markOrganizationDeleting(ctx: Writer, organizationId: string): Promise<void> {
  if (await ctx.runQuery(components.platform.billing.billingInUse, { organizationId })) throw new Error("BILLING_ORGANIZATION_IN_USE");
  await ctx.runMutation(components.betterAuth.adapter.updateOne, {
    input: { model: "organization", where: [{ field: "_id", value: organizationId }], update: { deletingAt: Date.now() } },
  });
}

/** Better Auth's `beforeDeleteOrganization` hook runs in an action, so it marks through this. */
export const markDeleting = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => await markOrganizationDeleting(ctx, args.organizationId),
});
