import { ensureAdminEmail } from "./adminEmails";
/** Trusted app callers only; clients use the authenticated app wrappers. */
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./functions";

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
      if (existing.status === "claimed" || existing.status === "completed") {
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

    // NOTE: adminEmails is NOT inserted here — it is added only when the
    // invitation token is claimed (claimInvitation), proving token possession.
    // This prevents admin role escalation without the token.

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

export const claimInvitation = mutation({
  args: { token: v.string() },
  returns: v.object({ email: v.string() }),
  handler: async (ctx, args) => {
    const tokenHash = sha256Hex(args.token);
    const doc = await ctx.db
      .query("adminInvitations")
      .withIndex("by_token", (q) => q.eq("token", tokenHash))
      .unique();

    if (!doc) throw new Error("TOKEN_NOT_FOUND");
    if (doc.status === "claimed" || doc.status === "completed") {
      throw new Error("ALREADY_CLAIMED");
    }
    if (doc.invitationExpiresAt && Date.now() > doc.invitationExpiresAt) {
      throw new Error("TOKEN_EXPIRED");
    }

    await ctx.db.patch(doc._id, {
      status: "claimed",
      claimedAt: Date.now(),
      onboardingStep: 1,
    });

    // Token possession has been proved; signup may now promote this email.
    await ensureAdminEmail(ctx, doc.email);
    return { email: doc.email };

  },
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
