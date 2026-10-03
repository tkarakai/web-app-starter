import { createApi } from "@convex-dev/better-auth";
import schema from "./schema";
import { createAuthOptions } from "../auth";
import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, createAuthOptions);

export const reuseOtp = mutation({
  args: { identifier: v.string(), value: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("verification")
      .withIndex("identifier", q => q.eq("identifier", args.identifier)).order("desc").first();
    if (existing && existing.expiresAt > Date.now()) return { ...existing, id: existing._id };
    const now = Date.now();
    const data = { ...args, createdAt: now, updatedAt: now };
    const id = await ctx.db.insert("verification", data);
    return { ...data, id };
  },
});
