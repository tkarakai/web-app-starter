import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireLegacyPrivateAccess } from "./platform/tenantContext";

/**
 * Verify the project belongs to the authenticated user.
 * Use for ALL project-scoped operations (tasks, uploads, etc.)
 * so ownership is always checked through the project chain.
 */
export async function requireProjectAccess(
  ctx: QueryCtx & { ownerId: string },
  projectId: Id<"projects">,
  organizationId?: string,
): Promise<Doc<"projects">> {
  const project = await requireOwnedLegacyProject(ctx, projectId);
  const auth = await requireLegacyPrivateAccess(ctx, organizationId);
  if (auth.ownerId !== ctx.ownerId) throw new Error("PROJECT_NOT_FOUND");
  return project;
}

/** Pure ownership/provenance check; not authentication. Entry points must use requireProjectAccess. */
export async function requireOwnedLegacyProject(
  ctx: Pick<QueryCtx, "db"> & { ownerId: string },
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const project = await ctx.db.get(projectId);
  if (!project || project.ownerId !== ctx.ownerId || project.organizationId !== undefined) throw new Error("PROJECT_NOT_FOUND");
  return project;
}
