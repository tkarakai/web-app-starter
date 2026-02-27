import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

import { internalMutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { authedMutation } from "./functions";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Admin query: list admin invitations (paginated)
// ---------------------------------------------------------------------------

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    const role = user ? (user as Record<string, unknown>).role : undefined;
    if (role !== "admin") {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }

    const entries = await ctx.db
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

// ---------------------------------------------------------------------------
// Admin mutation: invite a single email as admin
// ---------------------------------------------------------------------------

export const invite = authedMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");

    const email = args.email.trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email)) {
      throw new Error("INVALID_EMAIL");
    }

    // Check for existing invitation
    const existing = await ctx.db
      .query("adminInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (existing) {
      if (existing.status === "claimed") {
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
      });
    } else {
      const now = Date.now();
      await ctx.db.insert("adminInvitations", {
        email,
        status: "invited",
        invitedAt: now,
        createdAt: now,
      });
    }

    // Ensure the email is in adminEmails so the databaseHook
    // auto-promotes them to admin role on signup.
    const existingAdmin = await ctx.db
      .query("adminEmails")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!existingAdmin) {
      await ctx.db.insert("adminEmails", { email });
    }

    const actorEmail = (ctx.user as Record<string, unknown>).email as string;
    await scheduleAuditEvent(ctx, {
      actor: actorEmail,
      authenticatedUserId: ctx.ownerId,
      sourceDetail: "admin-mutation",
      action: "admin.invitation.sent",
      resource: `admin-invitation:${email}`,
      status: "succeeded",
      meta: JSON.stringify({ inviteeEmail: email }),
    });
  },
});

// ---------------------------------------------------------------------------
// Admin mutation: revoke admin invitation
// ---------------------------------------------------------------------------

export const uninvite = authedMutation({
  args: { entryId: v.id("adminInvitations") },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("ENTRY_NOT_FOUND");
    if (entry.status === "claimed") throw new Error("ALREADY_CLAIMED");

    await ctx.db.patch(args.entryId, {
      status: "invited",
      invitedAt: undefined,
      invitationExpiresAt: undefined,
    });

    const actorEmail = (ctx.user as Record<string, unknown>).email as string;
    await scheduleAuditEvent(ctx, {
      actor: actorEmail,
      authenticatedUserId: ctx.ownerId,
      sourceDetail: "admin-mutation",
      action: "admin.invitation.revoked",
      resource: `admin-invitation:${args.entryId}`,
      status: "succeeded",
      meta: JSON.stringify({ inviteeEmail: entry.email }),
    });
  },
});

// ---------------------------------------------------------------------------
// Admin mutation: delete admin invitation
// ---------------------------------------------------------------------------

export const remove = authedMutation({
  args: { entryId: v.id("adminInvitations") },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("ENTRY_NOT_FOUND");
    if (entry.status === "claimed") throw new Error("CANNOT_DELETE_CLAIMED");

    await ctx.db.delete(args.entryId);

    const actorEmail = (ctx.user as Record<string, unknown>).email as string;
    await scheduleAuditEvent(ctx, {
      actor: actorEmail,
      authenticatedUserId: ctx.ownerId,
      sourceDetail: "admin-mutation",
      action: "admin.invitation.deleted",
      resource: `admin-invitation:${args.entryId}`,
      status: "succeeded",
      meta: JSON.stringify({ inviteeEmail: entry.email }),
    });
  },
});

// ---------------------------------------------------------------------------
// Internal: create admin invitation entry (for dev seed)
// ---------------------------------------------------------------------------

export const createForSeed = internalMutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("adminInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (existing) return;

    const now = Date.now();
    await ctx.db.insert("adminInvitations", {
      email: args.email,
      status: "claimed",
      invitedAt: now,
      claimedAt: now,
      createdAt: now,
    });
  },
});
