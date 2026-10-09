import { ORG_ADMIN_MEMBERSHIP_ROLE } from "./betterAuth/organizationVocabulary";
import { hashPassword } from "better-auth/crypto";
import { appConfig } from "@web-app-starter/app-config";
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { createAuth } from "./auth";
import { authorizedSession, identitySession, readPolicies } from "./sessionPolicy";
import { sha256Hex } from "./tokenHash";
import { validatePasswordStrength } from "./passwordStrength";

const inviteArgs = { organizationId: v.string(), token: v.string() };
function tokenHash(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("INVALID_MEMBER_INVITATION");
  return sha256Hex(token);
}

/** Token-holder metadata only; neither an invitation ID nor a slug is a signup capability. */
export const preview = action({
  args: inviteArgs,
  handler: async (ctx, args) => {
    const hash = tokenHash(args.token);
    const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "tokenClaim", key: hash });
    if (!limit.ok) throw new Error("RATE_LIMITED");
    return ctx.runQuery(components.betterAuth.memberInvitations.preview, { organizationId: args.organizationId, tokenHash: hash });
  },
});

export const claim = action({
  args: inviteArgs,
  handler: async (ctx, args) => {
    const hash = tokenHash(args.token);
    const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "tokenClaim", key: hash });
    if (!limit.ok) throw new Error("RATE_LIMITED");
    const capability = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    return { ...await ctx.runMutation(components.betterAuth.memberInvitations.exchange, {
      organizationId: args.organizationId, tokenHash: hash, capabilityHash: sha256Hex(capability),
    }), capability };
  },
});

/** No session, email-verification bypass or personal organization is created. Sign in normally afterward. */
export const register = action({
  args: { capability: v.string(), email: v.string(), name: v.string(), password: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const capabilityHash = tokenHash(args.capability);
    const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "tokenClaim", key: capabilityHash });
    if (!limit.ok) throw new Error("RATE_LIMITED");
    const enrollment = await ctx.runQuery(components.betterAuth.memberInvitations.registration, { capabilityHash, email });
    // A lost response may be retried, but never changes the account's credentials.
    if (enrollment.userId) return null;
    if (await ctx.runQuery(components.platform.adminInvitations.requiresEnrollment, { email })) throw new Error("ADMIN_ENROLLMENT_REQUIRED");
    if (!args.name.trim() || args.name.length > 200 || args.password.length > 128) throw new Error("INVALID_ACCOUNT_DETAILS");
    const strength = validatePasswordStrength(args.password, email, enrollment.role === ORG_ADMIN_MEMBERSHIP_ROLE ? "admin" : "user");
    if (!strength.valid) throw new Error(strength.reason);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new globalThis.TextEncoder().encode(args.password)));
    const sha1 = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const response = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, { headers: { "Add-Padding": "true" } });
    if (!response.ok) throw new Error("PASSWORD_CHECK_UNAVAILABLE");
    if ((await response.text()).split("\n").some(line => line.split(":")[0].trim() === sha1.slice(5))) throw new Error("PASSWORD_COMPROMISED");
    await ctx.runMutation(internal.platform.memberInvitations.registerAccount, { capabilityHash, email, name: args.name.trim(), passwordHash: await hashPassword(args.password) });
    return null;
  },
});

/** App-operator reservation and invitation state rechecked in the same account-creation transaction. */
export const registerAccount = internalMutation({
  args: { capabilityHash: v.string(), email: v.string(), name: v.string(), passwordHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await ctx.runQuery(components.platform.adminInvitations.requiresEnrollment, { email: args.email })) throw new Error("ADMIN_ENROLLMENT_REQUIRED");
    await ctx.runMutation(components.betterAuth.memberInvitations.register, args);
    return null;
  },
});

export const recipientSnapshot = internalQuery({
  args: inviteArgs,
  handler: async (ctx, args) => {
    const pair = await identitySession(ctx);
    if (!pair || pair.session.authPurpose === "mcp-authorization") throw new Error("NOT_AUTHENTICATED");
    if ((await readPolicies(ctx, pair.user)).scope !== "user"
      || await ctx.runQuery(components.platform.adminInvitations.requiresEnrollment, { email: pair.user.email })) throw new Error("NOT_CUSTOMER");
    return ctx.runQuery(components.betterAuth.memberInvitations.verificationRecipient, { organizationId: args.organizationId,
      tokenHash: tokenHash(args.token), userId: pair.user._id });
  },
});

/** Mandatory recipient verification still works when ordinary user email verification is optional. */
export const requestVerification = action({
  args: inviteArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const { email } = await ctx.runQuery(internal.platform.memberInvitations.recipientSnapshot, args);
    const site = process.env.SITE_URL?.split(",")[0]?.trim();
    if (!site) throw new Error("SITE_URL_NOT_CONFIGURED");
    const auth = createAuth(ctx, { requireMemberVerification: true });
    await auth.api.sendVerificationEmail({ body: { email, callbackURL: `${site}/${appConfig.i18n.defaultLocale}/verify-email` } });
    return null;
  },
});

/** Exact verified recipient, ordinary applicable assurance, active organization availability and atomic membership admission. */
export const accept = mutation({
  args: inviteArgs,
  handler: async (ctx, args) => {
    const pair = await authorizedSession(ctx);
    if (!pair) throw new Error("NOT_AUTHENTICATED");
    if (pair.assurance.scope !== "user"
      || await ctx.runQuery(components.platform.adminInvitations.requiresEnrollment, { email: pair.user.email })) throw new Error("NOT_CUSTOMER");
    return ctx.runMutation(components.betterAuth.memberInvitations.accept, { organizationId: args.organizationId,
      tokenHash: tokenHash(args.token), userId: pair.user._id });
  },
});
