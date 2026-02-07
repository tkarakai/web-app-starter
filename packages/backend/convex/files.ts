import { v } from "convex/values";

import { authComponent } from "./auth";
import { mutation, query } from "./_generated/server";

const MAX_FILE_SIZE = 1_048_576; // 1MB

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    return ctx.storage.generateUploadUrl();
  },
});

export const saveUpload = mutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    if (args.size > MAX_FILE_SIZE) {
      throw new Error("File too large (max 1MB)");
    }

    const ownerId = (user.userId ?? user._id).toString();

    return ctx.db.insert("uploads", {
      storageId: args.storageId,
      name: args.name,
      contentType: args.contentType,
      size: args.size,
      projectId: args.projectId,
      ownerId,
      createdAt: Date.now(),
    });
  },
});

export const listUploads = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await authComponent.getAuthUser(ctx);
    } catch {
      return [];
    }
    if (!user) {
      return [];
    }

    const uploads = await ctx.db
      .query("uploads")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();

    return Promise.all(
      uploads.map(async (upload) => ({
        ...upload,
        url: await ctx.storage.getUrl(upload.storageId),
      }))
    );
  },
});

export const deleteUpload = mutation({
  args: { id: v.id("uploads") },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const ownerId = (user.userId ?? user._id).toString();
    const upload = await ctx.db.get(args.id);

    if (!upload) {
      throw new Error("Upload not found");
    }

    if (upload.ownerId !== ownerId) {
      throw new Error("Not authorized to delete this upload");
    }

    await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(args.id);
  },
});
