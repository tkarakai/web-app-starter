import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import schema from "./schema";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { sha256Hex } from "../tokenHash";
import { RECENT_AUTH_MS } from "../sessionFields";
import {
  administrator, customer, enrolledAdmin, isOperator, membership, organization,
  preserveAdministrator, ROLE_ADMIN, ROLE_MEMBER, validateOrganizationDetails,
} from "./organizationModel";

/** Component APIs are server-only. Parent wrappers must bind live session/assurance and actor. */
export const provisionPersonal = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await customer(ctx, userId);
    const existing = await ctx.db.query("organization").withIndex("personalOwnerId", q => q.eq("personalOwnerId", userId)).unique();
    if (existing) {
      const member = await membership(ctx, existing._id, userId);
      return { organizationId: existing._id, memberId: member._id };
    }
    // Invocation expresses new-customer intent; member-only signup must not call this function.
    const existingMembership = await ctx.db.query("member").withIndex("userId", q => q.eq("userId", userId)).first();
    if (existingMembership) throw new Error("CUSTOMER_ALREADY_HAS_MEMBERSHIP");
    const now = Date.now();
    const organizationId = await ctx.db.insert("organization", {
      name: "Personal", slug: `personal-${crypto.randomUUID()}`,
      personalOwnerId: userId, experience: "personal", lifecycle: "active", createdAt: now,
    });
    const memberId = await ctx.db.insert("member", { organizationId, userId, role: ROLE_ADMIN, createdAt: now });
    return { organizationId, memberId };
  },
});

export const context = query({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    await customer(ctx, userId);
    const org = await organization(ctx, organizationId);
    const member = await membership(ctx, organizationId, userId);
    return { organizationId: org._id, name: org.name, slug: org.slug, experience: org.experience,
      memberId: member._id, role: member.role, canManageMembers: org.experience === "collaborative" && await enrolledAdmin(ctx, member) };
  },
});

export const beginCollaboration = mutation({
  args: { organizationId: v.string(), userId: v.string(), name: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    await customer(ctx, args.userId);
    const org = await organization(ctx, args.organizationId);
    const member = await membership(ctx, args.organizationId, args.userId);
    if (org.experience !== "personal" || org.personalOwnerId !== args.userId || member.role !== ROLE_ADMIN) throw new Error("NOT_PERSONAL_ORGANIZATION_ADMIN");
    const details = validateOrganizationDetails(args.name, args.slug);
    const conflict = await ctx.db.query("organization").withIndex("slug", q => q.eq("slug", details.slug)).unique();
    if (conflict && conflict._id !== org._id) throw new Error("ORGANIZATION_SLUG_TAKEN");
    const existing = await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", member._id)).unique();
    if (existing) {
      if (existing.completedAt) throw new Error("ENROLLMENT_ALREADY_COMPLETED");
      await ctx.db.patch(existing._id, details);
      return existing._id;
    }
    return await ctx.db.insert("organizationEnrollments", { organizationId: org._id, memberId: member._id,
      userId: args.userId, purpose: "collaboration", ...details, createdAt: Date.now() });
  },
});

/** Parent has verified the current password against this exact credential hash. */
export const recordPasswordProof = mutation({
  args: { organizationId: v.string(), userId: v.string(), credentialProof: v.string() },
  handler: async (ctx, args) => {
    await customer(ctx, args.userId);
    await organization(ctx, args.organizationId);
    const member = await membership(ctx, args.organizationId, args.userId);
    const enrollment = await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", member._id)).unique();
    if (!enrollment || enrollment.completedAt) throw new Error("INVALID_ENROLLMENT");
    const account = await ctx.db.query("account").withIndex("providerId_userId", q => q.eq("providerId", "credential").eq("userId", args.userId)).unique();
    if (!account?.password || sha256Hex(account.password) !== args.credentialProof) throw new Error("CREDENTIAL_CHANGED");
    await ctx.db.patch(enrollment._id, { passwordProof: args.credentialProof, passwordVerifiedAt: Date.now() });
  },
});

