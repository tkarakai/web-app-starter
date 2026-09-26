import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const auditTrailFields = {
  happenedAt: v.number(),
  authenticatedUserId: v.optional(v.string()),
  actor: v.string(),
  source: v.string(),
  action: v.string(),
  resource: v.string(),
  status: v.string(),
  oldValue: v.optional(v.string()),
  newValue: v.optional(v.string()),
  reason: v.optional(v.string()),
  meta: v.optional(v.string()),
  truncatedFields: v.optional(v.string()),
};

export default defineSchema({
  auditTrail: defineTable({
    ...auditTrailFields,
    // SPIKE: set only on rows copied from the app's legacy `auditTrail` table.
    // Holds the legacy document's `_id` (a plain string across the component
    // boundary) so the copy is idempotent and verifiable.
    legacyId: v.optional(v.string()),
    // The legacy row's `_creationTime`; component rows get a new one on insert.
    legacyCreationTime: v.optional(v.number()),
  })
    .index("by_happenedAt", ["happenedAt"])
    .index("by_action_happenedAt", ["action", "happenedAt"])
    .index("by_actor_happenedAt", ["actor", "happenedAt"])
    .index("by_source_happenedAt", ["source", "happenedAt"])
    .index("by_status_happenedAt", ["status", "happenedAt"])
    .index("by_action_status_happenedAt", ["action", "status", "happenedAt"])
    .index("by_authenticatedUserId_happenedAt", [
      "authenticatedUserId",
      "happenedAt",
    ])
    .index("by_legacyId", ["legacyId"]),
});
