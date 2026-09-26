/** App boundary: authorize here; storage lives in the platform component. */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { components, internal } from "../_generated/api";
import { internalMutation, query } from "../_generated/server";
import { authComponent } from "./auth";
import { authedMutation } from "./functions";
import { rateLimit } from "./rateLimits";

import { parseOnboardingType, isWaitlistOnboarding } from "./onboardingType";
export { validateMeta } from "@web-app-starter/convex-platform/waitlist-validation";
export const join = internalMutation({
  args: {
    email: v.string(),
    meta: v.string(),
    clientIp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {

    // Rate limit by client IP to prevent spam
    await rateLimit(ctx, {
      name: "waitlistJoin",
      key: args.clientIp ?? "unknown",
      throws: true,
    });

    // Waitlist joins are only allowed in waitlist onboarding mode.
    const onboardingTypeRaw = await ctx.runQuery(
      internal.platform.appSettings.getInternal,
      { key: "onboardingType" }
    );
    const onboardingType = parseOnboardingType(onboardingTypeRaw);
    if (!isWaitlistOnboarding(onboardingType)) {
      throw new Error("WAITLIST_NOT_ENABLED");
    }

    return await ctx.runMutation(components.platform.waitlist.join, args);
  },
});

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

    // Exclude emails that belong to admin accounts
    const adminEmailDocs = await ctx.db.query("adminEmails").collect();
    return await ctx.runQuery(components.platform.waitlist.list, { ...args, adminEmails: adminEmailDocs.map(row => row.email) });
  },
});

export const invite = authedMutation({
  args: { entryId: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");
    const result = await ctx.runMutation(components.platform.waitlist.invite, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
    await ctx.scheduler.runAfter(0, internal.platform.waitlistActions.generateTokenAndSendEmail, result);
  },
});

export const inviteMany = authedMutation({
  args: { emails: v.array(v.string()) },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");
    const result = await ctx.runMutation(components.platform.waitlist.inviteMany, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
    for (const delivery of result.deliveries) {
      await ctx.scheduler.runAfter(0, internal.platform.waitlistActions.generateTokenAndSendEmail, delivery);
    }
    return { invited: result.invited, skipped: result.skipped };
  },
});

export const uninvite = authedMutation({
  args: { entryId: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.waitlist.uninvite, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  },
});

export const remove = authedMutation({
  args: { entryId: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.waitlist.remove, { ...args, identity: { userId: ctx.ownerId, actor: String((ctx.user as Record<string, unknown>).email) } });
  },
});
