import { v } from "convex/values";

import { query } from "./_generated/server";
import { authedMutation } from "./functions";

/**
 * Public query: returns the preferred sign-in method for a given email.
 * Returns only { preferred: string | null } — no sensitive user data.
 */
export const getPreferredMethod = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) return { preferred: null };

    const pref = await ctx.db
      .query("signInPreferences")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    return { preferred: pref?.preferredMethod ?? null };
  },
});

/**
 * Authenticated mutation: updates the user's preferred sign-in method
 * after a successful login.
 */
export const updatePreferredMethod = authedMutation({
  args: {
    method: v.union(
      v.literal("password"),
      v.literal("passkey"),
      v.literal("magicLink"),
    ),
  },
  handler: async (ctx, args) => {
    const email = ((ctx.user as Record<string, unknown>).email as string)
      .trim()
      .toLowerCase();

    const existing = await ctx.db
      .query("signInPreferences")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        preferredMethod: args.method,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("signInPreferences", {
        email,
        preferredMethod: args.method,
        updatedAt: Date.now(),
      });
    }
  },
});
