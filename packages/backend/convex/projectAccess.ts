import type { Doc, Id } from "./_generated/dataModel";

/**
 * Verify the project belongs to the authenticated user.
 * Use for ALL project-scoped operations (tasks, uploads, etc.)
 * so ownership is always checked through the project chain.
 */
export async function requireProjectAccess(
  ctx: { db: { get: (id: Id<"projects">) => Promise<Doc<"projects"> | null> }; ownerId: string },
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const project = await ctx.db.get(projectId);
  if (!project || project.ownerId !== ctx.ownerId) {
    throw new Error("PROJECT_NOT_FOUND");
  }
  return project;
}
