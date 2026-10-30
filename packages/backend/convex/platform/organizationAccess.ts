/**
 * Organization membership reads and the one rule that picks the caller's organization.
 *
 * Organizations, members and invitations are Better Auth organization-plugin rows in the
 * Better Auth component. Writes go through Better Auth's endpoints, which check roles;
 * this file only reads them, plus `ensurePersonalOrganization`, which gives a user with
 * no membership their own organization. See platform/docs/organizations.md.
 */
import { components } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";

type Reader = Pick<QueryCtx, "runQuery">;
type Writer = Pick<MutationCtx, "runQuery" | "runMutation">;

export type OrganizationRole = "owner" | "admin" | "member";

/** Added to `ctx` by `orgQuery` and `orgMutation`. */
export type ActiveOrganization = {
  /** The organization every read and write in this request belongs to. */
  organizationId: string;
  /** The caller's role in it. */
  organizationRole: OrganizationRole;
};

/** Better Auth's `membershipLimit` and `organizationLimit` are below this. */
const MAX_ROWS = 200;

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

/** The user's memberships, oldest first. */
export async function listMemberships(ctx: Reader, userId: string): Promise<Doc<"member">[]> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "member",
    where: [{ field: "userId", value: userId }],
    paginationOpts: { numItems: MAX_ROWS, cursor: null },
  });
  return (result.page as Doc<"member">[]).sort(oldestFirst);
}

export async function listOrganizationMembers(ctx: Reader, organizationId: string): Promise<Doc<"member">[]> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "member",
    where: [{ field: "organizationId", value: organizationId }],
    paginationOpts: { numItems: MAX_ROWS, cursor: null },
  });
  return (result.page as Doc<"member">[]).sort(oldestFirst);
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

/** Look up a row by a caller-supplied ID; a malformed ID is simply not found. */
export async function findById<M extends "organization" | "invitation" | "user">(
  ctx: Reader,
  model: M,
  id: string,
): Promise<Doc<M> | null> {
  try {
    return await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model,
      where: [{ field: "_id", value: id }],
    }) as Doc<M> | null;
  } catch {
    return null;
  }
}

/**
 * The caller's organization: the session's active organization while they are still a
 * member of it, otherwise their oldest membership. Removal from an organization therefore
 * takes effect on the next request. `null` only when the user belongs to none.
 */
export async function resolveActiveOrganization(
  ctx: Reader,
  user: Pick<Doc<"user">, "_id">,
  session: Pick<Doc<"session">, "activeOrganizationId">,
): Promise<ActiveOrganization | null> {
  const requested = session.activeOrganizationId;
  const member = (requested ? await findMembership(ctx, user._id, requested) : null)
    ?? (await listMemberships(ctx, user._id))[0];
  return member ? { organizationId: member.organizationId, organizationRole: parseRole(member.role) } : null;
}

/** A new personal organization is named after its user; they can rename it. */
export function personalOrganizationName(user: Pick<Doc<"user">, "name" | "email">): string {
  const name = user.name?.trim() || user.email.split("@")[0] || user.email;
  return name.slice(0, 100);
}

/**
 * Give a user with no membership their own organization, as its owner. Idempotent: returns
 * the oldest existing membership's organization when there is one. Runs at sign-up and
 * whenever a signed-in user turns out to have no organization.
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
  const now = Date.now();
  const organization = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: "organization",
      // The slug is internal (Better Auth requires one); the UI never shows it.
      data: { name: personalOrganizationName(user), slug: `${user._id}-${now.toString(36)}`, createdAt: now },
    },
  });
  await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: { organizationId: organization._id, userId: user._id, role: "owner", createdAt: now },
    },
  });
  return organization._id;
}

/**
 * The organization pre-organization data moves into, for a data migration: one the owner owns
 * **alone**, so nobody else can see the private data it receives. Being an owner is not enough:
 * the user may have been invited into someone else's organization as an owner before the
 * migration reached their rows. Without such an organization, a new personal one is created.
 * `null` when the owner's account no longer exists; leave such rows unmigrated.
 */
export async function personalOrganizationForOwner(ctx: Writer, ownerId: string): Promise<string | null> {
  const user = await findUserByOwnerId(ctx, ownerId);
  if (!user) return null;
  for (const membership of await listMemberships(ctx, user._id)) {
    if (parseRole(membership.role) !== "owner") continue;
    const members = await listOrganizationMembers(ctx, membership.organizationId);
    if (members.length === 1) return membership.organizationId;
  }
  return await createPersonalOrganization(ctx, user);
}

/**
 * Pending invitations to this address that have not expired. Reads every page: accepted,
 * canceled and expired invitations accumulate, so a fixed-size first page could hide one.
 */
export async function pendingInvitationsFor(ctx: Reader, email: string): Promise<Doc<"invitation">[]> {
  const now = Date.now();
  const pending: Doc<"invitation">[] = [];
  let cursor: string | null = null;
  do {
    const result: { page: unknown[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "invitation",
      where: [{ field: "email", value: email.trim().toLowerCase() }, { field: "status", value: "pending" }],
      paginationOpts: { numItems: MAX_ROWS, cursor },
    });
    pending.push(...(result.page as Doc<"invitation">[]).filter((invitation) => invitation.expiresAt > now));
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return pending;
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

/**
 * Account deletion: drop the user's memberships. An organization that would be left with
 * members but no owner passes ownership to its longest-standing admin, else member, so it
 * always stays administrable. Call it from every path that deletes a user.
 */
export async function removeMemberships(ctx: Writer, userId: string): Promise<void> {
  for (const member of await listMemberships(ctx, userId)) {
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
}

