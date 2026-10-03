import { ensureAdminEmail } from "./adminEmails";
/** Trusted app callers only; clients use the authenticated app wrappers. */
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./functions";

import { scheduleAuditEvent } from "./auditTrailHelpers";

import { sha256Hex } from "./tokenHash";
import schema, { adminInvitationsFields } from "./schema";
const row = v.object({ _id: v.id("adminInvitations"), _creationTime: v.number(), ...adminInvitationsFields });

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ ...row.fields, invitationExpired: v.boolean() })),
  handler: async (ctx, args) => {    const entries = await paginator(ctx.db, schema)
      .query("adminInvitations")
      .withIndex("by_created")
      .order("desc")
      .paginate(args.paginationOpts);

    const now = Date.now();

    return {
      ...entries,
      page: entries.page.map((entry) => ({
        ...entry,
        invitationExpired:
          entry.status === "invited" &&
          entry.invitationExpiresAt != null &&
          now > entry.invitationExpiresAt,
      })),
    };
  
  },
});

export const invite = mutation({
  args: { identity: v.object({ userId: v.string(), actor: v.string() }), email: v.string() },
  returns: v.object({ adminInvitationId: v.id("adminInvitations"), email: v.string() }),
  handler: async (ctx, args) => {

    const email = args.email.trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email)) {
      throw new Error("INVALID_EMAIL");
    }

    // Check for existing invitation
    const existing = await ctx.db
      .query("adminInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    let invitationId: Id<"adminInvitations">;

    if (existing) {
      if ((existing.status === "claimed" && existing.userId) || existing.status === "completed") {
        throw new Error("ALREADY_CLAIMED");
      }
      const alreadyInvited =
        existing.status === "invited" &&
        (!existing.invitationExpiresAt ||
          Date.now() <= existing.invitationExpiresAt);
      if (alreadyInvited) {
        throw new Error("ALREADY_INVITED");
      }
      // Re-invite (expired invitation)
      await ctx.db.patch(existing._id, {
        status: "invited",
        invitedAt: Date.now(),
        invitationExpiresAt: undefined,
        token: undefined,
      });
      invitationId = existing._id;
    } else {
      const now = Date.now();
      invitationId = await ctx.db.insert("adminInvitations", {
        email,
        status: "invited",
        invitedAt: now,
        createdAt: now,
      });
    }

    // Invitation and protected-address records never authorize account creation.

    const actorEmail = args.identity.actor;
    await scheduleAuditEvent(ctx, {
      actor: actorEmail,
      authenticatedUserId: args.identity.userId,
      sourceDetail: "admin-mutation",
      action: "admin.invitation.sent",
      resource: `admin-invitation:${email}`,
      status: "succeeded",
      meta: JSON.stringify({ inviteeEmail: email }),
    });

    return { adminInvitationId: invitationId, email };

  },
});

export const remove = mutation({
  args: { identity: v.object({ userId: v.string(), actor: v.string() }), entryId: v.id("adminInvitations") },
  returns: v.null(),
  handler: async (ctx, args) => {

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("ENTRY_NOT_FOUND");
    if (entry.status === "claimed" || entry.status === "completed") {
      throw new Error("CANNOT_DELETE_CLAIMED");
    }

    await ctx.db.delete(args.entryId);

    const actorEmail = args.identity.actor;
    await scheduleAuditEvent(ctx, {
      actor: actorEmail,
      authenticatedUserId: args.identity.userId,
      sourceDetail: "admin-mutation",
      action: "admin.invitation.deleted",
      resource: `admin-invitation:${args.entryId}`,
      status: "succeeded",
      meta: JSON.stringify({ inviteeEmail: entry.email }),
    });
  
  },
});

