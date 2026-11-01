/**
 * The ownership invariant: an organization that has members always has an owner, and while any
 * member can still sign in, an owner who can (is not banned).
 *
 * Better Auth's organization endpoints refuse to remove or demote the last owner, but each check
 * is a read followed by a separate write, so two owners demoting or removing each other at the
 * same moment could both pass. This guard runs inside the transaction of every membership write:
 * Better Auth's writes reach it as component triggers (`authTriggers.ts`, wired in `auth.ts`),
 * and the platform's own writes go through `deleteMember` / `setMemberRole` below, which pass the
 * same trigger handles. Convex serializes transactions that read the same members, so concurrent
 * writes cannot both leave the organization without an owner; the loser fails and rolls back.
 * Banning is the other way to lose an owner who can act: both ban paths require a successor
 * first (`successorsNeededForBan`).
 *
 * Allowed: an organization with no members at all (account deletion then deletes it), one being
 * deleted, whose members Better Auth removes before the organization row (`markDeleting`), and
 * one whose members are all banned, which needs only an owner. A write that leaves an existing
 * banned-owner-only state as it was is allowed; one that removes the last owner who can sign in
 * is not.
 */
import { createFunctionHandle } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { findById, listMemberships, listOrganizationMembers, parseRole, type OrganizationRole } from "./organizationAccess";

type Reader = Pick<QueryCtx, "runQuery">;
type Writer = Pick<MutationCtx, "runQuery" | "runMutation">;

export const OWNER_REQUIRED = "ORGANIZATION_OWNER_REQUIRED";
export const SUCCESSOR_REQUIRED = "OWNER_SUCCESSOR_REQUIRED";

/** A deletion marker only exempts the organization briefly, so a failed deletion can't leave it unguarded. */
const DELETION_WINDOW_MS = 10 * 60 * 1000;

/** A ban counts until it expires; Better Auth clears an expired ban at the next sign-in. */
export function isBanned(user: Pick<Doc<"user">, "banned" | "banExpires"> | null | undefined): boolean {
  return !!user?.banned && (!user.banExpires || user.banExpires > Date.now());
}

/** A membership with its role and whether its user can sign in (exists and is not banned). */
export type Seat = { member: Doc<"member">; role: OrganizationRole; active: boolean; user: Doc<"user"> | null };

export async function organizationSeats(ctx: Reader, organizationId: string): Promise<Seat[]> {
  const members = await listOrganizationMembers(ctx, organizationId);
  return await Promise.all(members.map(async (member) => {
    const user = await findById(ctx, "user", member.userId);
    return { member, role: parseRole(member.role), active: !!user && !isBanned(user), user };
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
  if (organization.deletingAt && organization.deletingAt > Date.now() - DELETION_WINDOW_MS) return;
  const seats = (await organizationSeats(ctx, organizationId)).filter((s) => s.member._id !== change.leaving);
  if (seats.length === 0) return;
  if (!seats.some((s) => s.role === "owner")) throw new Error(OWNER_REQUIRED);
  if (change.removedActiveOwner && seats.some((s) => s.active) && !seats.some((s) => s.active && s.role === "owner")) {
    throw new Error(OWNER_REQUIRED);
  }
}

type MemberRow = Pick<Doc<"member">, "organizationId" | "role" | "userId"> & { _id: string };

async function activeOwner(ctx: Reader, row: MemberRow): Promise<boolean> {
  return parseRole(row.role) === "owner" && !isBanned(await findById(ctx, "user", row.userId));
}

/** Better Auth's member writes, checked in their own transaction (see `authTriggers.ts`). */
export const memberTriggers = {
  onCreate: async (ctx: Reader, doc: MemberRow) => assertOrganizationHasOwner(ctx, doc.organizationId),
  onUpdate: async (ctx: Reader, doc: MemberRow, old: MemberRow) => {
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

/** Thrown, by both ban paths, while a ban would leave an organization without an owner who can act. */
export function successorRequiredMessage(needed: SuccessorNeeded[]): string {
  return `${SUCCESSOR_REQUIRED}: make another member an owner of ${needed.map((n) => n.name || n.organizationId).join(", ")} before banning this user`;
}

/** For Better Auth's `/admin/ban-user` request hook, which runs in an action. */
export const banBlockers = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await successorsNeededForBan(ctx, args.userId),
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
  await ctx.runMutation(components.betterAuth.adapter.updateOne, {
    input: { model: "organization", where: [{ field: "_id", value: organizationId }], update: { deletingAt: Date.now() } },
  });
}

/** Better Auth's `beforeDeleteOrganization` hook runs in an action, so it marks through this. */
export const markDeleting = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => await markOrganizationDeleting(ctx, args.organizationId),
});
