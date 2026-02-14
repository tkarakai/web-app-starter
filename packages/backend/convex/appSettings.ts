import { v } from "convex/values";

import { internalQuery, query } from "./_generated/server";
import { authedMutation, authedQuery } from "./functions";

/** Keys that unauthenticated callers may read via getPublic. */
const PUBLIC_KEYS = ["waitlistEnabled"] as const;

/** All valid setting keys and their value validators. */
const VALID_KEYS = ["waitlistEnabled", "invitationTokenExpiryDays"] as const;

/** Default values returned when a key has never been set. */
const DEFAULTS: Record<string, unknown> = {
  waitlistEnabled: false,
  invitationTokenExpiryDays: 7,
};

function getDefault(key: string): unknown {
  return DEFAULTS[key] ?? null;
}

/** Validate the JSON-encoded value for a given key. Throws on invalid input. */
function validateValue(key: string, value: string): void {
  if (key === "waitlistEnabled") {
    if (value !== "true" && value !== "false") {
      throw new Error("INVALID_VALUE: waitlistEnabled must be 'true' or 'false'");
    }
  } else if (key === "invitationTokenExpiryDays") {
    const num = parseInt(value, 10);
    if (Number.isNaN(num) || num < 1 || num > 365) {
      throw new Error(
        "INVALID_VALUE: invitationTokenExpiryDays must be an integer between 1 and 365"
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public query — only for allow-listed keys (used by landing page via httpAction)
// ---------------------------------------------------------------------------

export const getPublic = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (!(PUBLIC_KEYS as readonly string[]).includes(args.key)) return null;

    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    return setting ? JSON.parse(setting.value) : getDefault(args.key);
  },
});

// ---------------------------------------------------------------------------
// Admin query — read any setting
// ---------------------------------------------------------------------------

export const get = authedQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") return null;

    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    return setting ? JSON.parse(setting.value) : getDefault(args.key);
  },
});

// ---------------------------------------------------------------------------
// Admin mutation — upsert a setting
// ---------------------------------------------------------------------------

export const set = authedMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");

    if (!(VALID_KEYS as readonly string[]).includes(args.key)) {
      throw new Error("INVALID_SETTING_KEY");
    }

    validateValue(args.key, args.value);

    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        updatedAt: Date.now(),
        updatedBy: ctx.ownerId,
      });
    } else {
      await ctx.db.insert("appSettings", {
        key: args.key,
        value: args.value,
        updatedAt: Date.now(),
        updatedBy: ctx.ownerId,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Internal query — for use in databaseHooks, httpActions, etc.
// ---------------------------------------------------------------------------

export const getInternal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    return setting ? JSON.parse(setting.value) : getDefault(args.key);
  },
});
