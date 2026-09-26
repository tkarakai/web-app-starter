/** App boundary: authorize here; storage lives in the platform component. */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { components, internal } from "../_generated/api";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { authComponent } from "./auth";
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
    return await ctx.runQuery(components.platform.adminInvitations.validateToken, args);
  },
});

export const claimInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(components.platform.adminInvitations.claimInvitation, args);
    // Add email to adminEmails so the auth hook auto-promotes to admin on
    // signup. This only happens after token validation — proving possession.
    const existingAdmin = await ctx.db
      .query("adminEmails")
      .withIndex("by_email", (q) => q.eq("email", result.email))
      .first();
    if (!existingAdmin) {
      await ctx.db.insert("adminEmails", { email: result.email });
    }
    },
});

export const advanceOnboardingStep = mutation({
  args: { step: v.number() },
  handler: async (ctx, args) => {

    // Auth session may not have propagated yet during onboarding (race with
    // Better Auth sign-up). This mutation is non-critical — it only persists
    // the step for resume-on-abandon — so silently bail out if unauthenticated.
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return;

    return await ctx.runMutation(components.platform.adminInvitations.advanceOnboardingStep, { ...args, email: user.email });
  },
});

export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx, args) => {

    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new Error("NOT_AUTHENTICATED");

    return await ctx.runMutation(components.platform.adminInvitations.completeOnboarding, { ...args, email: user.email });
  },
});

export const getMyOnboardingStatus = query({
  args: {},
  handler: async (ctx, args) => {

    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
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
