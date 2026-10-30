import { v } from "convex/values";
import { mutation, type QueryCtx } from "./_generated/server";

/** Mapping reads and identity writes share this row in the same OCC transaction. */
export async function requireIdentityMappingWritable(ctx: Pick<QueryCtx, "db">) {
  const barrier = await ctx.db.query("organizationMigrationBarrier").withIndex("key", q => q.eq("key", "organization-v1")).unique();
  if (barrier?.blocked) throw new Error("ORGANIZATION_MAINTENANCE");
}

/** Trusted root migration orchestration only; no public wrapper or adapter bypass. */
export const set = mutation({
  args: { blocked: v.boolean(), deploymentVersion: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("organizationMigrationBarrier").withIndex("key", q => q.eq("key", "organization-v1")).unique();
    if (existing) await ctx.db.patch(existing._id, args);
    else await ctx.db.insert("organizationMigrationBarrier", { key: "organization-v1", ...args });
  },
});
