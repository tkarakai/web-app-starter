import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { hasExclusiveFileOwnership, requireFileAccess } from "./fileAccess";
import {
  authedMutation, authedQuery, getAuth, assertMaxLength, MAX_NAME_LENGTH,
} from "./platform/functions";
import { rateLimit } from "./platform/rateLimits";
import { requireProjectAccess } from "./projectAccess";

const MAX_FILE_SIZE = 1_048_576;
const legacyContext = { organizationId: v.optional(v.string()) };

/** Allowed content types for uploads. Reject executables, HTML, SVG, etc. */
export const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/zip",
]);

// Compatibility tombstones: even previously issued upload URLs cannot confer ownership.
export const generateUploadUrl = authedMutation({
  args: {},
  handler: async (): Promise<never> => { throw new Error("USE_AUTHENTICATED_UPLOAD"); },
});

export const saveUpload = authedMutation({
  args: { storageId: v.id("_storage"), name: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args): Promise<never> => {
    await requireProjectAccess(ctx, args.projectId);
    throw new Error("USE_AUTHENTICATED_UPLOAD");
  },
});

export const beginUpload = internalMutation({
  args: { ...legacyContext, projectId: v.id("projects") },
  handler: async (ctx, args): Promise<string> => {
    const auth = await getAuth(ctx);
    if (!auth) throw new Error("NOT_AUTHENTICATED");
    await requireProjectAccess({ ...ctx, ...auth }, args.projectId, args.organizationId);
    await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
    return auth.ownerId;
  },
});

export const finishUpload = internalMutation({
  args: {
    ...legacyContext,
    projectId: v.id("projects"), storageId: v.id("_storage"), name: v.string(),
    contentType: v.string(), size: v.number(), ownerId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"uploads">> => {
    const auth = await getAuth(ctx);
    if (!auth || auth.ownerId !== args.ownerId) throw new Error("NOT_AUTHENTICATED");
    await requireProjectAccess({ ...ctx, ...auth }, args.projectId, args.organizationId);
    const existing = await ctx.db.query("uploads")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).first();
    if (existing) throw new Error("FILE_ALREADY_REGISTERED");
    // Captured personal context authorizes the legacy bridge; it does not migrate this row.
    return ctx.db.insert("uploads", { projectId: args.projectId, storageId: args.storageId, name: args.name,
      contentType: args.contentType, size: args.size, ownerId: args.ownerId, ownershipVersion: 1, createdAt: Date.now() });
  },
});

export const discardUnattachedUpload = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    // A finalization may have committed even when its action lost the response.
    const attached = await ctx.db.query("uploads")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).first();
    if (!attached) await ctx.storage.delete(args.storageId);
  },
});

/** Accept bytes, never a caller-selected storage ID or owner. */
export const uploadFile = action({
  args: { ...legacyContext, projectId: v.id("projects"), name: v.string(), contentType: v.string(), bytes: v.bytes() },
  handler: async (ctx, args): Promise<Id<"uploads">> => {
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    if (args.bytes.byteLength > MAX_FILE_SIZE) throw new Error("FILE_TOO_LARGE");
    if (!ALLOWED_CONTENT_TYPES.has(args.contentType)) throw new Error("FILE_TYPE_NOT_ALLOWED");
    const ownerId = await ctx.runMutation(internal.files.beginUpload, { projectId: args.projectId, organizationId: args.organizationId });
    const storageId = await ctx.storage.store(new Blob([args.bytes], { type: args.contentType }));
    try {
      return await ctx.runMutation(internal.files.finishUpload, {
        projectId: args.projectId, organizationId: args.organizationId, name: args.name, contentType: args.contentType,
        size: args.bytes.byteLength, storageId, ownerId,
      });
    } catch (error) {
      // This ID was created by this action; cleanup cannot target caller-selected bytes.
      await ctx.runMutation(internal.files.discardUnattachedUpload, { storageId });
      throw error;
    }
  },
});

export const authorizeDownload = internalQuery({
  args: { ...legacyContext, id: v.id("uploads") },
  handler: async (ctx, args) => {
    const auth = await getAuth(ctx);
    if (!auth) throw new Error("NOT_AUTHENTICATED");
    const upload = await ctx.db.get(args.id);
    if (!upload) throw new Error("UPLOAD_NOT_FOUND");
    await requireFileAccess({ ...ctx, ...auth }, upload, args.organizationId);
    return upload;
  },
});

/** Reauthorize each read; no transferable storage URL is returned. */
export const downloadFile = action({
  args: { ...legacyContext, id: v.id("uploads") },
  handler: async (ctx, args): Promise<{ bytes: ArrayBuffer; name: string; contentType: string }> => {
    const upload = await ctx.runQuery(internal.files.authorizeDownload, args);
    const blob = await ctx.storage.get(upload.storageId);
    if (!blob) throw new Error("FILE_NOT_FOUND");
    const bytes = await blob.arrayBuffer();
    // Permissions can change while the storage read is in flight.
    const current = await ctx.runQuery(internal.files.authorizeDownload, args);
    if (current.storageId !== upload.storageId) throw new Error("FILE_CHANGED");
    return { bytes, name: upload.name, contentType: upload.contentType };
  },
});

export const listUploads = authedQuery({
  args: { ...legacyContext, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, args.organizationId);
    const uploads = await ctx.db.query("uploads")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId)).order("desc").collect();
    if (uploads.some(upload => upload.organizationId !== undefined || upload.ownerId !== ctx.ownerId)) throw new Error("LEGACY_RESOURCE_REQUIRES_MIGRATION");
    return Promise.all(uploads.map(async (upload) => ({
      _id: upload._id, name: upload.name, size: upload.size, contentType: upload.contentType,
      available: await hasExclusiveFileOwnership(ctx, upload),
    })));
  },
});

export const deleteUpload = authedMutation({
  args: { ...legacyContext, id: v.id("uploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.id);
    if (!upload) throw new Error("UPLOAD_NOT_FOUND");
    await requireFileAccess(ctx, upload, args.organizationId);
    await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(args.id);
  },
});

/** Operator-only, read-only inventory. Never infer ownership from legacy claims. */
export const inventoryLegacyUploads = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("uploads").paginate({
      ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, 100),
    });
    const page = await Promise.all(result.page.map(async (upload) => {
      const refs = await ctx.db.query("uploads")
        .withIndex("by_storage", (q) => q.eq("storageId", upload.storageId)).take(101);
      const project = await ctx.db.get(upload.projectId);
      return {
        uploadId: upload._id, storageId: upload.storageId, ownerId: upload.ownerId,
        projectId: upload.projectId, projectOwnerId: project?.ownerId ?? null,
        ownershipVerified: upload.ownershipVersion === 1,
        references: refs.map((ref) => ({ id: ref._id, ownerId: ref.ownerId, projectId: ref.projectId })),
        referencesTruncated: refs.length === 101,
      };
    }));
    return { ...result, page };
  },
});
