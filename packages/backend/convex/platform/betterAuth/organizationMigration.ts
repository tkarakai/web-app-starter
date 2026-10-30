/** Trusted preserving migration only. This path never changes identity/security state. */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { ORG_ADMIN_MEMBERSHIP_ROLE } from "./organizationVocabulary";

export const provisionLegacyPersonal = mutation({
  args: { userId: v.string(), deploymentVersion: v.string() },
  handler: async (ctx, { userId, deploymentVersion }) => {
    const barrier = await ctx.db.query("organizationMigrationBarrier").withIndex("key", q => q.eq("key", "organization-v1")).unique();
    if (!barrier?.blocked || barrier.deploymentVersion !== deploymentVersion) throw new Error("ORGANIZATION_MIGRATION_BARRIER_REQUIRED");
    const id = ctx.db.normalizeId("user", userId); const user = id ? await ctx.db.get(id) : null;
    if (!user || (user.role ?? "user") !== "user") throw new Error("ORGANIZATION_LEGACY_USER_REQUIRED");
    const existing = await ctx.db.query("organization").withIndex("personalOwnerId", q => q.eq("personalOwnerId", userId)).unique();
    if (existing) {
      const member = await ctx.db.query("member").withIndex("organizationId_userId", q => q.eq("organizationId", existing._id).eq("userId", userId)).unique();
      if (!member || member.role !== ORG_ADMIN_MEMBERSHIP_ROLE) throw new Error("ORGANIZATION_PERSONAL_MEMBERSHIP_INVALID");
      return { organizationId: existing._id, memberId: member._id };
    }
    if (await ctx.db.query("member").withIndex("userId", q => q.eq("userId", userId)).first()
      || await ctx.db.query("organizationInvitationClaims").withIndex("userId", q => q.eq("userId", user._id)).first()) throw new Error("ORGANIZATION_LEGACY_MAPPING_AMBIGUOUS");
    const now = Date.now();
    const organizationId = await ctx.db.insert("organization", { name: "Personal", slug: `personal-${crypto.randomUUID()}`,
      personalOwnerId: userId, experience: "personal", lifecycle: "active", createdAt: now });
    const memberId = await ctx.db.insert("member", { organizationId, userId, role: ORG_ADMIN_MEMBERSHIP_ROLE, createdAt: now });
    return { organizationId, memberId };
  },
});
