import { createApi } from "@convex-dev/better-auth";
import schema from "./schema";
import { createAuthOptions } from "../auth";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { guardAdapterMutation } from "./organizationSecurityGuard";

const adapter = createApi(schema, createAuthOptions);
export const { findOne, findMany } = adapter;
export const create = guardAdapterMutation(adapter.create);
export const updateOne = guardAdapterMutation(adapter.updateOne);
export const updateMany = guardAdapterMutation(adapter.updateMany);
export const deleteOne = guardAdapterMutation(adapter.deleteOne);
export const deleteMany = guardAdapterMutation(adapter.deleteMany);

export const reuseOtp = mutation({
  args: { identifier: v.string(), value: v.string(), expiresAt: v.number(), allowedAttempts: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("verification")
      .withIndex("identifier", q => q.eq("identifier", args.identifier)).order("desc").first();
    const attempts = existing ? Number(existing.value.slice(existing.value.lastIndexOf(":") + 1)) : NaN;
    if (existing && existing.expiresAt > Date.now() && Number.isInteger(attempts)
      && attempts >= 0 && attempts < args.allowedAttempts) return { ...existing, id: existing._id };
    if (existing) await ctx.db.delete(existing._id);
    const now = Date.now();
    const data = { identifier: args.identifier, value: args.value, expiresAt: args.expiresAt, createdAt: now, updatedAt: now };
    const id = await ctx.db.insert("verification", data);
    return { ...data, id };
  },
});