export const createForSeed = mutation({
  args: {
    email: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("adminInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (existing) return;

    const now = Date.now();
    await ctx.db.insert("adminInvitations", {
      email: args.email,
      status: "completed",
      invitedAt: now,
      claimedAt: now,
      createdAt: now,
    });
  
  },
});

export const setToken = mutation({
  args: {
    adminInvitationId: v.id("adminInvitations"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // The `token` field stores a SHA-256 hash, not the raw token.
    await ctx.db.patch(args.adminInvitationId, {
      token: args.tokenHash,
      invitationExpiresAt: args.expiresAt,
    });
  
  },
});

export const validateToken = query({
  args: { token: v.string() },
  returns: v.union(v.object({ valid: v.literal(false), reason: v.union(v.literal("NOT_FOUND"), v.literal("ALREADY_CLAIMED"), v.literal("EXPIRED")) }), v.object({ valid: v.literal(true), email: v.string() })),
  handler: async (ctx, args) => {
    const tokenHash = sha256Hex(args.token);
    const doc = await ctx.db
      .query("adminInvitations")
      .withIndex("by_token", (q) => q.eq("token", tokenHash))
      .unique();

    if (!doc) {
      return { valid: false as const, reason: "NOT_FOUND" as const };
    }
    if (doc.status === "claimed" || doc.status === "completed") {
      return { valid: false as const, reason: "ALREADY_CLAIMED" as const };
    }
    if (doc.invitationExpiresAt && Date.now() > doc.invitationExpiresAt) {
      return { valid: false as const, reason: "EXPIRED" as const };
    }

    return { valid: true as const, email: doc.email };
  
  },
});

/** A token claim alone never authorizes another account to become an admin. */
export const claimInvitation = mutation({
  args: { token: v.string() }, returns: v.object({ email: v.string() }),
  handler: async (ctx, { token }) => ({ email: (await enrollmentSource(ctx, sha256Hex(token))).email }),
});

export const advanceOnboardingStep = mutation({
  args: { email: v.string(), step: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {    const doc = await ctx.db
      .query("adminInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (!doc || doc.status !== "claimed") return;

    await ctx.db.patch(doc._id, { onboardingStep: args.step });
  
  },
});

export const completeOnboarding = mutation({
  args: { email: v.string(),},
  returns: v.null(),
  handler: async (ctx, args) => {    const doc = await ctx.db
      .query("adminInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (!doc || doc.status === "completed") return;

    await ctx.db.patch(doc._id, {
      status: "completed",
      onboardingStep: undefined,
    });
  
  },
});

export const getMyOnboardingStatus = query({
  args: { email: v.string(),},
  returns: v.object({ completed: v.boolean(), step: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {    const doc = await ctx.db
      .query("adminInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (!doc) return { completed: true, step: null };

    return {
      completed: doc.status === "completed",
      step: doc.onboardingStep ?? null,
    };
  
  },
});

export const hasValidAdminInvitation = query({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("adminInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (!doc) return false;
    // An admin with a claimed or completed invitation already has an account
    if (doc.status === "claimed" || doc.status === "completed") return true;
    // A valid invitation: status is "invited" and not expired
    if (doc.invitationExpiresAt && Date.now() > doc.invitationExpiresAt) {
      return false;
    }
    return true;
  
  },
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Resolve fresh ordinary invitations and pre-existing bootstrap invitations. */
async function enrollmentSource(ctx: QueryCtx, tokenHash: string) {
  const admin = await ctx.db.query("adminInvitations").withIndex("by_token", q => q.eq("token", tokenHash)).unique();
  if (admin) {
    if (admin.status !== "invited" || !admin.invitationExpiresAt || admin.invitationExpiresAt <= Date.now()) throw new Error("INVALID_INVITATION");
    return { email: normalizeEmail(admin.email), expiresAt: admin.invitationExpiresAt, admin, bootstrap: null };
  }
  const bootstrap = await ctx.db.query("invitationTokens").withIndex("by_token", q => q.eq("token", tokenHash)).unique();
  if (!bootstrap || !["sent", "claiming"].includes(bootstrap.status) || bootstrap.expiresAt <= Date.now()) throw new Error("INVALID_INVITATION");
  const email = normalizeEmail(bootstrap.email);
  const protectedEmails = await ctx.db.query("adminEmails").collect();
  if (!protectedEmails.some(row => normalizeEmail(row.email) === email)) throw new Error("INVALID_INVITATION");
  const entry = await ctx.db.get(bootstrap.waitlistEntryId);
  if (!entry || entry.status === "claimed" || normalizeEmail(entry.email) !== email) throw new Error("INVALID_INVITATION");
  return { email, expiresAt: bootstrap.expiresAt, admin: null, bootstrap };
}

export const validateEnrollmentToken = query({
  args: { token: v.string() },
  returns: v.union(v.object({ valid: v.literal(true), email: v.string() }), v.object({ valid: v.literal(false), reason: v.literal("INVALID_INVITATION") })),
  handler: async (ctx, { token }) => {
    try { const source = await enrollmentSource(ctx, sha256Hex(token)); return { valid: true as const, email: source.email }; }
    catch { return { valid: false as const, reason: "INVALID_INVITATION" as const }; }
  },
});

export const requiresEnrollment = query({
  args: { email: v.string() }, returns: v.boolean(),
  handler: async (ctx, { email }) => {
    email = normalizeEmail(email);
    // Also recognize mixed-case protected addresses from older deployments.
    if ((await ctx.db.query("adminEmails").collect()).some(row => normalizeEmail(row.email) === email)) return true;
    return (await ctx.db.query("adminInvitations").withIndex("by_email", q => q.eq("email", email)).first()) !== null;
  },
});

export const exchangeEnrollment = mutation({
  args: { token: v.string(), capabilityHash: v.string() },
  returns: v.object({ email: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const tokenHash = sha256Hex(args.token);
    const source = await enrollmentSource(ctx, tokenHash);
    const expired = await ctx.db.query("adminEnrollments").withIndex("by_expiresAt", q => q.lte("expiresAt", Date.now())).take(100);
    for (const row of expired) await ctx.db.delete(row._id);
    const expiresAt = Math.min(source.expiresAt, Date.now() + 10 * 60_000);
    await ctx.db.insert("adminEnrollments", { email: source.email, capabilityHash: args.capabilityHash, tokenHash, expiresAt });
    return { email: source.email, expiresAt };
  },
});

export const enrollment = query({
  args: { capabilityHash: v.string(), email: v.string() },
  returns: v.object({ email: v.string(), userId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("adminEnrollments").withIndex("by_capability", q => q.eq("capabilityHash", args.capabilityHash)).unique();
    if (!row || row.email !== normalizeEmail(args.email) || row.expiresAt <= Date.now()) throw new Error("INVALID_ENROLLMENT");
    if (!row.userId) await enrollmentSource(ctx, row.tokenHash);
    return { email: row.email, userId: row.userId };
  },
});

/** Called inside the app mutation that also creates the credential account. */
export const consumeEnrollment = mutation({
  args: { capabilityHash: v.string(), email: v.string(), userId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("adminEnrollments").withIndex("by_capability", q => q.eq("capabilityHash", args.capabilityHash)).unique();
    if (!row || row.email !== normalizeEmail(args.email) || row.expiresAt <= Date.now()) throw new Error("INVALID_ENROLLMENT");
    if (row.userId) { if (row.userId !== args.userId) throw new Error("ENROLLMENT_ALREADY_USED"); return; }
    const source = await enrollmentSource(ctx, row.tokenHash);
    const now = Date.now();
    if (source.admin) {
      await ctx.db.patch(source.admin._id, { status: "claimed", userId: args.userId, claimedAt: now, onboardingStep: 1 });
    } else if (source.bootstrap) {
      await ctx.db.patch(source.bootstrap._id, { status: "claimed", claimedAt: now });
      await ctx.db.patch(source.bootstrap.waitlistEntryId, { status: "claimed", claimedAt: now });
      const existing = await ctx.db.query("adminInvitations").withIndex("by_email", q => q.eq("email", row.email)).first();
      if (existing) throw new Error("ENROLLMENT_ALREADY_EXISTS");
      await ctx.db.insert("adminInvitations", { email: row.email, status: "claimed", userId: args.userId, claimedAt: now, onboardingStep: 1, invitedAt: now, createdAt: now });
    }
    // Reserve the proven account for admin password/protection policy; no role grant.
    await ensureAdminEmail(ctx, row.email);
    await ctx.db.patch(row._id, { userId: args.userId });
  },
});

export const boundOnboarding = query({
  args: { email: v.string(), userId: v.string() },
  returns: v.union(v.null(), v.object({ completed: v.boolean(), step: v.number() })),
  handler: async (ctx, args) => {
    const doc = await ctx.db.query("adminInvitations").withIndex("by_email", q => q.eq("email", normalizeEmail(args.email))).unique();
    if (!doc || doc.userId !== args.userId) return null;
    return { completed: doc.status === "completed", step: doc.onboardingStep ?? 1 };
  },
});

export const finishBoundOnboarding = mutation({
  args: { email: v.string(), userId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.query("adminInvitations").withIndex("by_email", q => q.eq("email", normalizeEmail(args.email))).unique();
    if (!doc || doc.userId !== args.userId || doc.status === "invited") throw new Error("INVALID_ENROLLMENT");
    await ctx.db.patch(doc._id, { status: "completed", onboardingStep: undefined });
    await ensureAdminEmail(ctx, doc.email);
  },
});
