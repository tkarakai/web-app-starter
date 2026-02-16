import { Resend } from "resend";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { buildInvitationEmailHtml } from "./emailTemplates";

/** Default token expiry in days (can be overridden via appSettings). */
const DEFAULT_EXPIRY_DAYS = 7;

/**
 * Generate a crypto-random invitation token, store it, and send the invitation
 * email via Resend. Scheduled by the `waitlist.invite` mutation.
 */
export const generateTokenAndSendEmail = internalAction({
  args: {
    entryId: v.id("waitlistEntries"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // Read configurable expiry from appSettings (admin-configurable, default 7)
    const expiryDays: number =
      ((await ctx.runQuery(internal.appSettings.getInternal, {
        key: "invitationTokenExpiryDays",
      })) as number | null) ?? DEFAULT_EXPIRY_DAYS;

    // Generate crypto-random token (32 bytes = 64 hex chars)
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes, (b) =>
      b.toString(16).padStart(2, "0")
    ).join("");

    const now = Date.now();
    const expiresAt = now + 2 * 60 * 1000; // TEMP: 2 minutes for testing

    // Store the token
    await ctx.runMutation(internal.waitlistTokens.create, {
      waitlistEntryId: args.entryId,
      token,
      email: args.email,
      expiresAt,
    });

    // Build the signup URL
    const siteUrl = (process.env.SITE_URL ?? "http://localhost:3001")
      .split(",")[0]
      .trim();
    const signupUrl = `${siteUrl}/signup-with-invitation?token=${token}`;

    // Send invitation email via Resend
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // In development without Resend configured, log the URL instead
      console.log(
        `[waitlist] Invitation email (no RESEND_API_KEY configured):\n` +
          `  To: ${args.email}\n` +
          `  Signup URL: ${signupUrl}\n` +
          `  Expires in: ${expiryDays} days`
      );
      return;
    }

    const resend = new Resend(apiKey);
    const emailFrom = process.env.EMAIL_FROM ?? "noreply@example.com";

    await resend.emails.send({
      from: emailFrom,
      to: args.email,
      subject: "You're invited to join!",
      html: buildInvitationEmailHtml("there", signupUrl, expiryDays),
    });
  },
});