/** Parent passes the fingerprint of the exact encrypted recovery set it decrypted/validated. */
export const acknowledgeRecovery = mutation({
  args: { organizationId: v.string(), userId: v.string(), factorId: v.string(), backupCodesProof: v.string() },
  handler: async (ctx, args) => {
    const user = await customer(ctx, args.userId);
    await organization(ctx, args.organizationId);
    const member = await membership(ctx, args.organizationId, args.userId);
    const enrollment = await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", member._id)).unique();
    const id = ctx.db.normalizeId("twoFactor", args.factorId);
    const factor = id ? await ctx.db.get(id) : null;
    if (!enrollment || enrollment.completedAt || !user.twoFactorEnabled || !factor?.verified || factor.userId !== user._id) throw new Error("INVALID_ENROLLMENT");
    if (args.backupCodesProof !== sha256Hex(factor.backupCodes)) throw new Error("RECOVERY_CODES_CHANGED");
    await ctx.db.patch(enrollment._id, { backupAcknowledgedAt: Date.now(), backupFactorId: factor._id,
      backupCodesProof: args.backupCodesProof });
  },
});

/** Atomic lifecycle activation + membership grant; the parent also verifies live session proof. */
export const completeEnrollment = mutation({
  args: { organizationId: v.string(), userId: v.string(), requirePasskey: v.boolean() },
  handler: async (ctx, args) => {
    const user = await customer(ctx, args.userId);
    const org = await organization(ctx, args.organizationId);
    const member = await membership(ctx, args.organizationId, args.userId);
    const enrollment = await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", member._id)).unique();
    if (!enrollment) throw new Error("INVALID_ENROLLMENT");
    if (args.requirePasskey && !await ctx.db.query("passkey").withIndex("userId", q => q.eq("userId", args.userId)).first()) throw new Error("PASSKEY_REQUIRED");
    if (enrollment.completedAt) {
      if (!await enrolledAdmin(ctx, member)) throw new Error("ADMIN_ENROLLMENT_REQUIRED");
      return org._id;
    }
    const factor = await ctx.db.query("twoFactor").withIndex("userId", q => q.eq("userId", args.userId)).unique();
    const account = await ctx.db.query("account").withIndex("providerId_userId", q => q.eq("providerId", "credential").eq("userId", args.userId)).unique();
    if (!user.emailVerified || !user.twoFactorEnabled || !factor?.verified || !account?.password
      || !enrollment.passwordVerifiedAt || enrollment.passwordVerifiedAt + RECENT_AUTH_MS <= Date.now()
      || enrollment.passwordProof !== sha256Hex(account.password)
      || !enrollment.backupAcknowledgedAt || enrollment.backupFactorId !== factor._id
      || enrollment.backupCodesProof !== sha256Hex(factor.backupCodes)) throw new Error("ADMIN_ENROLLMENT_REQUIRED");
    if (enrollment.purpose === "collaboration") {
      if (org.experience !== "personal" || org.personalOwnerId !== user._id || member.role !== ROLE_ADMIN
        || !enrollment.name || !enrollment.slug) throw new Error("INVALID_ENROLLMENT");
      const conflict = await ctx.db.query("organization").withIndex("slug", q => q.eq("slug", enrollment.slug!)).unique();
      if (conflict && conflict._id !== org._id) throw new Error("ORGANIZATION_SLUG_TAKEN");
      await ctx.db.patch(org._id, { name: enrollment.name, slug: enrollment.slug, experience: "collaborative" });
    } else if (org.experience !== "collaborative" || member.role !== ROLE_MEMBER) throw new Error("INVALID_ENROLLMENT");
    const now = Date.now();
    await ctx.db.patch(member._id, { role: ROLE_ADMIN, adminEnrolledAt: now, adminFactorId: factor._id });
    await ctx.db.patch(enrollment._id, { completedAt: now });
    return org._id;
  },
});

export const changeMember = mutation({
  args: { organizationId: v.string(), actorId: v.string(), memberId: v.string(),
    operation: v.union(v.literal("remove"), v.literal("demote"), v.literal("promote")) },
  handler: async (ctx, args) => {
    const { org } = await administrator(ctx, args.organizationId, args.actorId);
    const targetId = ctx.db.normalizeId("member", args.memberId);
    const target = targetId ? await ctx.db.get(targetId) : null;
    if (!target || target.organizationId !== org._id) throw new Error("MEMBER_NOT_FOUND");
    const enrollment = await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", target._id)).unique();
    if (args.operation === "promote") {
      await customer(ctx, target.userId);
      if (target.role === ROLE_ADMIN) return;
      if (target.role !== ROLE_MEMBER) throw new Error("INVALID_MEMBER_ROLE");
      if (enrollment && !enrollment.completedAt) return;
      if (enrollment) await ctx.db.delete(enrollment._id);
      await ctx.db.insert("organizationEnrollments", { organizationId: org._id, userId: target.userId,
        memberId: target._id, purpose: "promotion", createdAt: Date.now() });
      return;
    }
    await preserveAdministrator(ctx, org, target);
    if (enrollment) await ctx.db.delete(enrollment._id);
    if (args.operation === "remove") await ctx.db.delete(target._id);
    else await ctx.db.patch(target._id, { role: ROLE_MEMBER, adminEnrolledAt: undefined, adminFactorId: undefined });
  },
});

