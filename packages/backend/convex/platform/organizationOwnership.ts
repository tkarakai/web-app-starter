import { refuse } from "@web-app-starter/convex-platform/errors";
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
import { startOrganizationCleanup } from "./organizationCleanup";
import { getPolicyScopeFromRole } from "./securityPolicies";
import {
  findById,
  findMembership,
  firstMembers,
  isDeleting,
  listMemberships,
  listOrganizationMembers,
  MAX_MEMBERSHIPS_PER_USER,
  membersWithRole,
  organizationMembers,
  otherMemberExists,
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

async function seatOf(ctx: Reader, member: Doc<"member">): Promise<Seat> {
  const user = await findById(ctx, "user", member.userId);
  return { member, role: parseRole(member.role), active: await canActNow(ctx, user), user };
}

/**
 * Every member with their user. Reads the whole organization: use it only for a listing a person
 * asked for, never in a check that runs per write or per row. The checks below read owners, and
 * other members only in order and only until they have their answer.
 */
export async function organizationSeats(ctx: Reader, organizationId: string): Promise<Seat[]> {
  return await Promise.all((await listOrganizationMembers(ctx, organizationId)).map((member) => seatOf(ctx, member)));
}

/** The organization's owners, except the membership `except` (one leaving, or the one in question). */
async function ownersExcept(ctx: Reader, organizationId: string, except?: string): Promise<Doc<"member">[]> {
  const owners: Doc<"member">[] = [];
  for await (const member of membersWithRole(ctx, organizationId, "owner")) if (member._id !== except) owners.push(member);
  return owners;
}

async function someActive(ctx: Reader, members: Doc<"member">[]): Promise<boolean> {
  for (const member of members) if ((await seatOf(ctx, member)).active) return true;
  return false;
}

/** Whether an owner of the organization can act. Reads the owners only. */
export async function hasActiveOwner(ctx: Reader, organizationId: string): Promise<boolean> {
  return await someActive(ctx, await ownersExcept(ctx, organizationId));
}

/** Whether a member other than `except`, and not an owner, can act. Stops at the first. */
async function activeNonOwnerExists(ctx: Reader, organizationId: string, except?: string): Promise<boolean> {
  for await (const member of organizationMembers(ctx, organizationId)) {
    if (member._id === except || parseRole(member.role) === "owner") continue;
    if ((await seatOf(ctx, member)).active) return true;
  }
  return false;
}

/**
 * Whether the organization, without the membership `except`, needs someone promoted to keep the
 * invariant: it has other members but no owner, or members who can act but no owner who can.
 * Reads the owners; other members only while no owner can act, and only until one can.
 */
export async function successorNeeded(ctx: Reader, organizationId: string, except: string): Promise<boolean> {
  const owners = await ownersExcept(ctx, organizationId, except);
  if (owners.length === 0) return await otherMemberExists(ctx, organizationId, except);
  if (await someActive(ctx, owners)) return false;
  return await activeNonOwnerExists(ctx, organizationId, except);
}

/**
 * The successor to the membership `except`: the longest-standing admin, else member, preferring
 * people who can act (`activeOnly`: only them). Reads admins, then members, oldest first, and
 * stops at the first who can act.
 */
export async function findSuccessor(ctx: Reader, organizationId: string, except: string, activeOnly = false): Promise<Seat | undefined> {
  let fallback: Seat | undefined;
  for (const role of ["admin", "member"] as const) {
    for await (const member of membersWithRole(ctx, organizationId, role)) {
      if (member._id === except) continue;
      const seat = await seatOf(ctx, member);
      if (seat.active) return seat;
      fallback ??= seat;
    }
  }
  return activeOnly ? undefined : fallback;
}

/**
 * Members other than `except` and its owners who can act, oldest admins first, at most `limit`:
 * whom an administrator may choose as a successor (`banSuccessor`).
 */
async function activeCandidates(ctx: Reader, organizationId: string, except: string, limit: number): Promise<Seat[]> {
  const found: Seat[] = [];
  for (const role of ["admin", "member"] as const) {
    for await (const member of membersWithRole(ctx, organizationId, role)) {
      if (found.length >= limit) return found;
      if (member._id === except) continue;
      const seat = await seatOf(ctx, member);
      if (seat.active) found.push(seat);
    }
  }
  return found;
}

/**
 * Throw unless the organization keeps an owner. `leaving` is a member row about to be deleted in
 * this transaction (bulk deletes run the trigger first); `removedActiveOwner` says the write took
 * away an owner who can sign in. Reads the owners; other members only when that owner was the
 * last one who could act.
 */
export async function assertOrganizationHasOwner(
  ctx: Reader,
  organizationId: string,
  change: { leaving?: string; removedActiveOwner?: boolean } = {},
): Promise<void> {
  const organization = await findById(ctx, "organization", organizationId);
  if (!organization) return;
  if (isDeleting(organization)) return;
  const owners = await ownersExcept(ctx, organizationId, change.leaving);
  if (owners.length === 0) {
    if (await otherMemberExists(ctx, organizationId, change.leaving)) refuse(OWNER_REQUIRED);
    return;
  }
  if (change.removedActiveOwner && !(await someActive(ctx, owners)) && await activeNonOwnerExists(ctx, organizationId, change.leaving)) {
    refuse(OWNER_REQUIRED);
  }
}

type MemberRow = Pick<Doc<"member">, "organizationId" | "role" | "userId"> & { _id: string };

async function activeOwner(ctx: Reader, row: MemberRow): Promise<boolean> {
  return parseRole(row.role) === "owner" && await canActNow(ctx, await findById(ctx, "user", row.userId));
}

/**
 * Why this user can't join, or `null`. Only into an organization that exists and isn't being
 * deleted, for a user who exists and is under the membership limit. Nobody joins an
 * organization without an owner, and an active member can't join where no owner can act: nobody
 * could manage the organization for them. `joined` says the membership row is already written
 * (in the trigger) rather than about to be. Reads the owners, never the other members.
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
    const seats = (await firstMembers(ctx, row.organizationId, 2)).length;
    if (memberships > 1 || seats + (joined ? 0 : 1) > 1) return "TENANCY_INDIVIDUALS_NOT_ALLOWED";
  }
  if (parseRole(row.role) === "owner") return null;
  const owners = await ownersExcept(ctx, row.organizationId);
  if (owners.length === 0) return OWNER_REQUIRED;
  return !canAct(user) || await someActive(ctx, owners) ? null : OWNER_REQUIRED;
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

/** Invalidate a preflight if its inputs change before configuration commits. Writing the same
 * progress row as runCheck also makes concurrent scan batches retry against this invalidation. */
export async function invalidateTenancyCheck(ctx: Pick<MutationCtx, "db">): Promise<void> {
  if (await ctx.db.query("tenancySetups").first()) return;
  const check = await ctx.db.query("tenancyChecks").order("desc").first();
  if (check && check.state !== "failed") {
    await ctx.db.patch(check._id, { state: "failed", error: "TENANCY_CHECK_CHANGED", updatedAt: Date.now() });
  }
}

/** Empty organizations also affect the preflight's organization count. */
export const organizationTriggers = {
  onCreate: invalidateTenancyCheck,
  onDelete: async (ctx: MutationCtx, doc: { _id: string }) => {
    await invalidateTenancyCheck(ctx);
    await startOrganizationCleanup(ctx, doc._id);
  },
};

/**
 * Better Auth's member writes, checked in their own transaction (see `authTriggers.ts`). Each
 * reads the organization's owners (and their users), not its members: a write's cost doesn't
 * grow with the organization. A new member who isn't an owner can't remove one, so creating
 * needs only `joinBlocker`.
 */
export const memberTriggers = {
  onCreate: async (ctx: Writer, doc: MemberRow) => {
    await invalidateTenancyCheck(ctx);
    const blocker = await joinBlocker(ctx, doc, true);
    if (blocker) refuse(blocker);
  },
  onUpdate: async (ctx: Writer, doc: MemberRow, old: MemberRow) => {
    await invalidateTenancyCheck(ctx);
    if (doc.organizationId !== old.organizationId || doc.userId !== old.userId) {
      const blocker = await joinBlocker(ctx, doc, true);
      if (blocker) refuse(blocker);
    }
    const demoted = parseRole(doc.role) !== "owner" || old.organizationId !== doc.organizationId;
    const removedActiveOwner = demoted && await activeOwner(ctx, old);
    await assertOrganizationHasOwner(ctx, old.organizationId, { removedActiveOwner });
    if (old.organizationId !== doc.organizationId) await assertOrganizationHasOwner(ctx, doc.organizationId);
  },
  onDelete: async (ctx: Writer, doc: MemberRow) => {
    await invalidateTenancyCheck(ctx);
    await assertOrganizationHasOwner(ctx, doc.organizationId, { leaving: doc._id, removedActiveOwner: await activeOwner(ctx, doc) });
  },
};

type Candidate = { userId: string; name: string; email: string; role: OrganizationRole };

/** An organization that needs a new owner before this user can be banned, with who could take over. */
export type SuccessorNeeded = {
  organizationId: string;
  name: string;
  /** Members who can act, oldest admins first, at most `MAX_SUCCESSOR_CANDIDATES` (empty unless asked for). */
  candidates: Candidate[];
  /** More members could take over than `candidates` lists. */
  moreCandidates: boolean;
  suggested: string | null;
};

/** Candidates listed per organization; any member who can act is accepted as a successor. */
export const MAX_SUCCESSOR_CANDIDATES = 10;

/**
 * Whether banning the owner `membership` needs a successor in its organization (it is the only
 * owner who can act while other members can), and if so who. Reads the owners, then admins and
 * members only until the first who can act, plus the listed candidates when asked for.
 */
export async function successorNeededForBan(
  ctx: Reader,
  membership: Doc<"member">,
  options: { candidates?: boolean } = {},
): Promise<SuccessorNeeded | null> {
  if (parseRole(membership.role) !== "owner") return null;
  if (await someActive(ctx, await ownersExcept(ctx, membership.organizationId, membership._id))) return null;
  const suggested = await findSuccessor(ctx, membership.organizationId, membership._id, true);
  if (!suggested) return null;
  const organization = await findById(ctx, "organization", membership.organizationId);
  const listed = options.candidates ? await activeCandidates(ctx, membership.organizationId, membership._id, MAX_SUCCESSOR_CANDIDATES + 1) : [];
  return {
    organizationId: membership.organizationId,
    name: organization?.name ?? "",
    candidates: listed.slice(0, MAX_SUCCESSOR_CANDIDATES).map((s) => ({ userId: s.member.userId, name: s.user?.name ?? "", email: s.user?.email ?? "", role: s.role })),
    moreCandidates: listed.length > MAX_SUCCESSOR_CANDIDATES,
    suggested: suggested.member.userId,
  };
}

/**
 * Organizations where this user is the only owner who can sign in while other members still can:
 * banning them would leave those members without an owner who can act. `candidates` lists who
 * could take over (for a person choosing); checks leave it out.
 */
export async function successorsNeededForBan(ctx: Reader, userId: string, options: { candidates?: boolean } = {}): Promise<SuccessorNeeded[]> {
  const needed: SuccessorNeeded[] = [];
  for (const membership of await listMemberships(ctx, userId)) {
    const need = await successorNeededForBan(ctx, membership, options);
    if (need) needed.push(need);
  }
  return needed;
}

/**
 * Whether `userId` could take over from the departing owner in this organization: another
 * member who isn't an owner and can act. What `candidates` lists, checked for one user.
 */
export async function isSuccessorCandidate(ctx: Reader, organizationId: string, userId: string, departingUserId: string): Promise<boolean> {
  if (userId === departingUserId) return false;
  const member = await findMembership(ctx, userId, organizationId);
  if (!member || parseRole(member.role) === "owner") return false;
  return (await seatOf(ctx, member)).active;
}

/** Thrown while a ban or role change would leave an organization without an owner who can act. */
export function successorRequiredMessage(needed: Pick<SuccessorNeeded, "name" | "organizationId">[], change = "banning"): string {
  return `${SUCCESSOR_REQUIRED}: make another member an owner of ${needed.map((n) => n.name || n.organizationId).join(", ")} before ${change} this user`;
}

/**
 * Organizations that would have members who can act but no owner who can, once this user can act
 * again (unbanned, or no longer a platform administrator): they are not an owner there, and its
 * owners are all banned. With `assumeActive`, as if the user could act already. Reads each
 * organization's owners; other members only where no owner can act and this user can't either.
 */
export async function ownersNeededForReactivation(
  ctx: Reader,
  userId: string,
  assumeActive = false,
): Promise<{ organizationId: string; name: string }[]> {
  const needed: { organizationId: string; name: string }[] = [];
  const user = assumeActive ? null : await findById(ctx, "user", userId);
  const selfActive = assumeActive || await canActNow(ctx, user);
  for (const membership of await listMemberships(ctx, userId)) {
    const selfOwner = parseRole(membership.role) === "owner";
    if (selfOwner && selfActive) continue;
    if (await someActive(ctx, await ownersExcept(ctx, membership.organizationId, membership._id))) continue;
    if (!selfActive && !(await activeNonOwnerExists(ctx, membership.organizationId, membership._id))) continue;
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
  onCreate: invalidateTenancyCheck,
  onDelete: invalidateTenancyCheck,
  onUpdate: async (ctx: Writer, doc: UserRow, old: UserRow) => {
    await invalidateTenancyCheck(ctx);
    const before = canAct(old);
    const after = canAct(doc);
    if (before && !after) {
      const needed = await successorsNeededForBan(ctx, doc._id);
      if (needed.length > 0) refuse("OWNER_SUCCESSOR_REQUIRED", { organizations: needed.map(({ organizationId, name }) => ({ organizationId, name })), message: successorRequiredMessage(needed, isBanned(doc) ? "banning" : "making an administrator of") });
    } else if (!before && after) {
      const needed = await ownersNeededForReactivation(ctx, doc._id);
      if (needed.length > 0) refuse("OWNER_SUCCESSOR_REQUIRED", { organizations: needed.map(({ organizationId, name }) => ({ organizationId, name })), message: successorRequiredMessage(needed, "reactivating") });
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
  if (await ctx.runQuery(components.platform.billing.billingInUse, { organizationId })) refuse("BILLING_ORGANIZATION_IN_USE");
  await ctx.runMutation(components.betterAuth.adapter.updateOne, {
    input: { model: "organization", where: [{ field: "_id", value: organizationId }], update: { deletingAt: Date.now() } },
  });
}

/** Better Auth's `beforeDeleteOrganization` hook runs in an action, so it marks through this. */
export const markDeleting = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => await markOrganizationDeleting(ctx, args.organizationId),
});
