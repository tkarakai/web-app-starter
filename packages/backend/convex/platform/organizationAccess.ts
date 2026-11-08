/**
 * Organization membership reads and the one rule that picks the caller's organization.
 *
 * Organizations, members and invitations are Better Auth organization-plugin rows in the
 * Better Auth component. Writes go through Better Auth's endpoints, which check roles;
 * this file only reads them, plus `ensurePersonalOrganization`, which gives a user with
 * no membership their initial organization at sign-up, and `removeMembership`, which
 * account deletion runs per organization. Membership writes keep every organization owned
 * (organizationOwnership.ts). See platform/docs/organizations.md.
 */
import { components, internal } from "../_generated/api";
import { createFunctionHandle, type PaginationResult } from "convex/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { deleteMember, findSuccessor, setMemberRole, successorNeeded } from "./organizationOwnership";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { startOrganizationCleanup } from "./organizationCleanup";

type Reader = Pick<QueryCtx, "runQuery">;
type Writer = Pick<MutationCtx, "runQuery" | "runMutation">;
type Deleter = Writer & Pick<MutationCtx, "scheduler" | "db">;

export type OrganizationRole = "owner" | "admin" | "member";

/** Added to `ctx` by `orgQuery` and `orgMutation`. */
export type ActiveOrganization = {
  /** The organization every read and write in this request belongs to. */
  organizationId: string;
  /** The caller's role in it. */
  organizationRole: OrganizationRole;
};

/** Page size for reading component rows; readers that decide anything read every page. */
const MAX_ROWS = 200;

/**
 * How long an invitation stays valid. Better Auth sets `expiresAt` to this long after every
 * send, both the first invite and each resend (organizationPlugin.ts), so `expiresAt` minus
 * this is when the invitation was last sent.
 */
export const INVITATION_EXPIRY_DAYS = 7;
export const INVITATION_EXPIRY_MS = INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/**
 * Organizations one user may belong to. Better Auth's `organizationLimit` counts only the ones a
 * user creates; the member trigger (organizationOwnership.ts) applies this to joining as well.
 */
export const MAX_MEMBERSHIPS_PER_USER = 50;

/** A deletion marker only exempts the organization briefly, so a failed deletion can't leave it unguarded. */
const DELETION_WINDOW_MS = 10 * 60 * 1000;

/** Whether an organization is being deleted (Better Auth removes its members before its row). */
export function isDeleting(organization: Pick<Doc<"organization">, "deletingAt">): boolean {
  return !!organization.deletingAt && organization.deletingAt > Date.now() - DELETION_WINDOW_MS;
}

/** Every row of a component query, page by page: safety decisions must not see only the first page. */
async function findAll<T>(ctx: Reader, model: "member", where: { field: string; value: string }[]): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const result: { page: unknown[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model,
      where,
      paginationOpts: { numItems: MAX_ROWS, cursor },
    });
    rows.push(...(result.page as T[]));
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return rows;
}

/** Better Auth stores roles as a comma-separated list; the platform uses one built-in role. */
export function parseRole(role: string): OrganizationRole {
  const roles = role.split(",").map((r) => r.trim());
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}

/** Ties within a millisecond fall back to Convex's sub-millisecond creation time. */
function oldestFirst(a: Doc<"member">, b: Doc<"member">): number {
  return a.createdAt - b.createdAt || a._creationTime - b._creationTime;
}

/** All of the user's memberships, oldest first. */
export async function listMemberships(ctx: Reader, userId: string): Promise<Doc<"member">[]> {
  return (await findAll<Doc<"member">>(ctx, "member", [{ field: "userId", value: userId }])).sort(oldestFirst);
}

/** All of the organization's members, oldest first. */
export async function listOrganizationMembers(ctx: Reader, organizationId: string): Promise<Doc<"member">[]> {
  return (await findAll<Doc<"member">>(ctx, "member", [{ field: "organizationId", value: organizationId }])).sort(oldestFirst);
}

type MemberWhere = { field: "organizationId" | "role" | "userId"; value: string }[];

