import { mutation, query } from "convex/server";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  }
});

export const saveFile = mutation({
  args: {
    storageId: v.string(),
    name: v.string(),
    type: v.string(),
    size: v.number()
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("files", {
      storageId: args.storageId,
      name: args.name,
      type: args.type,
      size: args.size,
      createdAt: Date.now()
    });
  }
});

export const list = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("files")
      .withIndex("by_created_at")
      .order("desc")
      .take(10);
  }
});
