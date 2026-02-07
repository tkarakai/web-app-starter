import { v } from "convex/values";

import { authedMutation, authedQuery, requireProjectAccess } from "./functions";

const MAX_FILE_SIZE = 1_048_576; // 1MB

export const generateUploadUrl = authedMutation({
  args: {},
  handler: async (ctx) => {
    return ctx.storage.generateUploadUrl();
  },
});

export const saveUpload = authedMutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    if (args.size > MAX_FILE_SIZE) {
      throw new Error("File too large (max 1MB)");
    }

    await requireProjectAccess(ctx, args.projectId);

    return ctx.db.insert("uploads", {
      storageId: args.storageId,
      name: args.name,
      contentType: args.contentType,
      size: args.size,
      projectId: args.projectId,
      ownerId: ctx.ownerId,
      createdAt: Date.now(),
    });
  },
});

export const listUploads = authedQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);

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

export const deleteUpload = authedMutation({
  args: { id: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.id);
    if (!upload) {
      throw new Error("Upload not found");
    }

    // Verify ownership through the project chain
    await requireProjectAccess(ctx, upload.projectId);

    await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(args.id);
  },
});
