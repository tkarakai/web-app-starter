import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { MEMBERSHIP_MANAGEMENT_EXPERIENCE, ORG_ADMIN_MEMBERSHIP_ROLE, ORG_MEMBER_ROLE } from "./organizationVocabulary";
import { sha256Hex } from "../tokenHash";

export const MEMBER_LIMIT = 100;
/** @deprecated Use the organization vocabulary role constant. */
export const ROLE_ADMIN = ORG_ADMIN_MEMBERSHIP_ROLE;
/** @deprecated Use the organization vocabulary role constant. */
export const ROLE_MEMBER = ORG_MEMBER_ROLE;

export function isAppOperatorRole(role: string | null | undefined): boolean {
  return Boolean(role?.split(",").includes("admin"));
}
/** @deprecated Source compatibility; this classifies app-operator roles. */
export const isOperator = isAppOperatorRole;

export function validateOrganizationDetails(name: string, slug: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new Error("INVALID_ORGANIZATION_NAME");
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)
    || new Set(["admin", "api", "auth", "dashboard", "settings", "personal", "sign-in", "sign-up"]).has(slug)) {
    throw new Error("INVALID_ORGANIZATION_SLUG");
  }
  return { name: trimmed, slug };
}

export async function organizationUser(ctx: QueryCtx, userId: string) {
  const id = ctx.db.normalizeId("user", userId);
  const user = id ? await ctx.db.get(id) : null;
  // Preserve the existing wire error code for callers; this helper covers organization users.
  if (!user || user.banned || isAppOperatorRole(user.role)) throw new Error("NOT_CUSTOMER");
  return user;
}
/** @deprecated Use organizationUser; no customer/payer status is inferred. */
export const customer = organizationUser;

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

/** Durable eligibility only. Parent authorization additionally requires current session proof. */
export async function enrolledOrgAdmin(ctx: QueryCtx, member: Doc<"member">) {
  if (member.role !== ORG_ADMIN_MEMBERSHIP_ROLE || !member.adminEnrolledAt || !member.adminFactorId) return false;
  const userId = ctx.db.normalizeId("user", member.userId);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user || isAppOperatorRole(user.role) || user.banned || !user.emailVerified || !user.twoFactorEnabled) return false;
  const factorId = ctx.db.normalizeId("twoFactor", member.adminFactorId);
  const factor = factorId ? await ctx.db.get(factorId) : null;
  const enrollment = await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", member._id)).unique();
  const account = await ctx.db.query("account").withIndex("providerId_userId", q =>
    q.eq("providerId", "credential").eq("userId", member.userId)).unique();
  const policy = await ctx.db.query("organizationSecurityPolicy").withIndex("key", q => q.eq("key", "admin")).unique();
  if (policy?.passkeyPolicy === "required" && !await ctx.db.query("passkey").withIndex("userId", q => q.eq("userId", member.userId)).first()) return false;
  return Boolean(factor?.userId === member.userId && factor.verified && account?.password
    && enrollment?.completedAt && enrollment.organizationId === member.organizationId && enrollment.userId === member.userId
    && enrollment.passwordProof === sha256Hex(account.password) && enrollment.passwordEmail === user.email && enrollment.backupAcknowledgedAt
    && enrollment.backupFactorId === factor._id && enrollment.factorSecretProof === sha256Hex(factor.secret)
    && enrollment.backupCodesProof === sha256Hex(factor.backupCodes));
}

/** @deprecated Use enrolledOrgAdmin; this checks organization-admin enrollment only. */
export const enrolledAdmin = enrolledOrgAdmin;

/** Live authority requirement, also read inside credential-change transactions. */
export async function organizationAdminSecurity(ctx: QueryCtx, userId: string) {
  const members = await ctx.db.query("member").withIndex("userId", q => q.eq("userId", userId)).take(101);
  if (members.length > 100) throw new Error("ORGANIZATION_CONTEXT_LIMIT");
  let required = false;
  let valid = true;
  for (const member of members) {
    if (member.role !== ORG_ADMIN_MEMBERSHIP_ROLE || !member.adminEnrolledAt) continue;
    const id = ctx.db.normalizeId("organization", member.organizationId);
    const org = id ? await ctx.db.get(id) : null;
    if (!org || org.lifecycle !== "active" || org.experience !== MEMBERSHIP_MANAGEMENT_EXPERIENCE) continue;
    required = true;
    valid = valid && await enrolledOrgAdmin(ctx, member);
  }
  return { required, valid };
}

export async function requireOrgAdmin(ctx: QueryCtx, organizationId: string, userId: string) {
  const org = await organization(ctx, organizationId);
  await organizationUser(ctx, userId);
  const member = await membership(ctx, organizationId, userId);
  if (org.experience !== MEMBERSHIP_MANAGEMENT_EXPERIENCE || !await enrolledOrgAdmin(ctx, member)) throw new Error("NOT_ORGANIZATION_ADMIN");
  return { org, member };
}

/** @deprecated Use requireOrgAdmin; no app-operator authority is implied. */
export const administrator = requireOrgAdmin;

/** Called in the same mutation as the demotion/removal; no HTTP hook check/write split. */
export async function preserveOrgAdmin(ctx: QueryCtx, org: Doc<"organization">, target: Doc<"member">) {
  if (target.role !== ORG_ADMIN_MEMBERSHIP_ROLE) return;
  if (org.experience === "personal") throw new Error("LAST_ORGANIZATION_ADMIN");
  const candidates = await ctx.db.query("member").withIndex("organizationId_role", q =>
    q.eq("organizationId", org._id).eq("role", ORG_ADMIN_MEMBERSHIP_ROLE)).take(MEMBER_LIMIT + 1);
  if (candidates.length > MEMBER_LIMIT) throw new Error("ORGANIZATION_MEMBER_LIMIT");
  for (const candidate of candidates) {
    if (candidate._id !== target._id && await enrolledOrgAdmin(ctx, candidate)) return;
  }
  throw new Error("LAST_ORGANIZATION_ADMIN");
}

/** @deprecated Use preserveOrgAdmin; this preserves the organization's org-admin invariant. */
export const preserveAdministrator = preserveOrgAdmin;