/** Member rows, a page at a time, so a caller that has its answer stops reading. */
async function* memberRows(ctx: Reader, where: MemberWhere, pageSize: number): AsyncGenerator<Doc<"member">> {
  let cursor: string | null = null;
  do {
    const result: { page: unknown[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "member",
      where,
      paginationOpts: { numItems: pageSize, cursor },
    });
    for (const row of result.page as Doc<"member">[]) yield row;
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
}

/**
 * The organization's members with this role, oldest first (index `organizationId_role_createdAt`).
 * Roles are stored as one canonical role (organizationPlugin.ts refuses role lists).
 */
export function membersWithRole(ctx: Reader, organizationId: string, role: OrganizationRole, pageSize = 25): AsyncGenerator<Doc<"member">> {
  return memberRows(ctx, [{ field: "organizationId", value: organizationId }, { field: "role", value: role }], pageSize);
}

/** The organization's members in no particular order, read only as far as the caller iterates. */
export function organizationMembers(ctx: Reader, organizationId: string, pageSize = 50): AsyncGenerator<Doc<"member">> {
  return memberRows(ctx, [{ field: "organizationId", value: organizationId }], pageSize);
}

/** At most `limit` of the organization's members: enough to tell "none", "one" or "more". */
export async function firstMembers(ctx: Reader, organizationId: string, limit: number): Promise<Doc<"member">[]> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "member",
    where: [{ field: "organizationId", value: organizationId }],
    paginationOpts: { numItems: limit, cursor: null },
  });
  return result.page as Doc<"member">[];
}

/** Whether the organization has a member besides the membership `except`. */
export async function otherMemberExists(ctx: Reader, organizationId: string, except?: string): Promise<boolean> {
  return (await firstMembers(ctx, organizationId, 2)).some((member) => member._id !== except);
}

/** The user's oldest membership, or `null`. */
export async function firstMembership(ctx: Reader, userId: string): Promise<Doc<"member"> | null> {
  return (await listMemberships(ctx, userId))[0] ?? null;
}

export async function findMembership(
  ctx: Reader,
  userId: string,
  organizationId: string,
): Promise<Doc<"member"> | null> {
  return await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "member",
    where: [
      { field: "organizationId", value: organizationId },
      { field: "userId", value: userId },
    ],
  }) as Doc<"member"> | null;
}

/** A field every row of the model has, to tell its rows from another table's (`db.get` takes any table's ID). */
const MODEL_FIELD = { organization: "slug", invitation: "inviterId", user: "email" } as const;

/** Convex's refusal of a string that isn't an ID at all. */
export function isMalformedIdError(error: unknown): boolean {
  return error instanceof Error && /Unable to decode ID|not a valid ID|Invalid argument `id`/i.test(error.message);
}

/**
 * Look up a row by a caller-supplied ID. A malformed ID, or the ID of a row in another table, is
 * simply not found; any other failure is an error, never a quiet `null` that a caller could
 * mistake for "gone".
 */
export async function findById<M extends "organization" | "invitation" | "user">(
  ctx: Reader,
  model: M,
  id: string,
): Promise<Doc<M> | null> {
  let row: Doc<M> | null;
  try {
    row = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model,
      where: [{ field: "_id", value: id }],
    }) as Doc<M> | null;
  } catch (error) {
    if (isMalformedIdError(error)) return null;
    throw error;
  }
  return row && MODEL_FIELD[model] in row ? row : null;
}

/** A membership counts only while its organization exists and isn't being deleted. */
async function inLiveOrganization(ctx: Reader, member: Doc<"member"> | null): Promise<boolean> {
  if (!member) return false;
  const organization = await findById(ctx, "organization", member.organizationId);
  return !!organization && !isDeleting(organization);
}

/**
 * The organization the session selected, if it is still a live membership; otherwise the
 * oldest live membership, with `stale` set when the session had selected one that no longer
 * counts (the user was removed, or it was deleted). Memberships of a deleted organization, or
 * one being deleted, never count. `active` is `null` only when the user belongs to no live
 * organization.
 *
 * Reads follow `active`, so removal takes effect on the next request. Writes refuse a stale
 * selection (`orgMutation`): the user composed them for the organization they had selected,
 * and must not find them in another. The UI switches the session explicitly instead
 * (`OrganizationAccessNotice`).
 */
export async function resolveOrganizationSelection(
  ctx: Reader,
  user: Pick<Doc<"user">, "_id">,
  session: Pick<Doc<"session">, "activeOrganizationId">,
): Promise<{ active: ActiveOrganization | null; stale: boolean }> {
  const requested = session.activeOrganizationId;
  const selected = requested ? await findMembership(ctx, user._id, requested) : null;
  if (selected && await inLiveOrganization(ctx, selected)) {
    return { active: { organizationId: selected.organizationId, organizationRole: parseRole(selected.role) }, stale: false };
  }
  for (const candidate of await listMemberships(ctx, user._id)) {
    if (await inLiveOrganization(ctx, candidate)) {
      return { active: { organizationId: candidate.organizationId, organizationRole: parseRole(candidate.role) }, stale: !!requested };
    }
  }
  return { active: null, stale: !!requested };
}

