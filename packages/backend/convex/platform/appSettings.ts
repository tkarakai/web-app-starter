/** App-side settings API: authorize here, store and validate in the platform component. */
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalQuery, query } from "../_generated/server";
import { adminMutation, authedQuery } from "./functions";
import { DEFAULT_EMAIL_TEMPLATE, DEFAULT_VERIFICATION_EMAIL_TEMPLATE, type EmailTemplate } from "./emailTemplates";

export const getPublic = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.platform.appSettings.getPublic, args);
  },
});

export const get = authedQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") return null;
    return await ctx.runQuery(components.platform.appSettings.get, args);
  },
});

export const getInternal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.platform.appSettings.getInternal, args);
  },
});

export const set = adminMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.appSettings.set, { ...args, userId: ctx.ownerId });
  },
});

export const remove = adminMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") throw new Error("NOT_ADMIN");
    return await ctx.runMutation(components.platform.appSettings.remove, args);
  },
});

export const getEmailTemplate = authedQuery({
  args: {},
  handler: async (ctx) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") return null;
    const setting = await ctx.runQuery(components.platform.appSettings.getRaw, { key: "invitationEmailTemplate" });
    return setting ? { ...(JSON.parse(setting.value) as EmailTemplate), isCustom: true as const } : { ...DEFAULT_EMAIL_TEMPLATE, isCustom: false as const };
  },
});

export const getVerificationEmailTemplate = authedQuery({
  args: {},
  handler: async (ctx) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") return null;
    const setting = await ctx.runQuery(components.platform.appSettings.getRaw, { key: "emailVerificationTemplate" });
    return setting ? { ...(JSON.parse(setting.value) as EmailTemplate), isCustom: true as const } : { ...DEFAULT_VERIFICATION_EMAIL_TEMPLATE, isCustom: false as const };
  },
});
