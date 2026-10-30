/** Durable, deployment-bound organization cutover bookkeeping. Never reset during recovery. */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const organizationMigrationTables = {
  organizationMigrationState: defineTable({
    key: v.literal("organization-v1"), deployment: v.string(), deploymentVersion: v.string(), registryHash: v.string(),
    phase: v.union(v.literal("maintenance"), v.literal("ready")), stage: v.number(), cursor: v.union(v.string(), v.null()),
    scanned: v.number(), startedAt: v.number(), verifiedAt: v.optional(v.number()), legacyRetired: v.boolean(),
    problem: v.optional(v.string()), nextDeploymentVersion: v.optional(v.string()), recoverySequence: v.optional(v.number()),
  }).index("by_key", ["key"]),
  organizationOwnerMappings: defineTable({
    ownerId: v.string(), authSubject: v.string(), organizationId: v.optional(v.string()),
    disposition: v.union(v.literal("personal"), v.literal("member-only"), v.literal("app-operator"), v.literal("app-operator-pending")),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]).index("by_subject", ["authSubject"]),
  organizationMigrationDispositions: defineTable({
    key: v.string(), source: v.string(), sourceId: v.string(), disposition: v.string(), fingerprint: v.string(),
    transition: v.optional(v.object({ deployment: v.string(), fromDeploymentVersion: v.string(),
      pendingDeploymentVersion: v.string(), nextDeploymentVersion: v.string(), happenedAt: v.number() })),
  }).index("by_key", ["key"])
    .index("by_recovery_pending", ["transition.pendingDeploymentVersion"])
    .index("by_recovery_origin", ["transition.fromDeploymentVersion"]),
};
