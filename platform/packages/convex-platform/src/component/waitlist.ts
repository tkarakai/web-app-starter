/** Trusted app callers only; clients use the authenticated app wrappers. */
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { mutation, query } from "./functions";
import type { Id } from "./_generated/dataModel";
import { scheduleAuditEvent } from "./auditTrailHelpers";

import { assertMaxLength, MAX_NAME_LENGTH } from "./inputLimits";

import schema, { waitlistEntriesFields } from "./schema";
const row = v.object({ _id: v.id("waitlistEntries"), _creationTime: v.number(), ...waitlistEntriesFields });

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BULK_INVITE_EMAILS = 100;

import { validateMeta } from "./waitlistValidation";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const join = mutation({
  args: {
    email: v.string(),
    meta: v.string(),
    clientIp: v.optional(v.string()),
  },
  returns: v.object({ alreadyJoined: v.boolean() }),
  handler: async (ctx, args) => {
    // Normalize and validate before lookup so every caller uses the same policy.
    const email = normalizeEmail(args.email);
    assertMaxLength(args.email, MAX_NAME_LENGTH, "EMAIL");
    if (!EMAIL_PATTERN.test(email)) throw new Error("INVALID_EMAIL");
    validateMeta(args.meta);

    // Check for duplicate email
    const existing = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (existing) {
      await scheduleAuditEvent(ctx, {
        actor: email,
        sourceDetail: "waitlist",
        action: "waitlist.joined",
        resource: `waitlist-entry:${existing._id}`,
        status: "succeeded",
        meta: JSON.stringify({
          ip: args.clientIp ?? "unknown",
          alreadyJoined: true,
        }),
      });
      return { alreadyJoined: true };
    }

    const entryId = await ctx.db.insert("waitlistEntries", {
      email,
      meta: args.meta,
      status: "waiting",
      createdAt: Date.now(),
    });

    await scheduleAuditEvent(ctx, {
      actor: email,
      sourceDetail: "waitlist",
      action: "waitlist.joined",
      resource: `waitlist-entry:${entryId}`,
      status: "succeeded",
      meta: JSON.stringify({ ip: args.clientIp ?? "unknown" }),
    });

    return { alreadyJoined: false };
  
  },
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ ...row.fields, invitationExpired: v.boolean() })),
  handler: async (ctx, args) => {
    const adminEmails = await ctx.db.query("adminEmails").collect();
    const adminEmailSet = new Set(adminEmails.map(row => row.email.toLowerCase()));
    const entries = await paginator(ctx.db, schema)
      .query("waitlistEntries")
      .withIndex("by_created")
      .order("desc")
      .filterWith(async entry => !adminEmailSet.has(entry.email.toLowerCase()))
      .paginate(args.paginationOpts);

    const now = Date.now();

    return {
      ...entries,
      page: entries.page
        .map((entry) => ({
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
  args: { identity: v.object({ userId: v.string(), actor: v.string() }), entryId: v.id("waitlistEntries") },
  returns: v.object({ entryId: v.id("waitlistEntries"), email: v.string() }),
  handler: async (ctx, args) => {

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("ENTRY_NOT_FOUND");
    if (entry.status === "claimed") throw new Error("ALREADY_CLAIMED");

    // Allow re-inviting only if the invitation has expired
    if (entry.status === "invited") {
      if (
        !entry.invitationExpiresAt ||
        Date.now() <= entry.invitationExpiresAt
      ) {
        throw new Error("ALREADY_INVITED");
      }
    }

    // Mark as invited
    await ctx.db.patch(args.entryId, {
      status: "invited",
      invitedAt: Date.now(),
    });

    const email = args.identity.actor;
    await scheduleAuditEvent(ctx, {
      actor: email,
      authenticatedUserId: args.identity.userId,
      sourceDetail: "admin-mutation",
      action: "waitlist.invitation.sent",
      resource: `waitlist-entry:${args.entryId}`,
      status: "succeeded",
      meta: JSON.stringify({ inviteeEmail: entry.email }),
    });
  
    return { entryId: args.entryId, email: entry.email };

  },
});

export const inviteMany = mutation({
  args: { identity: v.object({ userId: v.string(), actor: v.string() }), emails: v.array(v.string()) },
  returns: v.object({ invited: v.array(v.string()), skipped: v.array(v.object({ email: v.string(), reason: v.string() })), deliveries: v.array(v.object({ entryId: v.id("waitlistEntries"), email: v.string() })) }),
  handler: async (ctx, args) => {
    if (args.emails.length > MAX_BULK_INVITE_EMAILS) {
      throw new Error("TOO_MANY_EMAILS");
    }

    const normalized = Array.from(
      new Set(args.emails.map((email) => normalizeEmail(email)).filter(Boolean))
    );

    if (normalized.length === 0) {
      throw new Error("NO_EMAILS_PROVIDED");
    }

    const invited: string[] = [];
    const deliveries: Array<{ entryId: Id<"waitlistEntries">; email: string }> = [];
    const skipped: Array<{ email: string; reason: string }> = [];
    const now = Date.now();
    const actorEmail = args.identity.actor;

    for (const email of normalized) {
      if (email.length > MAX_NAME_LENGTH) {
        skipped.push({ email, reason: "EMAIL_TOO_LONG" });
        continue;
      }

      if (!EMAIL_PATTERN.test(email)) {
        skipped.push({ email, reason: "INVALID_EMAIL" });
        continue;
      }

      const existing = await ctx.db
        .query("waitlistEntries")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();

      let entryId: Id<"waitlistEntries">;

      if (existing) {
        if (existing.status === "claimed") {
          skipped.push({ email, reason: "ALREADY_CLAIMED" });
          continue;
        }

        const alreadyInvited =
          existing.status === "invited" &&
          (!existing.invitationExpiresAt || now <= existing.invitationExpiresAt);
        if (alreadyInvited) {
          skipped.push({ email, reason: "ALREADY_INVITED" });
          continue;
        }

        await ctx.db.patch(existing._id, {
          status: "invited",
          invitedAt: now,
          invitationExpiresAt: undefined,
        });
        entryId = existing._id;
      } else {
        entryId = await ctx.db.insert("waitlistEntries", {
          email,
          meta: JSON.stringify({ source: "admin-invite" }),
          status: "invited",
          invitedAt: now,
          createdAt: now,
        });
      }

      deliveries.push({ entryId, email });

      invited.push(email);

      await scheduleAuditEvent(ctx, {
        actor: actorEmail,
        authenticatedUserId: args.identity.userId,
        sourceDetail: "admin-mutation",
        action: "waitlist.invitation.sent",
        resource: `waitlist-entry:${entryId}`,
        status: "succeeded",
        meta: JSON.stringify({ inviteeEmail: email, source: "direct-invite" }),
      });
    }

    return { invited, skipped, deliveries };
  
  },
});

export const uninvite = mutation({
  args: { identity: v.object({ userId: v.string(), actor: v.string() }), entryId: v.id("waitlistEntries") },
  returns: v.null(),
  handler: async (ctx, args) => {

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("ENTRY_NOT_FOUND");
    if (entry.status === "claimed") throw new Error("ALREADY_CLAIMED");

    // Revoke all active tokens for this entry
    const tokens = await ctx.db
      .query("invitationTokens")
      .withIndex("by_waitlist_entry", (q) =>
        q.eq("waitlistEntryId", args.entryId)
      )
      .collect();

    const now = Date.now();
    for (const token of tokens) {
      if (token.status === "sent" || token.status === "claiming") {
        await ctx.db.patch(token._id, { status: "revoked", revokedAt: now });
      }
    }

    // Reset entry to waiting
    await ctx.db.patch(args.entryId, {
      status: "waiting",
      invitedAt: undefined,
      invitationExpiresAt: undefined,
    });

    const email = args.identity.actor;
    await scheduleAuditEvent(ctx, {
      actor: email,
      authenticatedUserId: args.identity.userId,
      sourceDetail: "admin-mutation",
      action: "waitlist.invitation.revoked",
      resource: `waitlist-entry:${args.entryId}`,
      status: "succeeded",
      meta: JSON.stringify({ inviteeEmail: entry.email }),
    });
  
  },
});

export const remove = mutation({
  args: { identity: v.object({ userId: v.string(), actor: v.string() }), entryId: v.id("waitlistEntries") },
  returns: v.null(),
  handler: async (ctx, args) => {

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("ENTRY_NOT_FOUND");
    if (entry.status === "claimed") throw new Error("CANNOT_DELETE_CLAIMED");

    // Delete associated tokens
    const tokens = await ctx.db
      .query("invitationTokens")
      .withIndex("by_waitlist_entry", (q) =>
        q.eq("waitlistEntryId", args.entryId)
      )
      .collect();

    for (const token of tokens) {
      await ctx.db.delete(token._id);
    }

    await ctx.db.delete(args.entryId);

    const email = args.identity.actor;
    await scheduleAuditEvent(ctx, {
      actor: email,
      authenticatedUserId: args.identity.userId,
      sourceDetail: "admin-mutation",
      action: "waitlist.entry.deleted",
      resource: `waitlist-entry:${args.entryId}`,
      status: "succeeded",
      meta: JSON.stringify({ deletedEmail: entry.email }),
    });
  
  },
});
