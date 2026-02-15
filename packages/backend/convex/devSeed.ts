import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { createAuth } from "./auth";

// ---------------------------------------------------------------------------
// Dev-only seed data — hardcoded credentials for local development.
// Gated behind DEV_SEED_ENABLED env var (set by dev-start.sh).
// ---------------------------------------------------------------------------

const DEV_USERS = [
  { email: "admin@admin.com", password: "adminadmin", name: "Dev Admin", isAdmin: true },
  { email: "user@user.com", password: "useruser", name: "Dev User", isAdmin: false },
] as const;

// We use the admin email as the sentinel — if it's in adminEmails, seed already ran.
const SEED_SENTINEL_EMAIL = DEV_USERS[0].email;

// ---------------------------------------------------------------------------
// Internal query: check if seed already ran
// ---------------------------------------------------------------------------

export const isSeeded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("adminEmails")
      .withIndex("by_email", (q) => q.eq("email", SEED_SENTINEL_EMAIL))
      .first();
    return !!existing;
  },
});

// ---------------------------------------------------------------------------
// Internal mutation: insert DB state for one dev user
// ---------------------------------------------------------------------------

export const setupDevUser = internalMutation({
  args: {
    email: v.string(),
    isAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Admin email entry (triggers auto-promotion in databaseHook)
    if (args.isAdmin) {
      await ctx.db.insert("adminEmails", { email: args.email });
    }

    // Waitlist entry (claimed)
    const entryId = await ctx.db.insert("waitlistEntries", {
      email: args.email,
      meta: JSON.stringify({ superpowers: ["dev-seed"], excitement: ["dev-seed"] }),
      status: "claimed",
      createdAt: now,
      invitedAt: now,
      claimedAt: now,
    });

    // Invitation token in "claiming" state — hasValidInvitation checks for
    // status "claiming" or "claimed" with a non-expired expiresAt.
    await ctx.db.insert("invitationTokens", {
      waitlistEntryId: entryId,
      token: `dev-seed-${args.email}`,
      email: args.email,
      status: "claiming",
      expiresAt: now + 1000 * 60 * 60 * 24 * 365, // 1 year
      createdAt: now,
      claimStartedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// Internal mutation: finalize invitation token after signup
// ---------------------------------------------------------------------------

export const finalizeDevToken = internalMutation({
  args: { email: v.string() },
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

// ---------------------------------------------------------------------------
// Main seed action
// ---------------------------------------------------------------------------

export const seed = internalAction({
  args: {},
  handler: async (ctx) => {
    // Guard: only run when explicitly enabled
    if (process.env.DEV_SEED_ENABLED !== "true") {
      console.log("[devSeed] DEV_SEED_ENABLED is not 'true', skipping");
      return;
    }

    // Idempotent: skip if already seeded
    const alreadySeeded = await ctx.runQuery(internal.devSeed.isSeeded);
    if (alreadySeeded) {
      console.log("[devSeed] Already seeded, skipping");
      return;
    }

    for (const user of DEV_USERS) {
      // 1. Insert DB state (admin email, waitlist entry, invitation token)
      await ctx.runMutation(internal.devSeed.setupDevUser, {
        email: user.email,
        isAdmin: user.isAdmin,
      });

      // 2. Create the user via Better Auth (hashes password, databaseHook promotes admin)
      const auth = createAuth(ctx);
      const result = await auth.api.signUpEmail({
        body: {
          email: user.email,
          password: user.password,
          name: user.name,
        },
      });

      if (!result?.user) {
        throw new Error(
          `[devSeed] signUpEmail failed for ${user.email}: ${JSON.stringify(result)}`,
        );
      }

      // 3. Finalize the invitation token
      await ctx.runMutation(internal.devSeed.finalizeDevToken, {
        email: user.email,
      });

      const role = user.isAdmin ? "admin" : "user";
      console.log(`[devSeed] Created ${role}: ${user.email}`);
    }

    console.log("[devSeed] Dev seed complete");
  },
});
