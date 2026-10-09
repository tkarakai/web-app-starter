import { ORG_ADMIN_MEMBERSHIP_ROLE, ORG_MEMBER_ROLE } from "./organizationVocabulary";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import schema from "./schema";
import { mutation, query } from "./_generated/server";
import { requireOrgAdmin, organizationUser, MEMBER_LIMIT } from "./organizationModel";
import { invitationByToken, invitationRole, liveInvitation, membershipCapacity, recipient, registrationClaim } from "./memberInvitationModel";
import { appendOrganizationAudit } from "./organizationAudit";
import { requireIdentityMappingWritable } from "./organizationMigrationBarrier";

const role = v.union(v.literal(ORG_MEMBER_ROLE), v.literal(ORG_ADMIN_MEMBERSHIP_ROLE));
const tokenArgs = { organizationId: v.string(), tokenHash: v.string() };

/** Server-only issuance. Parent wrappers bind current session assurance and cutover readiness. */
export const issue = mutation({
  args: { organizationId: v.string(), actorId: v.string(), email: v.string(), role, tokenHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await requireIdentityMappingWritable(ctx);
    await requireOrgAdmin(ctx, args.organizationId, args.actorId);
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !/^[a-f0-9]{64}$/.test(args.tokenHash)
      || !Number.isFinite(args.expiresAt) || args.expiresAt <= Date.now() || args.expiresAt > Date.now() + 7 * 86_400_000) throw new Error("INVALID_MEMBER_INVITATION");
    const existingUser = await ctx.db.query("user").withIndex("email_name", q => q.eq("email", email)).unique();
    if (existingUser) {
      await organizationUser(ctx, existingUser._id);
      if (await ctx.db.query("member").withIndex("organizationId_userId", q => q.eq("organizationId", args.organizationId).eq("userId", existingUser._id)).unique()) throw new Error("ALREADY_ORGANIZATION_MEMBER");
    }
    await membershipCapacity(ctx, args.organizationId);
    const pending = await ctx.db.query("invitation").withIndex("organizationId_status", q => q.eq("organizationId", args.organizationId).eq("status", "pending"))
      .filter(q => q.gt(q.field("expiresAt"), Date.now())).take(MEMBER_LIMIT + 1);
    if (pending.length >= MEMBER_LIMIT) throw new Error("ORGANIZATION_INVITATION_LIMIT");
    if (pending.some(invite => invite.email === email)) throw new Error("INVITATION_ALREADY_PENDING");
    if (await ctx.db.query("invitation").withIndex("tokenHash", q => q.eq("tokenHash", args.tokenHash)).unique()) throw new Error("INVALID_MEMBER_INVITATION");
    const invitationId = await ctx.db.insert("invitation", { organizationId: args.organizationId, inviterId: args.actorId,
      email, role: args.role, tokenHash: args.tokenHash, status: "pending", expiresAt: args.expiresAt,
      deliveryState: "pending", deliveryVersion: 1, createdAt: Date.now() });
    await appendOrganizationAudit(ctx, { organizationId: args.organizationId, actorId: args.actorId,
      action: "invitation.issued", targetId: invitationId });
    return invitationId;
  },
});

export const cancel = mutation({
  args: { organizationId: v.string(), actorId: v.string(), invitationId: v.string() },
  handler: async (ctx, args) => {
    await requireIdentityMappingWritable(ctx);
    await requireOrgAdmin(ctx, args.organizationId, args.actorId);
    const id = ctx.db.normalizeId("invitation", args.invitationId);
    const invite = id ? await ctx.db.get(id) : null;
    if (!invite || invite.organizationId !== args.organizationId || invite.status !== "pending") throw new Error("INVALID_MEMBER_INVITATION");
    await ctx.db.patch(invite._id, { status: "canceled" });
    await appendOrganizationAudit(ctx, { organizationId: args.organizationId, actorId: args.actorId,
      action: "invitation.canceled", targetId: invite._id });
  },
});

/** A resend rotates the capability, invalidating earlier links and registration claims. */
export const resend = mutation({
  args: { organizationId: v.string(), actorId: v.string(), invitationId: v.string(), tokenHash: v.string() },
  handler: async (ctx, args) => {
    await requireIdentityMappingWritable(ctx);
    await requireOrgAdmin(ctx, args.organizationId, args.actorId);
    const id = ctx.db.normalizeId("invitation", args.invitationId);
    const invite = id ? await ctx.db.get(id) : null;
    if (!invite || invite.organizationId !== args.organizationId || invite.status !== "pending"
      || !/^[a-f0-9]{64}$/.test(args.tokenHash)) throw new Error("INVALID_MEMBER_INVITATION");
    await membershipCapacity(ctx, args.organizationId);
    const version = (invite.deliveryVersion ?? 0) + 1;
    await ctx.db.patch(invite._id, { tokenHash: args.tokenHash, inviterId: args.actorId,
      expiresAt: Date.now() + 7 * 86_400_000, deliveryState: "pending", deliveryVersion: version,
      deliveredAt: undefined, deliveryError: undefined });
    await appendOrganizationAudit(ctx, { organizationId: args.organizationId, actorId: args.actorId,
      action: "invitation.resent", targetId: invite._id });
    return version;
  },
});

