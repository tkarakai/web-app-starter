/* global TextEncoder */
/** App boundary: authorize here; storage lives in the platform component. */
import { hashPassword } from "better-auth/crypto";
import { sha256Hex } from "./tokenHash";
import { validatePasswordStrength } from "./passwordStrength";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { components, internal } from "../_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { authComponent } from "./auth";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { authedMutation } from "./functions";

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {

    const user = await authComponent.safeGetAuthUser(ctx);
    const role = user ? (user as Record<string, unknown>).role : undefined;
    if (role !== "admin") {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }

    return await ctx.runQuery(components.platform.adminInvitations.list, args);
  },
});

export const invite = authedMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] });
    if (existing) throw new Error("ACCOUNT_ALREADY_EXISTS");
    const result = await ctx.runMutation(components.platform.adminInvitations.invite, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
    await ctx.scheduler.runAfter(0, internal.platform.adminInvitationActions.generateTokenAndSendEmail, result);
  },
});

export const remove = authedMutation({
  args: { entryId: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.adminInvitations.remove, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  },
});

export const createForSeed = internalMutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.platform.adminInvitations.createForSeed, args);
  },
});

export const setToken = internalMutation({
  args: {
    adminInvitationId: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.platform.adminInvitations.setToken, args);
  },
});

export const validateToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.platform.adminInvitations.validateEnrollmentToken, args);
  },
});

export const claimInvitation = action({
  args: { token: v.string() },
  returns: v.object({ capability: v.string(), email: v.string(), expiresAt: v.number() }),
  handler: async (ctx, { token }) => {
    const capability = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
    const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "tokenClaim", key: sha256Hex(token) });
    if (!limit.ok) throw new Error("RATE_LIMITED");
    const result = await ctx.runMutation(components.platform.adminInvitations.exchangeEnrollment, { token, capabilityHash: sha256Hex(capability) });
    return { ...result, capability };
  },
});

export const advanceOnboardingStep = mutation({
  args: { step: v.number() },
  handler: async (ctx, args) => {

    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new ConvexError("NOT_AUTHENTICATED");

    const bound = await ctx.runQuery(components.platform.adminInvitations.boundOnboarding, { email: user.email, userId: user._id });
    if (!bound && user.role !== "admin") throw new Error("INVALID_ENROLLMENT");
    if (!Number.isInteger(args.step) || args.step < 1 || args.step > 3) throw new Error("INVALID_STEP");
    if (args.step >= 2 && user.twoFactorEnabled !== true) throw new Error("MFA_REQUIRED");
    await ctx.runMutation(components.platform.adminInvitations.advanceOnboardingStep, { ...args, email: user.email });
    const saved = bound
      ? await ctx.runQuery(components.platform.adminInvitations.boundOnboarding, { email: user.email, userId: user._id })
      : await ctx.runQuery(components.platform.adminInvitations.getMyOnboardingStatus, { email: user.email });
    if (!saved || saved.step !== args.step) throw new Error("ONBOARDING_PROGRESS_NOT_SAVED");
  },
});

export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx, args) => {

    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("NOT_AUTHENTICATED");

    if (user.banned || !user.emailVerified || user.twoFactorEnabled !== true) throw new Error("MFA_REQUIRED");
    const factor = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: user._id }] });
    if (!factor?.verified) throw new Error("MFA_REQUIRED");
    const bound = await ctx.runQuery(components.platform.adminInvitations.boundOnboarding, { email: user.email, userId: user._id });
    if (bound) {
      if (!bound.completed && bound.step < 3) throw new Error("ONBOARDING_INCOMPLETE");
      const policy = await ctx.runQuery(components.platform.appSettings.getInternal, { key: "adminPasskeyPolicy" });
      if (policy === "required") {
        const passkey = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "passkey", where: [{ field: "userId", value: user._id }] });
        if (!passkey) throw new Error("PASSKEY_REQUIRED");
      }
      await ctx.runMutation(components.platform.adminInvitations.finishBoundOnboarding, { email: user.email, userId: user._id });
      await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: user._id }], update: { role: "admin", updatedAt: Date.now() } } });
      await scheduleAuditEvent(ctx, { actor: user.email, authenticatedUserId: user._id, sourceDetail: "admin-enrollment", action: "admin.onboarding.completed", resource: `user:${user._id}`, status: "succeeded" });
    } else {
      // Already-established legacy administrators retain their existing identity.
      if (user.role !== "admin") throw new Error("INVALID_ENROLLMENT");
      await ctx.runMutation(components.platform.adminInvitations.completeOnboarding, { ...args, email: user.email });
    }
  },
});

