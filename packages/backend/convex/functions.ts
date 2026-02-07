import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";

import { authComponent } from "./auth";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

/**
 * Authenticated query builder.
 * Handlers receive `ctx.user` and `ctx.ownerId` automatically.
 * Throws if the caller is not authenticated.
 */
export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const ownerId = (user.userId ?? user._id).toString();
    return { user, ownerId };
  }),
);

/**
 * Authenticated mutation builder.
 * Handlers receive `ctx.user` and `ctx.ownerId` automatically.
 * Throws if the caller is not authenticated.
 */
export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const ownerId = (user.userId ?? user._id).toString();
    return { user, ownerId };
  }),
);

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
    throw new Error("Project not found");
  }
  return project;
}
