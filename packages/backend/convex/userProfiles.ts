import { v } from "convex/values";
import { locales } from "@repo/i18n";
import { authedMutation, authedQuery } from "./functions";

/**
 * Get the current user's full profile.
 * Returns null if no profile exists yet (safe for useQuery subscriptions).
 */
export const get = authedQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("userProfiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.ownerId))
      .first();
  },
});

/**
 * Get just the locale preference.
 * Returns null if no profile or no locale set.
 * Useful for initial page load to avoid sending the full profile.
 */
export const getLocale = authedQuery({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.ownerId))
      .first();
    return profile?.locale ?? null;
  },
});

/**
 * Update user preferences.
 * Creates the profile if it doesn't exist (upsert pattern).
 * Only updates fields that are explicitly provided.
 */
export const upsert = authedMutation({
  args: {
    locale: v.optional(v.string()),
    theme: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate locale if provided
    if (args.locale && !locales.includes(args.locale as any)) {
      throw new Error("INVALID_LOCALE");
    }

    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.ownerId))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing profile (only fields that are provided)
      const updates: Record<string, string | number> = { updatedAt: now };
      if (args.locale !== undefined) updates.locale = args.locale;
      if (args.theme !== undefined) updates.theme = args.theme;
      if (args.timezone !== undefined) updates.timezone = args.timezone;

      await ctx.db.patch(existing._id, updates);
      return existing._id;
    } else {
      // Create new profile
      return ctx.db.insert("userProfiles", {
        ownerId: ctx.ownerId,
        locale: args.locale,
        theme: args.theme,
        timezone: args.timezone,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Set just the locale preference (convenience method).
 * Used by the locale switcher.
 */
export const setLocale = authedMutation({
  args: { locale: v.string() },
  handler: async (ctx, args) => {
    if (!locales.includes(args.locale as any)) {
      throw new Error("INVALID_LOCALE");
    }

    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.ownerId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        locale: args.locale,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return ctx.db.insert("userProfiles", {
        ownerId: ctx.ownerId,
        locale: args.locale,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});
