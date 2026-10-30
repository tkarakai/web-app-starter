/** App-side settings API: authorize here, store and validate in the platform component. */
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalQuery, query } from "../_generated/server";
import { appOperatorMutation, appOperatorQuery } from "./functions";
import { DEFAULT_EMAIL_TEMPLATE, DEFAULT_VERIFICATION_EMAIL_TEMPLATE, type EmailTemplate } from "./emailTemplates";
import { readAdminPasskeyPolicy } from "./organizationPolicy";
import { isPasskeyPolicy } from "./securityPolicies";
import { runAuditEvent } from "./auditTrailHelpers";

export const getPublic = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (args.key === "adminPasskeyPolicy") return readAdminPasskeyPolicy(ctx);
    return await ctx.runQuery(components.platform.appSettings.getPublic, args);
  },
});

export const get = appOperatorQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") return null;
    if (args.key === "adminPasskeyPolicy") return readAdminPasskeyPolicy(ctx);
    return await ctx.runQuery(components.platform.appSettings.get, args);
  },
});

export const getInternal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (args.key === "adminPasskeyPolicy") return readAdminPasskeyPolicy(ctx);
    return await ctx.runQuery(components.platform.appSettings.getInternal, args);
  },
});

export const set = appOperatorMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    if (args.key === "adminPasskeyPolicy") {
      if (!isPasskeyPolicy(args.value)) throw new Error("INVALID_VALUE");
      const previous = await readAdminPasskeyPolicy(ctx);
      await ctx.runMutation(components.betterAuth.organizationSecurity.setPolicy, args);
      await runAuditEvent(ctx, { happenedAt: Date.now(), actor: ctx.ownerId, authenticatedUserId: ctx.user._id,
        sourceDetail: "admin-settings", action: "admin.admin_passkey_policy_changed", resource: "appSettings:adminPasskeyPolicy",
        status: "succeeded", oldValue: previous, newValue: args.value });
      return null;
    }
    return await ctx.runMutation(components.platform.appSettings.set, { ...args, userId: ctx.ownerId });
  },
});

export const remove = appOperatorMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    if (args.key === "adminPasskeyPolicy") {
      const previous = await readAdminPasskeyPolicy(ctx);
      await ctx.runMutation(components.betterAuth.organizationSecurity.setPolicy, { key: args.key, value: "optional" });
      await runAuditEvent(ctx, { happenedAt: Date.now(), actor: ctx.ownerId, authenticatedUserId: ctx.user._id,
        sourceDetail: "admin-settings", action: "admin.admin_passkey_policy_changed", resource: "appSettings:adminPasskeyPolicy",
        status: "succeeded", oldValue: previous, newValue: "optional" });
      return null;
    }
    return await ctx.runMutation(components.platform.appSettings.remove, args);
  },
});

export const getEmailTemplate = appOperatorQuery({
  args: {},
  handler: async (ctx) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") return null;
    const setting = await ctx.runQuery(components.platform.appSettings.getRaw, { key: "invitationEmailTemplate" });
    return setting ? { ...(JSON.parse(setting.value) as EmailTemplate), isCustom: true as const } : { ...DEFAULT_EMAIL_TEMPLATE, isCustom: false as const };
  },
});

export const getVerificationEmailTemplate = appOperatorQuery({
  args: {},
  handler: async (ctx) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") return null;
    const setting = await ctx.runQuery(components.platform.appSettings.getRaw, { key: "emailVerificationTemplate" });
    return setting ? { ...(JSON.parse(setting.value) as EmailTemplate), isCustom: true as const } : { ...DEFAULT_VERIFICATION_EMAIL_TEMPLATE, isCustom: false as const };
  },
});
