import { mutation, query } from "convex/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_created_at")
      .order("desc")
      .take(25);
  }
});

export const add = mutation({
  args: {
    author: v.string(),
    body: v.string()
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      author: args.author,
      body: args.body,
      createdAt: Date.now()
    });
  }
});
