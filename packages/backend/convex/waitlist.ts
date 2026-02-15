import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import {
  authedMutation,
  authedQuery,
  assertMaxLength,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from "./functions";
import { rateLimit } from "./rateLimits";

/** Valid superpower values for the waitlist meta field. */
const VALID_SUPERPOWERS = [
  "coffee-to-code",
  "pixel-perfect",
  "bug-whisperer",
  "spreadsheet-wizard",
  "inbox-zero",
  "parallel-parking",
  "remembering-names",
  "never-burning-toast",
  "explaining-tech",
  "finding-restaurants",
  "staying-calm",
  "other",
] as const;

/** Valid excitement values for the waitlist meta field. */
const VALID_EXCITEMENT = [
  "take-my-money",
  "cant-wait",
  "cautiously-optimistic",
  "just-browsing",
  "friend-made-me",
] as const;

/** Validate and parse the JSON meta string. Throws on invalid input. */
function validateMeta(meta: string): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(meta) as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_META: must be valid JSON");
  }

  if (!Array.isArray(parsed.superpowers) || parsed.superpowers.length === 0) {
    throw new Error("INVALID_META: at least one superpower is required");
  }
  for (const s of parsed.superpowers) {
    if (!(VALID_SUPERPOWERS as readonly string[]).includes(s as string)) {
      throw new Error("INVALID_META: invalid superpower value");
    }
  }

  if (!Array.isArray(parsed.excitement) || parsed.excitement.length === 0) {
    throw new Error("INVALID_META: at least one excitement level is required");
  }
  for (const e of parsed.excitement) {
    if (!(VALID_EXCITEMENT as readonly string[]).includes(e as string)) {
      throw new Error("INVALID_META: invalid excitement value");
    }
  }
}

// ---------------------------------------------------------------------------
// Public: join waitlist (called from httpAction, not directly by clients)
// ---------------------------------------------------------------------------

export const join = internalMutation({
  args: {
    email: v.string(),
    meta: v.string(),
    clientIp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Rate limit by client IP to prevent spam
    await rateLimit(ctx, {
      name: "waitlistJoin",
      key: args.clientIp ?? "unknown",
      throws: true,
    });

    // Check waitlist is enabled
    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "waitlistEnabled"))
      .unique();

    const waitlistEnabled = setting ? JSON.parse(setting.value) : true;
    if (waitlistEnabled !== true) {
      throw new Error("WAITLIST_NOT_ENABLED");
    }

    // Validate inputs
    assertMaxLength(args.email, MAX_NAME_LENGTH, "EMAIL");
    assertMaxLength(args.meta, MAX_DESCRIPTION_LENGTH, "META");
    validateMeta(args.meta);

    // Check for duplicate email
    const existing = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (existing) {
      return { alreadyJoined: true };
    }

    await ctx.db.insert("waitlistEntries", {
      email: args.email,
      meta: args.meta,
      status: "waiting",
      createdAt: Date.now(),
    });

    return { alreadyJoined: false };
  },
});

// ---------------------------------------------------------------------------
// Admin: list all waitlist entries
// ---------------------------------------------------------------------------

export const list = authedQuery({
  args: {},
  handler: async (ctx) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") return null;

    return ctx.db
      .query("waitlistEntries")
      .withIndex("by_created")
      .order("desc")
      .collect();
  },
});

// ---------------------------------------------------------------------------
// Admin: invite a waitlist entry (sends email with token)
// ---------------------------------------------------------------------------

export const invite = authedMutation({
  args: { entryId: v.id("waitlistEntries") },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("ENTRY_NOT_FOUND");
    if (entry.status !== "waiting") throw new Error("ALREADY_INVITED");

    // Mark as invited
    await ctx.db.patch(args.entryId, {
      status: "invited",
      invitedAt: Date.now(),
    });

    // Schedule action to generate token + send email
    await ctx.scheduler.runAfter(
      0,
      internal.waitlistActions.generateTokenAndSendEmail,
      {
        entryId: args.entryId,
        email: entry.email,
      }
    );
  },
});

// ---------------------------------------------------------------------------
// Admin: uninvite (revoke invitation if not yet claimed)
// ---------------------------------------------------------------------------

export const uninvite = authedMutation({
  args: { entryId: v.id("waitlistEntries") },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");

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

    for (const token of tokens) {
      if (token.status === "sent" || token.status === "claiming") {
        await ctx.db.patch(token._id, { status: "revoked" });
      }
    }

    // Reset entry to waiting
    await ctx.db.patch(args.entryId, {
      status: "waiting",
      invitedAt: undefined,
    });
  },
});

// ---------------------------------------------------------------------------
// Admin: delete a waitlist entry
// ---------------------------------------------------------------------------

export const remove = authedMutation({
  args: { entryId: v.id("waitlistEntries") },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");

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
  },
});
