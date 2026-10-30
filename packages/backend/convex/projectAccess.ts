import type { Doc, Id } from "./_generated/dataModel";

/**
 * Verify the project belongs to the caller's active organization.
 * Use for ALL project-scoped operations (tasks, uploads, etc.)
 * so access is always checked through the project chain.
 */
export async function requireProjectAccess(
  ctx: { db: { get: (id: Id<"projects">) => Promise<Doc<"projects"> | null> }; organizationId: string },
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const project = await ctx.db.get(projectId);
  // A project not yet assigned to an organization (before the upgrade migration) is unreachable.
  if (!project?.organizationId || project.organizationId !== ctx.organizationId) {
    throw new Error("PROJECT_NOT_FOUND");
  }
  return project;
}
