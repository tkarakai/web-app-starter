/**
 * The ownership invariant: an organization that has members always has an owner.
 *
 * Better Auth's organization endpoints refuse to remove or demote the last owner, but each check
 * is a read followed by a separate write, so two owners demoting or removing each other at the
 * same moment could both pass. This guard runs inside the transaction of every membership write:
 * Better Auth's writes reach it as component triggers (`authTriggers.ts`, wired in `auth.ts`),
 * and the platform's own writes go through `deleteMember` / `setMemberRole` below, which pass the
 * same trigger handles. Convex serializes transactions that read the same members, so concurrent
 * writes cannot both leave the organization without an owner; the loser fails and rolls back.
 *
 * Two states are allowed: an organization with no members at all (its last account was deleted;
 * account deletion then deletes the organization), and an organization being deleted, whose
 * members Better Auth removes before the organization row (`markDeleting`).
 */
import { createFunctionHandle } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { findById, listOrganizationMembers, parseRole, type OrganizationRole } from "./organizationAccess";

type Reader = Pick<QueryCtx, "runQuery">;
type Writer = Pick<MutationCtx, "runQuery" | "runMutation">;

export const OWNER_REQUIRED = "ORGANIZATION_OWNER_REQUIRED";

/** A deletion marker only exempts the organization briefly, so a failed deletion can't leave it unguarded. */
const DELETION_WINDOW_MS = 10 * 60 * 1000;

/**
 * Throw unless the organization still has an owner among its members. `leaving` is a member
 * row that is about to be deleted in this transaction (bulk deletes run the trigger first).
 */
export async function assertOrganizationHasOwner(ctx: Reader, organizationId: string, leaving?: string): Promise<void> {
  const organization = await findById(ctx, "organization", organizationId);
  if (!organization) return;
  if (organization.deletingAt && organization.deletingAt > Date.now() - DELETION_WINDOW_MS) return;
  const members = (await listOrganizationMembers(ctx, organizationId)).filter((m) => m._id !== leaving);
  if (members.length > 0 && !members.some((m) => parseRole(m.role) === "owner")) throw new Error(OWNER_REQUIRED);
}

type MemberRow = Pick<Doc<"member">, "organizationId" | "role"> & { _id: string };

/** Better Auth's member writes, checked in their own transaction (see `authTriggers.ts`). */
export const memberTriggers = {
  onCreate: async (ctx: Reader, doc: MemberRow) => assertOrganizationHasOwner(ctx, doc.organizationId),
  onUpdate: async (ctx: Reader, doc: MemberRow, old: MemberRow) => {
    await assertOrganizationHasOwner(ctx, doc.organizationId);
    if (old.organizationId !== doc.organizationId) await assertOrganizationHasOwner(ctx, old.organizationId);
  },
  onDelete: async (ctx: Reader, doc: MemberRow) => assertOrganizationHasOwner(ctx, doc.organizationId, doc._id),
};

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