export const getMyOnboardingStatus = query({
  args: {},
  handler: async (ctx, args) => {

    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    const bound = await ctx.runQuery(components.platform.adminInvitations.boundOnboarding, { email: user.email, userId: user._id });
    if (bound) return bound;
    if ((user as Record<string, unknown>).role !== "admin") return null;

    return await ctx.runQuery(components.platform.adminInvitations.getMyOnboardingStatus, { ...args, email: user.email });
  },
});

export const hasValidAdminInvitation = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.platform.adminInvitations.hasValidAdminInvitation, args);
  },
});

/** Hashing and the breach lookup run outside the database transaction. */
export const register = action({
  args: { capability: v.string(), email: v.string(), name: v.string(), password: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const capabilityHash = sha256Hex(args.capability);
    const enrollment = await ctx.runQuery(components.platform.adminInvitations.enrollment, { capabilityHash, email });
    // Retrying a completed request is harmless; this never creates a session.
    if (enrollment.userId) return;
    const limit = await ctx.runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "tokenClaim", key: capabilityHash });
    if (!limit.ok) throw new Error("RATE_LIMITED");
    if (!args.name.trim() || args.name.length > 200 || args.password.length > 128) throw new Error("INVALID_ACCOUNT_DETAILS");
    const strength = validatePasswordStrength(args.password, email, "admin");
    if (!strength.valid) throw new Error(strength.reason);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(args.password)));
    const sha1 = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    const response = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, { headers: { "Add-Padding": "true" } });
    if (!response.ok) throw new Error("PASSWORD_CHECK_UNAVAILABLE");
    if ((await response.text()).split("\n").some(line => line.split(":")[0].trim() === sha1.slice(5))) throw new Error("PASSWORD_COMPROMISED");
    const passwordHash = await hashPassword(args.password);
    await ctx.runMutation(internal.platform.adminInvitations.registerAccount, { capabilityHash, email, name: args.name.trim(), passwordHash });
  },
});

/** Convex nested component mutations participate in this single transaction. */
export const registerAccount = internalMutation({
  args: { capabilityHash: v.string(), email: v.string(), name: v.string(), passwordHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const enrollment = await ctx.runQuery(components.platform.adminInvitations.enrollment, { capabilityHash: args.capabilityHash, email: args.email });
    if (enrollment.userId) return;
    const existing = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: enrollment.email }] });
    if (existing) throw new Error("ACCOUNT_ALREADY_EXISTS");
    const now = Date.now();
    const user = await ctx.runMutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      email: enrollment.email, name: args.name, emailVerified: true, role: "user", createdAt: now, updatedAt: now,
    } } });
    await ctx.runMutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
      userId: user._id, accountId: user._id, providerId: "credential", password: args.passwordHash, createdAt: now, updatedAt: now,
    } } });
    await ctx.runMutation(components.platform.adminInvitations.consumeEnrollment, { capabilityHash: args.capabilityHash, email: enrollment.email, userId: user._id });
    await scheduleAuditEvent(ctx, { actor: enrollment.email, authenticatedUserId: user._id, sourceDetail: "admin-enrollment", action: "auth.sign_up", resource: `user:${user._id}`, status: "succeeded" });
  },
});

export const requiresEnrollment = internalQuery({
  args: { email: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => ctx.runQuery(components.platform.adminInvitations.requiresEnrollment, args),
});
