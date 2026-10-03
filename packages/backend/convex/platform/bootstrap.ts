/**
 * Admin bootstrap — first-time deployment setup.
 *
 * When a fresh Convex project is deployed, the database is empty: no admin
 * emails, no waitlist entries, no invitation tokens. These internal functions
 * let an operator seed the first admin from the Convex dashboard without
 * needing a UI.
 *
 * Operator commands and rescue restrictions are documented in
 * platform/docs/deployment-runbook.md#step-2-bootstrap-the-first-admin.
 *
 * All three functions are `internalMutation`/`internalQuery` — they are **not**
 * callable from the client. Run them from the Convex dashboard or via
 * `bunx convex run`.
 *
 * @module
 */
import { v } from "convex/values";

import { components, internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { assertMaxLength, MAX_NAME_LENGTH } from "./functions";

/** Basic email format check — must contain @ and be reasonable length. */
function assertValidEmail(email: string): void {
  assertMaxLength(email, MAX_NAME_LENGTH, "EMAIL");
  if (!email.includes("@") || email.length < 3) {
    throw new Error("BOOTSTRAP_INVALID_EMAIL");
  }
}

// ---------------------------------------------------------------------------
// platform/bootstrap:initialize — first-time admin setup
// ---------------------------------------------------------------------------

export const initialize = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    args.email = args.email.trim().toLowerCase();
    const account = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: args.email }] });
    if (account) throw new Error("BOOTSTRAP_ACCOUNT_EXISTS");
    const existing = await ctx.runQuery(components.platform.adminEmails.list, {});
    if (existing.length > 0) {
      throw new Error("BOOTSTRAP_ALREADY_INITIALIZED");
    }

    assertValidEmail(args.email);

    await ctx.runMutation(components.platform.adminEmails.ensure, { email: args.email });
    const entryId = await ctx.runMutation(components.platform.waitlistBootstrap.initialize, args);

    // Schedule the token generation + email action (same as waitlist.invite)
    await ctx.scheduler.runAfter(
      0,
      internal.platform.waitlistActions.generateTokenAndSendEmail,
      { entryId, email: args.email },
    );

    return {
      success: true,
      email: args.email,
      message: `Invitation sent to ${args.email}. Check inbox (in local development without RESEND_API_KEY, the Convex logs).`,
    };
  },
});

// ---------------------------------------------------------------------------
// platform/bootstrap:rescue — fix a failed bootstrap (typo, expired token, etc.)
// ---------------------------------------------------------------------------

export const rescue = internalMutation({
  args: {
    currentEmail: v.string(),
    newEmail: v.string(),
  },
  handler: async (ctx, args) => {
    args.currentEmail = args.currentEmail.trim().toLowerCase();
    args.newEmail = args.newEmail.trim().toLowerCase();
    for (const email of new Set([args.currentEmail, args.newEmail])) {
      const account = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] });
      if (account) throw new Error("BOOTSTRAP_ACCOUNT_EXISTS");
    }
    // Guard: exactly one admin email must exist
    const adminEmails = await ctx.runQuery(components.platform.adminEmails.list, {});
    if (adminEmails.length === 0) {
      throw new Error("BOOTSTRAP_NOT_INITIALIZED");
    }
    if (adminEmails.length > 1) {
      throw new Error("BOOTSTRAP_MULTIPLE_ADMINS");
    }

    // Guard: caller must prove they know the current email
    const adminRow = adminEmails[0];
    if (adminRow.email.trim().toLowerCase() !== args.currentEmail) {
      throw new Error("BOOTSTRAP_EMAIL_MISMATCH");
    }

    assertValidEmail(args.newEmail);
    const entryId = await ctx.runMutation(components.platform.waitlistBootstrap.rescue, { currentEmail: adminRow.email, newEmail: args.newEmail });
    const emailChanged = args.newEmail !== args.currentEmail;
    if (adminRow.email !== args.newEmail) await ctx.runMutation(components.platform.adminEmails.replace, { id: adminRow._id, email: args.newEmail });

    const state = await ctx.runQuery(components.platform.waitlistBootstrap.state, { email: args.newEmail });
    await ctx.scheduler.runAfter(
      0,
      internal.platform.waitlistActions.generateTokenAndSendEmail,
      { entryId, email: args.newEmail, generation: state.waitlistEntry?.invitationGeneration },
    );

    return {
      success: true,
      email: args.newEmail,
      previousEmail: args.currentEmail,
      changed: emailChanged,
      message: emailChanged
        ? `Admin email updated from ${args.currentEmail} to ${args.newEmail}. New invitation sent.`
        : `Invitation resent to ${args.newEmail}. Check inbox (in local development without RESEND_API_KEY, the Convex logs).`,
    };
  },
});

// ---------------------------------------------------------------------------
// platform/bootstrap:status — diagnostic for bootstrap state
// ---------------------------------------------------------------------------

export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const adminEmails = await ctx.runQuery(components.platform.adminEmails.list, {});

    if (adminEmails.length === 0) {
      return {
        bootstrapped: false,
        adminEmail: null,
        waitlistStatus: null,
        tokenStatus: null,
        tokenExpired: null,
        hint: "Run platform/bootstrap:initialize to set up the first admin.",
      };
    }

    const adminEmail = adminEmails[0].email;

    const { waitlistEntry, tokens } = await ctx.runQuery(components.platform.waitlistBootstrap.state, { email: adminEmail });
    if (waitlistEntry?.status === "claimed") return { bootstrapped: true, adminEmail };

    const latestToken = tokens.length > 0
      ? tokens.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
      : null;

    const now = Date.now();
    const tokenExpired = latestToken ? now > latestToken.expiresAt : null;
    const tokenStatus = latestToken?.status ?? null;

    // Build actionable hint
    let hint: string;
    if (!waitlistEntry) {
      hint = "Waitlist entry is missing. Run platform/bootstrap:rescue to recreate.";
    } else if (!latestToken) {
      hint = "Token generation may have failed. Run platform/bootstrap:rescue to retry.";
    } else if (tokenExpired) {
      hint = "Invitation token expired. Run platform/bootstrap:rescue to resend.";
    } else if (tokenStatus === "revoked") {
      hint = "Invitation was revoked. Run platform/bootstrap:rescue to resend.";
    } else if (tokenStatus === "claiming") {
      hint = "Signup is in progress. The admin is currently completing registration.";
    } else {
      hint = "Invitation is active. Check inbox (in local development without RESEND_API_KEY, the Convex logs).";
    }

    return {
      bootstrapped: false,
      adminEmail,
      waitlistStatus: waitlistEntry?.status ?? null,
      tokenStatus,
      tokenExpired,
      hint,
    };
  },
});
