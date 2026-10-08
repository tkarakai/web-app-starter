import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { administrator, customer, MEMBER_LIMIT, ROLE_ADMIN, ROLE_MEMBER } from "./organizationModel";
import { invitationByToken, invitationRole, membershipCapacity, recipient, registrationClaim } from "./memberInvitationModel";

const role = v.union(v.literal("member"), v.literal("org-admin"));
const tokenArgs = { organizationId: v.string(), tokenHash: v.string() };

/** Server-only issuance. No public member-management endpoint is enabled before cutover. */
export const issue = mutation({
  args: { organizationId: v.string(), actorId: v.string(), email: v.string(), role, tokenHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await administrator(ctx, args.organizationId, args.actorId);
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !/^[a-f0-9]{64}$/.test(args.tokenHash)
      || !Number.isFinite(args.expiresAt) || args.expiresAt <= Date.now() || args.expiresAt > Date.now() + 7 * 86_400_000) throw new Error("INVALID_MEMBER_INVITATION");
    const existingUser = await ctx.db.query("user").withIndex("email_name", q => q.eq("email", email)).unique();
    if (existingUser) {
      await customer(ctx, existingUser._id);
      if (await ctx.db.query("member").withIndex("organizationId_userId", q => q.eq("organizationId", args.organizationId).eq("userId", existingUser._id)).unique()) throw new Error("ALREADY_ORGANIZATION_MEMBER");
    }
    await membershipCapacity(ctx, args.organizationId);
    const pending = await ctx.db.query("invitation").withIndex("organizationId_status", q => q.eq("organizationId", args.organizationId).eq("status", "pending"))
      .filter(q => q.gt(q.field("expiresAt"), Date.now())).take(MEMBER_LIMIT + 1);
    if (pending.length >= MEMBER_LIMIT) throw new Error("ORGANIZATION_INVITATION_LIMIT");
    if (pending.some(invite => invite.email === email)) throw new Error("INVITATION_ALREADY_PENDING");
    if (await ctx.db.query("invitation").withIndex("tokenHash", q => q.eq("tokenHash", args.tokenHash)).unique()) throw new Error("INVALID_MEMBER_INVITATION");
    return ctx.db.insert("invitation", { organizationId: args.organizationId, inviterId: args.actorId,
      email, role: args.role, tokenHash: args.tokenHash, status: "pending", expiresAt: args.expiresAt, createdAt: Date.now() });
  },
});

export const cancel = mutation({
  args: { organizationId: v.string(), actorId: v.string(), invitationId: v.string() },
  handler: async (ctx, args) => {
    await administrator(ctx, args.organizationId, args.actorId);
    const id = ctx.db.normalizeId("invitation", args.invitationId);
    const invite = id ? await ctx.db.get(id) : null;
    if (!invite || invite.organizationId !== args.organizationId || invite.status !== "pending") throw new Error("INVALID_MEMBER_INVITATION");
    await ctx.db.patch(invite._id, { status: "canceled" });
  },
});

/** Safe token preview is scoped to the requested immutable organization. */
export const preview = query({
  args: tokenArgs,
  handler: async (ctx, args) => {
    const { invite, org } = await invitationByToken(ctx, args.tokenHash, args.organizationId);
    return { organizationId: org._id, name: org.name, email: invite.email, role: invitationRole(invite.role), expiresAt: invite.expiresAt };
  },
});

/** Registration capability is single-account-bound; this does not accept membership or verify email. */
export const exchange = mutation({
  args: { ...tokenArgs, capabilityHash: v.string() },
  handler: async (ctx, args) => {
    const { invite } = await invitationByToken(ctx, args.tokenHash, args.organizationId);
    if (!/^[a-f0-9]{64}$/.test(args.capabilityHash)
      || await ctx.db.query("organizationInvitationClaims").withIndex("capabilityHash", q => q.eq("capabilityHash", args.capabilityHash)).unique()) throw new Error("INVALID_MEMBER_INVITATION");
    const expiresAt = Math.min(invite.expiresAt, Date.now() + 10 * 60_000);
    await ctx.db.insert("organizationInvitationClaims", { invitationId: invite._id, invitationTokenHash: args.tokenHash,
      capabilityHash: args.capabilityHash, expiresAt, createdAt: Date.now() });
    return { organizationId: invite.organizationId, email: invite.email, role: invitationRole(invite.role), expiresAt };
  },
});

export const registration = query({
  args: { capabilityHash: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const { claim, invite } = await registrationClaim(ctx, args.capabilityHash, args.email);
    return { userId: claim.userId ?? null, role: invitationRole(invite.role) };
  },
});

/** Account+credential+intent receipt commit together; retries never reset credentials or create a tenant. */
export const register = mutation({
  args: { capabilityHash: v.string(), email: v.string(), name: v.string(), passwordHash: v.string() },
  handler: async (ctx, args) => {
    const { claim, invite } = await registrationClaim(ctx, args.capabilityHash, args.email);
    if (claim.userId) { await customer(ctx, claim.userId); return; }
    if (await ctx.db.query("user").withIndex("email_name", q => q.eq("email", invite.email)).unique()) throw new Error("ACCOUNT_ALREADY_EXISTS");
    if (!args.name.trim() || args.name.length > 200 || !args.passwordHash) throw new Error("INVALID_ACCOUNT_DETAILS");
    const now = Date.now();
    const userId = await ctx.db.insert("user", { name: args.name.trim(), email: invite.email, emailVerified: false,
      role: "user", createdAt: now, updatedAt: now });
    await ctx.db.insert("account", { userId, accountId: userId, providerId: "credential", password: args.passwordHash, createdAt: now, updatedAt: now });
    await ctx.db.patch(claim._id, { userId });
  },
});

export const verificationRecipient = query({
  args: { ...tokenArgs, userId: v.string() },
  handler: async (ctx, args) => ({ email: (await recipient(ctx, args.tokenHash, args.organizationId, args.userId)).user.email }),
});

/** Atomic verified-recipient membership admission; requested admin privilege stays pending. */
export const accept = mutation({
  args: { ...tokenArgs, userId: v.string() },
  handler: async (ctx, args) => {
    const { invite, user, org } = await recipient(ctx, args.tokenHash, args.organizationId, args.userId, false);
    if (!user.emailVerified) throw new Error("EMAIL_VERIFICATION_REQUIRED");
    const existing = await ctx.db.query("member").withIndex("organizationId_userId", q => q.eq("organizationId", org._id).eq("userId", user._id)).unique();
    if (invite.status === "accepted") {
      if (invite.acceptedUserId !== user._id || !existing || invite.acceptedMemberId !== existing._id) throw new Error("INVALID_MEMBER_INVITATION");
      return { organizationId: org._id, memberId: existing._id, adminPending: Boolean(await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", existing._id)).unique()) && existing.role === ROLE_MEMBER };
    }
    if (existing) throw new Error("ALREADY_ORGANIZATION_MEMBER");
    await membershipCapacity(ctx, org._id);
    const memberId = await ctx.db.insert("member", { organizationId: org._id, userId: user._id, role: ROLE_MEMBER, createdAt: Date.now() });
    const adminPending = invite.role === ROLE_ADMIN;
    if (adminPending) await ctx.db.insert("organizationEnrollments", { organizationId: org._id, userId: user._id, memberId, purpose: "invitation", createdAt: Date.now() });
    await ctx.db.patch(invite._id, { status: "accepted", acceptedUserId: user._id, acceptedMemberId: memberId });
    return { organizationId: org._id, memberId, adminPending };
  },
});
