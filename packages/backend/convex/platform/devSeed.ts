import { v } from "convex/values";

import { components, internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { createAuth } from "./auth";
import { assertLocalFixtures } from "./localFixtures";

// ---------------------------------------------------------------------------
// Dev-only seed data — hardcoded credentials for local development.
// Authorization is owned by localFixtures.ts and provisioned by the local launcher.
// ---------------------------------------------------------------------------

// Exported so a test can hold every seed password to the active password policy.
// The admin password cannot repeat the account email: zxcvbn scores that as 0.
export const DEV_USERS = [
  { email: "admin@admin.com", password: "admin!admin.comadmin@admin.comadmin#admin.com", name: "Dev Admin", isAdmin: true },
  { email: "user@user.com", password: "user@user.comuser@user.comuser@user.com", name: "Dev User", isAdmin: false },
] as const;

// Sentinel key written to appSettings only after ALL users are fully created.
// This avoids the idempotency bug where partial failures (e.g. signUpEmail
// errors) would leave the sentinel set but accounts in a broken state.
const SEED_SENTINEL_KEY = "devSeedCompleted";

// ---------------------------------------------------------------------------
// Internal query: check if seed already ran
// ---------------------------------------------------------------------------

export const isSeeded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sentinel = await ctx.runQuery(components.platform.appSettings.getRaw, { key: SEED_SENTINEL_KEY });
    return sentinel !== null;
  },
});

// ---------------------------------------------------------------------------
// Internal mutation: mark seed as complete (written as the very last step)
// ---------------------------------------------------------------------------

export const markSeeded = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertLocalFixtures();
    await ctx.runMutation(components.platform.appSettings.putRaw, {
      key: SEED_SENTINEL_KEY,
      value: "true",
    });
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
    assertLocalFixtures();
    await ctx.runMutation(components.platform.invitationFixtures.prepare, { email: args.email, meta: JSON.stringify({ superpowers: ["dev-seed"], excitement: ["dev-seed"] }), token: `dev-seed-${args.email}`, ttlMs: 365 * 24 * 60 * 60_000 });
  },
});

// ---------------------------------------------------------------------------
// Internal mutation: finalize invitation token after signup
// ---------------------------------------------------------------------------

export const finalizeDevToken = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    assertLocalFixtures();
    await ctx.runMutation(components.platform.invitationFixtures.finalize, args);
  },
});

// ---------------------------------------------------------------------------
// Main seed action
// ---------------------------------------------------------------------------

export const seed = internalAction({
  args: {},
  handler: async (ctx) => {
    // Guard: only run when explicitly enabled, and only in local development.
    // DEV_SEED_ENABLED alone is not enough: these accounts have hard-coded
    // passwords, so a stray flag on a hosted deployment must not create them.
    if (process.env.DEV_SEED_ENABLED !== "true") {
      console.log("[devSeed] DEV_SEED_ENABLED is not 'true', skipping");
      return;
    }
    assertLocalFixtures();

    // Idempotent: skip if already seeded
    const alreadySeeded = await ctx.runQuery(internal.platform.devSeed.isSeeded);
    if (alreadySeeded) {
      console.log("[devSeed] Already seeded, skipping");
      return;
    }

    for (const user of DEV_USERS) {
      // 1. Insert DB state (admin email, waitlist entry, invitation token)
      await ctx.runMutation(internal.platform.devSeed.setupDevUser, {
        email: user.email,
        isAdmin: user.isAdmin,
      });

      // 2. Create the user via Better Auth; local fixture privileges are assigned explicitly below.
      //    "User already exists" is expected on retry after partial failure — treat as success.
      const auth = createAuth(ctx);
      try {
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("already exists")) {
          console.log(`[devSeed] ${user.email} already exists, continuing`);
        } else {
          throw error;
        }
      }

      // 3. Mark user as email-verified (requireEmailVerification is enabled).
      //    Use Better Auth's internal adapter to directly update the user record.
      const authForVerify = createAuth(ctx);
      const authContext = await authForVerify.$context;
      const existingUser = await authContext.internalAdapter.findUserByEmail(user.email);
      if (existingUser) {
        await authContext.internalAdapter.updateUser(
          existingUser.user.id,
          { emailVerified: true, role: user.isAdmin ? "admin" : "user" },
        );
      }

      if (user.isAdmin) {
        await ctx.runMutation(components.platform.adminEmails.ensure, { email: user.email });
        await ctx.runMutation(internal.platform.adminInvitations.createForSeed, { email: user.email });
      }

      // 4. Finalize the invitation token
      await ctx.runMutation(internal.platform.devSeed.finalizeDevToken, {
        email: user.email,
      });

      const role = user.isAdmin ? "admin" : "user";
      console.log(`[devSeed] Created ${role}: ${user.email}`);
    }

    // Mark seed as complete — this is the sentinel for isSeeded.
    // Only written after ALL users are fully created.
    await ctx.runMutation(internal.platform.devSeed.markSeeded);

    console.log("[devSeed] Dev seed complete");
  },
});
