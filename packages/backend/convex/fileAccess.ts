import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireProjectAccess } from "./projectAccess";

/** Legacy and aliased objects have no trustworthy single-owner provenance. */
export async function hasExclusiveFileOwnership(
  ctx: Pick<QueryCtx, "db"> & { ownerId: string },
  upload: Doc<"uploads">,
): Promise<boolean> {
  if (upload.ownershipVersion !== 1 || upload.ownerId !== ctx.ownerId) return false;
  const refs = await ctx.db.query("uploads")
    .withIndex("by_storage", (q) => q.eq("storageId", upload.storageId)).take(2);
  return refs.length === 1 && refs[0]._id === upload._id;
}

export async function requireFileAccess(
  ctx: QueryCtx & { ownerId: string },
  upload: Doc<"uploads">,
): Promise<void> {
  await requireProjectAccess(ctx, upload.projectId);
  if (!await hasExclusiveFileOwnership(ctx, upload)) throw new Error("FILE_QUARANTINED");
}
