/** App boundary: authorize here; storage lives in the platform component. */
import { v } from "convex/values";

import { components } from "../_generated/api";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";

import { authedQuery } from "./functions";
import { rateLimit } from "./rateLimits";
import { sha256Hex } from "./tokenHash";
export const create = internalMutation({
  args: {
    waitlistEntryId: v.string(),
    tokenHash: v.string(),
    email: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.platform.waitlistTokens.create, args);
  },
});

export const validate = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.platform.waitlistTokens.validate, args);
  },
});

export const beginClaim = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await rateLimit(ctx, { name: "tokenClaim", key: sha256Hex(args.token), throws: true });
    return await ctx.runMutation(components.platform.waitlistTokens.beginClaim, args);
  },
});

export const finalizeClaim = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await rateLimit(ctx, { name: "tokenClaim", key: sha256Hex(args.token), throws: true });
    return await ctx.runMutation(components.platform.waitlistTokens.finalizeClaim, args);
  },
});

export const releaseClaim = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await rateLimit(ctx, { name: "tokenClaim", key: sha256Hex(args.token), throws: true });
    return await ctx.runMutation(components.platform.waitlistTokens.releaseClaim, args);
  },
});

export const hasValidInvitation = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.platform.waitlistTokens.hasValidInvitation, args);
  },
});

export const listByEntry = authedQuery({
  args: { waitlistEntryId: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") return null;
    return await ctx.runQuery(components.platform.waitlistTokens.listByEntry, args);
  },
});