export const list = query({
  args: { organizationId: v.string(), actorId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId, args.actorId);
    if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1
      || args.paginationOpts.numItems > 100) throw new Error("INVALID_PAGE_SIZE");
    for (const cursor of [args.paginationOpts.cursor, args.paginationOpts.endCursor]) {
      if (cursor === null || cursor === undefined) continue;
      let key: unknown;
      try { key = JSON.parse(cursor); } catch { throw new Error("INVALID_INVITATION_CURSOR"); }
      if (!Array.isArray(key) || (key.length !== 0 && (key.length !== 3 || key[0] !== args.organizationId
        || typeof key[1] !== "number" || !Number.isFinite(key[1]) || typeof key[2] !== "string"
        || !ctx.db.normalizeId("invitation", key[2])))) throw new Error("INVALID_INVITATION_CURSOR");
    }
    const result = await paginator(ctx.db, schema).query("invitation")
      .withIndex("organizationId", q => q.eq("organizationId", args.organizationId)).paginate(args.paginationOpts);
    return { ...result, page: result.page.map(invite => ({ invitationId: invite._id,
      email: invite.email, role: invitationRole(invite.role),
      status: invite.status === "pending" && invite.expiresAt <= Date.now() ? "expired" : invite.status,
      expiresAt: invite.expiresAt, createdAt: invite.createdAt,
      deliveryState: invite.deliveryState ?? "pending", deliveredAt: invite.deliveredAt ?? null,
    })) };
  },
});

const deliveryArgs = { organizationId: v.string(), invitationId: v.string(), tokenHash: v.string(), version: v.number() };

/** Revalidated before every delivery attempt; never exposes capability hashes to a browser. */
export const delivery = query({
  args: deliveryArgs,
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("invitation", args.invitationId);
    if (!id) return null;
    try {
      const { invite, org } = await liveInvitation(ctx, id, args.organizationId);
      if (invite.tokenHash !== args.tokenHash || invite.deliveryVersion !== args.version
        || invite.deliveryState === "sent") return null;
      return { email: invite.email, organizationName: org.name, role: invitationRole(invite.role) };
    } catch { return null; }
  },
});

export const recordDelivery = mutation({
  args: { ...deliveryArgs, sent: v.boolean() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("invitation", args.invitationId);
    const invite = id ? await ctx.db.get(id) : null;
    if (!invite || invite.organizationId !== args.organizationId || invite.tokenHash !== args.tokenHash
      || invite.deliveryVersion !== args.version || invite.status !== "pending"
      || invite.deliveryState === "sent") return { retry: false };
    await ctx.db.patch(invite._id, args.sent
      ? { deliveryState: "sent", deliveredAt: Date.now(), deliveryError: undefined }
      : { deliveryState: "failed", deliveryError: "DELIVERY_FAILED" });
    // Concurrent provider attempts may finish out of order. A successful receipt
    // is terminal for this generation; a late failure must not undo it.
    return { retry: !args.sent };
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
    await requireIdentityMappingWritable(ctx);
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
    await requireIdentityMappingWritable(ctx);
    const { claim, invite } = await registrationClaim(ctx, args.capabilityHash, args.email);
    if (claim.userId) { await organizationUser(ctx, claim.userId); return; }
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
    await requireIdentityMappingWritable(ctx);
    const { invite, user, org } = await recipient(ctx, args.tokenHash, args.organizationId, args.userId, false);
    if (!user.emailVerified) throw new Error("EMAIL_VERIFICATION_REQUIRED");
    const existing = await ctx.db.query("member").withIndex("organizationId_userId", q => q.eq("organizationId", org._id).eq("userId", user._id)).unique();
    if (invite.status === "accepted") {
      if (invite.acceptedUserId !== user._id || !existing || invite.acceptedMemberId !== existing._id) throw new Error("INVALID_MEMBER_INVITATION");
      return { organizationId: org._id, memberId: existing._id, adminPending: Boolean(await ctx.db.query("organizationEnrollments").withIndex("memberId", q => q.eq("memberId", existing._id)).unique()) && existing.role === ORG_MEMBER_ROLE };
    }
    if (existing) throw new Error("ALREADY_ORGANIZATION_MEMBER");
    await membershipCapacity(ctx, org._id);
    const memberId = await ctx.db.insert("member", { organizationId: org._id, userId: user._id, role: ORG_MEMBER_ROLE, createdAt: Date.now() });
    const adminPending = invite.role === ORG_ADMIN_MEMBERSHIP_ROLE;
    if (adminPending) await ctx.db.insert("organizationEnrollments", { organizationId: org._id, userId: user._id, memberId, purpose: "invitation", createdAt: Date.now() });
    await ctx.db.patch(invite._id, { status: "accepted", acceptedUserId: user._id, acceptedMemberId: memberId });
    await appendOrganizationAudit(ctx, { organizationId: org._id, actorId: user._id,
      action: "invitation.accepted", targetId: memberId });
    return { organizationId: org._id, memberId, adminPending };
  },
});
