import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { waitlistEntriesFields, invitationTokensFields } from "./schema";
const BOOTSTRAP_META = JSON.stringify({ superpowers: ["coffee-to-code"], excitement: ["take-my-money"] });
export const initialize = mutation({
  args: { email: v.string() },
  returns: v.id("waitlistEntries"),
  handler: async (ctx, args) => {
    // Guard: no existing waitlist entry for this email (prevents duplicates
    // that rescue's .first() would silently mishandle)
    const existingEntry = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (existingEntry) {
      throw new Error("BOOTSTRAP_DUPLICATE_WAITLIST_ENTRY");
    }

    // Create a waitlist entry and immediately invite
    const now = Date.now();
    const entryId = await ctx.db.insert("waitlistEntries", {
      email: args.email,
      meta: BOOTSTRAP_META,
      status: "waiting",
      createdAt: now,
    });

    await ctx.db.patch(entryId, {
      status: "invited",
      invitedAt: now,
    });

    return entryId;
  },
});

export const rescue = mutation({
  args: { currentEmail: v.string(), newEmail: v.string() },
  returns: v.id("waitlistEntries"),
  handler: async (ctx, args) => {
    // Guard: bootstrap must not already be complete
    const waitlistEntry = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_email", (q) => q.eq("email", args.currentEmail))
      .first();

    if (waitlistEntry && waitlistEntry.status === "claimed") {
      throw new Error("BOOTSTRAP_ALREADY_COMPLETE");
    }

    const emailChanged = args.newEmail !== args.currentEmail;

    // Guard: no existing waitlist entry for the new email (prevents duplicates
    // when changing email to one that's already on the waitlist)
    if (emailChanged) {
      const existingNewEntry = await ctx.db
        .query("waitlistEntries")
        .withIndex("by_email", (q) => q.eq("email", args.newEmail))
        .first();
      if (existingNewEntry) {
        throw new Error("BOOTSTRAP_DUPLICATE_WAITLIST_ENTRY");
      }
    }

    // Revoke all existing tokens for the old email
    const oldTokens = await ctx.db
      .query("invitationTokens")
      .withIndex("by_email", (q) => q.eq("email", args.currentEmail))
      .collect();

    const revokeNow = Date.now();
    for (const token of oldTokens) {
      if (token.status === "sent" || token.status === "claiming") {
        await ctx.db.patch(token._id, { status: "revoked", revokedAt: revokeNow });
      }
    }

    // Handle waitlist entry
    const now = Date.now();
    let entryId;

    if (waitlistEntry) {
      // Reset existing entry
      await ctx.db.patch(waitlistEntry._id, {
        email: args.newEmail,
        status: "waiting",
        invitedAt: undefined,
        invitationExpiresAt: undefined,
      });
      entryId = waitlistEntry._id;
    } else {
      // Edge case: entry was manually deleted — recreate
      entryId = await ctx.db.insert("waitlistEntries", {
        email: args.newEmail,
        meta: BOOTSTRAP_META,
        status: "waiting",
        createdAt: now,
      });
    }

    // Re-invite
    await ctx.db.patch(entryId, {
      status: "invited",
      invitedAt: now,
    });

    return entryId;
  },
});

export const state = query({
  args: { email: v.string() },
  returns: v.object({
    waitlistEntry: v.union(v.null(), v.object({ _id: v.id("waitlistEntries"), _creationTime: v.number(), ...waitlistEntriesFields })),
    tokens: v.array(v.object({ _id: v.id("invitationTokens"), _creationTime: v.number(), ...invitationTokensFields })),
  }),
  handler: async (ctx, args) => {
    const waitlistEntry = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    const tokens = await ctx.db
      .query("invitationTokens")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();

    return { waitlistEntry, tokens };
  },
});
