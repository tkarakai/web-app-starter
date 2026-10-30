import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type { TenantAuth } from "./platform/tenantContext";

type TenantReader = Pick<QueryCtx, "db"> & Pick<TenantAuth, "ownerId" | "organizationId">;
export async function requireTenantProject(ctx: TenantReader, projectId: Id<"projects">) {
  const project = await ctx.db.get(projectId);
  if (!project || project.organizationId !== ctx.organizationId || project.ownerId !== ctx.ownerId) throw new Error("PROJECT_NOT_FOUND");
  return project;
}
export function requireTenantChild(ctx: TenantReader, row: Pick<Doc<"tasks"> | Doc<"uploads">, "ownerId" | "organizationId" | "projectId">, projectId: Id<"projects">) {
  if (row.organizationId !== ctx.organizationId || row.ownerId !== ctx.ownerId || row.projectId !== projectId) throw new Error("RESOURCE_CONTEXT_MISMATCH");
}
export async function requireTenantFile(ctx: TenantReader, upload: Doc<"uploads">) {
  await requireTenantProject(ctx, upload.projectId);
  requireTenantChild(ctx, upload, upload.projectId);
  const refs = await ctx.db.query("uploads").withIndex("by_storage", q => q.eq("storageId", upload.storageId)).take(2);
  if (upload.ownershipVersion !== 1 || refs.length !== 1 || refs[0]._id !== upload._id) throw new Error("FILE_QUARANTINED");
}