/** The organization reads use: the session's selection while valid, otherwise the oldest live membership. */
export async function resolveActiveOrganization(
  ctx: Reader,
  user: Pick<Doc<"user">, "_id">,
  session: Pick<Doc<"session">, "activeOrganizationId">,
): Promise<ActiveOrganization | null> {
  return (await resolveOrganizationSelection(ctx, user, session)).active;
}

/** A new personal organization is named after its user; they can rename it. */
export function personalOrganizationName(user: Pick<Doc<"user">, "name" | "email">): string {
  const name = user.name?.trim() || user.email.split("@")[0] || user.email;
  return name.slice(0, 100);
}

/**
 * Give a user with no membership their own organization, as its owner. Idempotent: returns
 * the oldest existing membership's organization when there is one. Only used for initial
 * sign-up provisioning; losing the last membership does not create a replacement.
 */
export async function ensurePersonalOrganization(
  ctx: Writer,
  user: Pick<Doc<"user">, "_id" | "name" | "email">,
): Promise<ActiveOrganization> {
  const existing = (await listMemberships(ctx, user._id))[0];
  if (existing) return { organizationId: existing.organizationId, organizationRole: parseRole(existing.role) };
  return { organizationId: await createPersonalOrganization(ctx, user), organizationRole: "owner" };
}

async function createPersonalOrganization(
  ctx: Writer,
  user: Pick<Doc<"user">, "_id" | "name" | "email">,
): Promise<string> {
  return await createOrganizationWithOwner(ctx, personalOrganizationName(user), user._id);
}

/**
 * Create an organization with its owner, in the caller's transaction. Every organization the
 * platform creates goes through here, so it can be given its plan in the same transaction
 * (Better Auth's own create route is turned off).
 */
