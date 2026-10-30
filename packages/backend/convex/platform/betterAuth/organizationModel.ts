import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

export const MEMBER_LIMIT = 100;
export const ROLE_ADMIN = "org-admin";
export const ROLE_MEMBER = "member";

export function isOperator(role: string | null | undefined): boolean {
  return Boolean(role?.split(",").includes("admin"));
}

export function validateOrganizationDetails(name: string, slug: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new Error("INVALID_ORGANIZATION_NAME");
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)
    || new Set(["admin", "api", "auth", "dashboard", "settings", "personal", "sign-in", "sign-up"]).has(slug)) {
    throw new Error("INVALID_ORGANIZATION_SLUG");
  }
  return { name: trimmed, slug };
}

export async function customer(ctx: QueryCtx, userId: string) {
  const id = ctx.db.normalizeId("user", userId);
  const user = id ? await ctx.db.get(id) : null;
  if (!user || user.banned || isOperator(user.role)) throw new Error("NOT_CUSTOMER");
  return user;
}

export async function organization(ctx: QueryCtx, organizationId: string) {
  const id = ctx.db.normalizeId("organization", organizationId);
  const org = id ? await ctx.db.get(id) : null;
  if (!org || org.lifecycle !== "active") throw new Error("ORGANIZATION_UNAVAILABLE");
  return org;
}

export async function membership(ctx: QueryCtx, organizationId: string, userId: string) {
  const member = await ctx.db.query("member").withIndex("organizationId_userId", q =>
    q.eq("organizationId", organizationId).eq("userId", userId)).unique();
  if (!member) throw new Error("ORGANIZATION_UNAVAILABLE");
  return member;
}

/** Live enrollment validity: a stored grant cannot outlive its verified factor. */
export async function enrolledAdmin(ctx: QueryCtx, member: Doc<"member">) {
  if (member.role !== ROLE_ADMIN || !member.adminEnrolledAt || !member.adminFactorId) return false;
  const userId = ctx.db.normalizeId("user", member.userId);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user || isOperator(user.role) || user.banned || !user.emailVerified || !user.twoFactorEnabled) return false;
  const factorId = ctx.db.normalizeId("twoFactor", member.adminFactorId);
  const factor = factorId ? await ctx.db.get(factorId) : null;
  return Boolean(factor?.userId === member.userId && factor.verified);
}

export async function administrator(ctx: QueryCtx, organizationId: string, userId: string) {
  const org = await organization(ctx, organizationId);
  await customer(ctx, userId);
  const member = await membership(ctx, organizationId, userId);
  if (org.experience !== "collaborative" || !await enrolledAdmin(ctx, member)) throw new Error("NOT_ORGANIZATION_ADMIN");
  return { org, member };
}

/** Called in the same mutation as the demotion/removal; no HTTP hook check/write split. */
export async function preserveAdministrator(ctx: QueryCtx, org: Doc<"organization">, target: Doc<"member">) {
  if (target.role !== ROLE_ADMIN) return;
  if (org.experience === "personal") throw new Error("LAST_ORGANIZATION_ADMIN");
  const candidates = await ctx.db.query("member").withIndex("organizationId_role", q =>
    q.eq("organizationId", org._id).eq("role", ROLE_ADMIN)).take(MEMBER_LIMIT + 1);
  if (candidates.length > MEMBER_LIMIT) throw new Error("ORGANIZATION_MEMBER_LIMIT");
  for (const candidate of candidates) {
    if (candidate._id !== target._id && await enrolledAdmin(ctx, candidate)) return;
  }
  throw new Error("LAST_ORGANIZATION_ADMIN");
}
