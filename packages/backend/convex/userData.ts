import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Optional, idempotent app-owned account cleanup. Shared rows belong to organizationData.ts. */
export const deleteUserData = internalMutation({
  args: { userId: v.string(), ownerId: v.string() },
  handler: async (_ctx, _args) => {
    // The reference app has only organization-owned domain data.
  },
});
