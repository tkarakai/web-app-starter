import { mutation, query } from "convex/server";
import { v } from "convex/values";

/**
 * List the latest messages for the UI.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_createdAt")
      .order("desc")
      .take(10);
  },
});

/**
 * Create a new message. In a real app, swap the author for authenticated user info.
 */
export const create = mutation({
  args: {
    body: v.string(),
    author: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const author = args.author ?? "Starter User";

    await ctx.db.insert("messages", {
      body: args.body,
      author,
      createdAt: now,
    });
  },
});