export async function createOrganizationWithOwner(ctx: Writer, name: string, ownerUserId: string): Promise<string> {
  const now = Date.now();
  const organization = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: "organization",
      // The slug is internal (Better Auth requires one); the UI never shows it.
      data: { name: name.trim().slice(0, 100), slug: `${ownerUserId}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now },
    },
  });
  await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: { organizationId: organization._id, userId: ownerUserId, role: "owner", createdAt: now },
    },
    onCreateHandle: await createFunctionHandle(internal.platform.authTriggers.onCreate),
  });
  return organization._id;
}

/**
 * The organization pre-organization data moves into, for a data migration: one the owner owns
 * **alone**, with no pending invitation, so nobody else can see the private data it receives.
 * Being an owner is not enough: the user may have been invited into someone else's
 * organization as an owner before the migration reached their rows, and members who left may
 * have left invitations behind. Without such an organization, a new personal one is created.
 * `null` when the owner's account no longer exists; leave such rows unmigrated.
 */
export async function personalOrganizationForOwner(ctx: Writer, ownerId: string): Promise<string | null> {
  const user = await findUserByOwnerId(ctx, ownerId);
  if (!user) return null;
  for (const membership of await listMemberships(ctx, user._id)) {
    if (parseRole(membership.role) !== "owner") continue;
    const members = await listOrganizationMembers(ctx, membership.organizationId);
    if (members.length !== 1) continue;
    // An outstanding invitation (perhaps sent by a member who has since left) could admit
    // someone after the data arrives.
    const invited = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "invitation",
      where: [{ field: "organizationId", value: membership.organizationId }, { field: "status", value: "pending" }],
    });
    if (!invited) return membership.organizationId;
  }
  return await createPersonalOrganization(ctx, user);
}

/**
 * Invitations of one organization, or to one address, with this status that expire after
 * `expiresAfter`, latest expiry first: every page, or the first `limit` rows. The index range
 * skips older history, which only grows: Better Auth never rewrites an expired invitation's
 * status, so it stays `pending`.
 */
export async function invitationsExpiringAfter(
  ctx: Reader,
  scope: { organizationId: string } | { email: string },
  status: string,
  expiresAfter: number,
  limit = Infinity,
): Promise<Doc<"invitation">[]> {
  const rows: Doc<"invitation">[] = [];
  let cursor: string | null = null;
  do {
    const result = await ctx.runQuery(components.betterAuth.adapter.invitationsByExpiry, {
      ...scope, status, expiresAfter, paginationOpts: { numItems: Math.min(MAX_ROWS, limit - rows.length), cursor },
    }) as PaginationResult<Doc<"invitation">>;
    rows.push(...result.page);
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor && rows.length < limit);
  return rows;
}

/** Pending invitations to this address that have not expired; expired ones are not read. */
export async function pendingInvitationsFor(ctx: Reader, email: string): Promise<Doc<"invitation">[]> {
  return await invitationsExpiringAfter(ctx, { email: email.trim().toLowerCase() }, "pending", Date.now());
}

/**
 * Find the user who owns pre-organization data. `ownerId` is `user.userId ?? user._id`
 * (see `authorizedSession`), so check the legacy `userId` field first.
 */
export async function findUserByOwnerId(ctx: Reader, ownerId: string): Promise<Doc<"user"> | null> {
  const legacy = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "userId", value: ownerId }],
  }) as Doc<"user"> | null;
  return legacy ?? await findById(ctx, "user", ownerId);
}

/** Who deleted the account, for the audit event of an organization it leaves empty. */
export type AccountDeletionActor = { email: string; userId?: string };

/**
 * Account deletion, one organization: drop the user's membership `member`. An organization that
 * would be left without an owner (or without one who can sign in, while members can) first
 * passes ownership to its longest-standing admin, else member, preferring people who aren't
 * banned, so it always stays administrable (the ownership guard refuses the deletion
 * otherwise). One left with no members at all is deleted, as if its owner had deleted it (every
 * account has a personal organization, so this is the common case). Reads the organization's
 * owners, and other members only while choosing a successor. Account deletion runs it one
 * organization per transaction (`userDeletion.ts`, the membership removal job).
 */
export async function removeMembership(ctx: Deleter, member: Doc<"member">, userId: string, actor: AccountDeletionActor): Promise<void> {
  const successor = parseRole(member.role) === "owner" && await successorNeeded(ctx, member.organizationId, member._id)
    ? await findSuccessor(ctx, member.organizationId, member._id)
    : undefined;
  if (successor) await setMemberRole(ctx, successor.member._id, "owner");
  await deleteMember(ctx, member._id);
  if (!(await otherMemberExists(ctx, member.organizationId))) await deleteEmptyOrganization(ctx, member.organizationId, userId, actor);
}

/** Every membership of the user in one transaction (`removeMembership` each): fixtures and tests only. */
export async function removeMemberships(ctx: Deleter, userId: string, actor: AccountDeletionActor): Promise<void> {
  for (const member of await listMemberships(ctx, userId)) await removeMembership(ctx, member, userId, actor);
}

/**
 * Delete an organization nobody belongs to any more, as Better Auth's own deletion does: its
 * invitations and its row. The app's data is then removed by the same cleanup an owner's
 * deletion runs (`afterDeleteOrganization`). Sessions and users that still point at it need no
 * change: `resolveActiveOrganization` and `startingOrganization` only follow memberships.
 */
async function deleteEmptyOrganization(
  ctx: Deleter,
  organizationId: string,
  deletedUserId: string,
  actor: AccountDeletionActor,
): Promise<void> {
  if (!(await deleteInvitationBatch(ctx, organizationId))) {
    await ctx.scheduler.runAfter(0, internal.platform.organizations.deleteOrganizationInvitations, { organizationId });
  }
  // Its plan ends and its billing row is marked deleted; both stay as billing history.
  await ctx.runMutation(components.platform.billing.organizationDeleted, { organizationId, actor });
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input: { model: "organization", where: [{ field: "_id", value: organizationId }] },
  });
  await scheduleAuditEvent(ctx, {
    actor: actor.email,
    authenticatedUserId: actor.userId,
    sourceDetail: "account-deletion",
    action: "organization.deleted",
    resource: `organization:${organizationId}`,
    status: "succeeded",
    reason: "last_member_deleted",
    meta: JSON.stringify({ deletedUserId }),
  });
  await startOrganizationCleanup(ctx, organizationId);
}

/**
 * Delete one bounded batch of an organization's invitations, whatever their state. `true`
 * once none are left; invitation history can grow past what one transaction should delete.
 */
export async function deleteInvitationBatch(ctx: Writer, organizationId: string): Promise<boolean> {
  const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    input: { model: "invitation", where: [{ field: "organizationId", value: organizationId }] },
    paginationOpts: { cursor: null, numItems: MAX_ROWS },
  });
  return result.isDone;
}