/** Members leave only this organization; global identity/credentials are never deleted. */
export const leave = mutation({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    await customer(ctx, args.userId);
    const org = await organization(ctx, args.organizationId);
    const member = await membership(ctx, org._id, args.userId);
    await preserveAdministrator(ctx, org, member);
    const enrollment = await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", member._id)).unique();
    if (enrollment) await ctx.db.delete(enrollment._id);
    await ctx.db.delete(member._id);
  },
});

export const directory = query({
  args: { organizationId: v.string(), actorId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await administrator(ctx, args.organizationId, args.actorId);
    if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100) throw new Error("INVALID_PAGE_SIZE");
    for (const cursor of [args.paginationOpts.cursor, args.paginationOpts.endCursor]) {
      if (cursor === null || cursor === undefined) continue;
      let key: unknown;
      try { key = JSON.parse(cursor); } catch { throw new Error("INVALID_DIRECTORY_CURSOR"); }
      if (!Array.isArray(key) || (key.length !== 0 && (key.length !== 3
        || key[0] !== args.organizationId || typeof key[1] !== "number" || !Number.isFinite(key[1])
        || typeof key[2] !== "string" || !ctx.db.normalizeId("member", key[2])))) throw new Error("INVALID_DIRECTORY_CURSOR");
    }
    const result = await paginator(ctx.db, schema).query("member").withIndex("organizationId", q => q.eq("organizationId", args.organizationId)).paginate(args.paginationOpts);
    const page = [];
    for (const member of result.page) {
      if (member.organizationId !== args.organizationId) throw new Error("INVALID_DIRECTORY_CURSOR");
      const userId = ctx.db.normalizeId("user", member.userId);
      const user = userId ? await ctx.db.get(userId) : null;
      if (!user || isOperator(user.role)) throw new Error("INVALID_MEMBER_IDENTITY");
      const enrollment = await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", member._id)).unique();
      page.push({ memberId: member._id, name: user.name, email: user.email, role: member.role,
        adminPending: Boolean(enrollment && !enrollment.completedAt), enrolled: await enrolledAdmin(ctx, member) });
    }
    return { ...result, page };
  },
});

/** Narrow operator projection. Never return auth users, ordinary members or security data. */
export const contacts = query({
  args: { organizationId: v.string(), operatorId: v.string() },
  handler: async (ctx, args) => {
    const operatorId = ctx.db.normalizeId("user", args.operatorId);
    const operator = operatorId ? await ctx.db.get(operatorId) : null;
    if (!operator || operator.banned || !isOperator(operator.role)) throw new Error("NOT_PLATFORM_ADMIN");
    const orgId = ctx.db.normalizeId("organization", args.organizationId);
    const org = orgId ? await ctx.db.get(orgId) : null;
    if (!org) throw new Error("ORGANIZATION_UNAVAILABLE");
    const admins = await ctx.db.query("member").withIndex("organizationId_role", q => q.eq("organizationId", org._id).eq("role", ROLE_ADMIN)).take(101);
    if (admins.length > 100) throw new Error("ORGANIZATION_MEMBER_LIMIT");
    const contacts = [];
    for (const admin of admins) {
      const userId = ctx.db.normalizeId("user", admin.userId);
      const user = userId ? await ctx.db.get(userId) : null;
      if (user && !isOperator(user.role)) contacts.push({ name: user.name, email: user.email });
    }
    return { organizationId: org._id, name: org.name, lifecycle: org.lifecycle, experience: org.experience, contacts };
  },
});

export const setLifecycle = mutation({
  args: { organizationId: v.string(), operatorId: v.string(), lifecycle: v.union(v.literal("active"), v.literal("disabled")) },
  handler: async (ctx, args) => {
    const operatorId = ctx.db.normalizeId("user", args.operatorId);
    const operator = operatorId ? await ctx.db.get(operatorId) : null;
    if (!operator || operator.banned || !isOperator(operator.role)) throw new Error("NOT_PLATFORM_ADMIN");
    const id = ctx.db.normalizeId("organization", args.organizationId);
    const org = id ? await ctx.db.get(id) : null;
    if (!org || !["active", "disabled"].includes(org.lifecycle ?? "")) throw new Error("ORGANIZATION_UNAVAILABLE");
    await ctx.db.patch(org._id, { lifecycle: args.lifecycle });
  },
});
