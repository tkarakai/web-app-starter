import { assertOrganizationWriteAllowed } from "./platform/organizationReadiness";
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { tenantMutation, tenantQuery } from "./platform/tenantFunctions";
import { requireTenantContext } from "./platform/tenantContext";
import { assertMaxLength, MAX_NAME_LENGTH } from "./platform/functions";
import { rateLimit } from "./platform/rateLimits";
import { ALLOWED_CONTENT_TYPES } from "./files";
import { requireTenantFile, requireTenantProject } from "./tenantAccess";

const context = { organizationId: v.string() };
export const beginUpload = internalMutation({
  args: { ...context, projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await assertOrganizationWriteAllowed(ctx, "tenant");
    const auth = await requireTenantContext(ctx, args.organizationId);
    await requireTenantProject({ ...ctx, ...auth }, args.projectId);
    await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
    return auth.ownerId;
  },
});
export const finishUpload = internalMutation({
  args: { ...context, projectId: v.id("projects"), storageId: v.id("_storage"), name: v.string(), contentType: v.string(), size: v.number(), ownerId: v.string() },
  handler: async (ctx, args) => {
    await assertOrganizationWriteAllowed(ctx, "tenant");
    const auth = await requireTenantContext(ctx, args.organizationId);
    if (auth.ownerId !== args.ownerId) throw new Error("NOT_AUTHENTICATED");
    await requireTenantProject({ ...ctx, ...auth }, args.projectId);
    if (await ctx.db.query("uploads").withIndex("by_storage", q => q.eq("storageId", args.storageId)).first()) throw new Error("FILE_ALREADY_REGISTERED");
    return ctx.db.insert("uploads", { ...args, ownershipVersion: 1, createdAt: Date.now() });
  },
});
export const uploadFile = action({
  args: { ...context, projectId: v.id("projects"), name: v.string(), contentType: v.string(), bytes: v.bytes() },
  handler: async (ctx, args): Promise<Id<"uploads">> => {
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    if (args.bytes.byteLength > 1_048_576) throw new Error("FILE_TOO_LARGE");
    if (!ALLOWED_CONTENT_TYPES.has(args.contentType)) throw new Error("FILE_TYPE_NOT_ALLOWED");
    const ownerId = await ctx.runMutation(internal.tenantFiles.beginUpload, { organizationId: args.organizationId, projectId: args.projectId });
    const storageId = await ctx.storage.store(new Blob([args.bytes], { type: args.contentType }));
    try {
      return await ctx.runMutation(internal.tenantFiles.finishUpload, { organizationId: args.organizationId,
        projectId: args.projectId, storageId, name: args.name, contentType: args.contentType, size: args.bytes.byteLength, ownerId });
    } catch (error) {
      await ctx.runMutation(internal.files.discardUnattachedUpload, { storageId });
      throw error;
    }
  },
});
export const authorizeDownload = internalQuery({
  args: { ...context, id: v.id("uploads") },
  handler: async (ctx, args) => {
    await assertOrganizationWriteAllowed(ctx, "tenant");
    const auth = await requireTenantContext(ctx, args.organizationId);
    const upload = await ctx.db.get(args.id);
    if (!upload) throw new Error("UPLOAD_NOT_FOUND");
    await requireTenantFile({ ...ctx, ...auth }, upload);
    return upload;
  },
});
export const downloadFile = action({
  args: { ...context, id: v.id("uploads") },
  handler: async (ctx, args): Promise<{ bytes: ArrayBuffer; name: string; contentType: string }> => {
    const upload = await ctx.runQuery(internal.tenantFiles.authorizeDownload, args);
    const blob = await ctx.storage.get(upload.storageId);
    if (!blob) throw new Error("FILE_NOT_FOUND");
    const bytes = await blob.arrayBuffer();
    const current = await ctx.runQuery(internal.tenantFiles.authorizeDownload, args);
    if (current.storageId !== upload.storageId) throw new Error("FILE_CHANGED");
    return { bytes, name: upload.name, contentType: upload.contentType };
  },
});
export const listUploads = tenantQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireTenantProject(ctx, projectId);
    const rows = await ctx.db.query("uploads").withIndex("by_project", q => q.eq("projectId", projectId)).collect();
    const page = [];
    for (const row of rows) { await requireTenantFile(ctx, row); page.push({ _id: row._id, name: row.name, contentType: row.contentType, size: row.size }); }
    return page;
  },
});
export const deleteUpload = tenantMutation({
  args: { id: v.id("uploads") },
  handler: async (ctx, { id }) => {
    const upload = await ctx.db.get(id);
    if (!upload) throw new Error("UPLOAD_NOT_FOUND");
    await requireTenantFile(ctx, upload);
    await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(id);
  },
});
