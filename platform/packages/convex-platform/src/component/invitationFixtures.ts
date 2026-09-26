import { v } from "convex/values";
import { mutation } from "./_generated/server";
/** Trusted host seed operations; callers enforce dev/E2E guards. */
export const prepare = mutation({
  args: { email: v.string(), meta: v.string(), token: v.string(), ttlMs: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    // Waitlist entry — skip if already exists (idempotent for retries).
    const existingEntry = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (existingEntry) return;

    const entryId = await ctx.db.insert("waitlistEntries", {
      email: args.email,
      meta: args.meta,
      status: "claimed",
      createdAt: now,
      invitedAt: now,
      claimedAt: now,
    });

    // Invitation token in "claiming" state — hasValidInvitation checks for
    // status "claiming" or "claimed" with a non-expired expiresAt.
    await ctx.db.insert("invitationTokens", {
      waitlistEntryId: entryId,
      token: args.token,
      email: args.email,
      status: "claiming",
      expiresAt: now + args.ttlMs, // 1 year
      createdAt: now,
      claimStartedAt: now,
    });
  },
});

export const finalize = mutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const token = await ctx.db
      .query("invitationTokens")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (token && token.status === "claiming") {
      await ctx.db.patch(token._id, {
        status: "claimed",
        claimedAt: Date.now(),
      });
    }
  },
});
