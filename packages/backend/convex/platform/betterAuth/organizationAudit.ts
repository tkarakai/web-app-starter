import { v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { requireOrgAdmin } from "./organizationModel";

/** Tenant history stays in the tenant plane; never place secrets or email bodies here. */
export async function appendOrganizationAudit(ctx: MutationCtx, event: {
  organizationId: string; actorId: string; action: string; targetId?: string;
}) {
  await ctx.db.insert("organizationAudit", { ...event, happenedAt: Date.now() });
}

/** Bounded recent membership history for current enrolled administrators only. */
export const list = query({
  args: { organizationId: v.string(), actorId: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId, args.actorId);
    const rows = await ctx.db.query("organizationAudit")
      .withIndex("organizationId_happenedAt", q => q.eq("organizationId", args.organizationId))
      .order("desc").take(100);
    return rows.map(({ _id, actorId, action, targetId, happenedAt }) => ({
      id: _id, actorId, action, targetId, happenedAt,
    }));
  },
});
