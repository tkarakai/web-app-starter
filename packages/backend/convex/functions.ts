import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import type { ObjectType, PropertyValidators } from "convex/values";

import { authComponent } from "./auth";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

/**
 * Resolve the authenticated user without throwing.
 * Uses `authComponent.safeGetAuthUser` (returns undefined when
 * unauthenticated) and derives the canonical `ownerId`.
 */
async function getAuth(ctx: QueryCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return null;
  return { user, ownerId: (user.userId ?? user._id).toString() };
}

type AuthInfo = NonNullable<Awaited<ReturnType<typeof getAuth>>>;

/**
 * Authenticated query builder.
 * Handlers receive `ctx.user` and `ctx.ownerId` automatically.
 * Returns `null` when the caller is not authenticated — safe for
 * reactive `useQuery` subscriptions (no thrown errors to crash the UI).
 */
export function authedQuery<
  ArgsValidator extends PropertyValidators,
  Output,
>(func: {
  args: ArgsValidator;
  handler: (
    ctx: QueryCtx & AuthInfo,
    args: ObjectType<ArgsValidator>,
  ) => Output | Promise<Output>;
}) {
  return query({
    args: func.args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: async (ctx: QueryCtx, args: any): Promise<Output | null> => {
      const auth = await getAuth(ctx);
      if (!auth) return null;
      return func.handler({ ...ctx, ...auth }, args);
    },
  });
}

/**
 * Authenticated mutation builder.
 * Handlers receive `ctx.user` and `ctx.ownerId` automatically.
 * Throws if the caller is not authenticated.
 */
export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const auth = await getAuth(ctx);
    if (!auth) throw new Error("Not authenticated");
    return auth;
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
