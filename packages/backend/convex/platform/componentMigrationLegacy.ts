/** Legacy schema is used ONLY by the v2 component migration, not the live app schema. */
import { defineSchema, defineTable, type DataModelFromSchemaDefinition, type GenericDatabaseReader, type GenericDatabaseWriter } from "convex/server";
import { v } from "convex/values";

export const legacyTables = {
adminEmails: defineTable({
    email: v.string(),
  }).index("by_email", ["email"]),
appSettings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  }).index("by_key", ["key"]),
waitlistEntries: defineTable({
    email: v.string(),
    meta: v.string(), // App-owned JSON object, stored as a string
    status: v.union(
      v.literal("waiting"),
      v.literal("invited"),
      v.literal("claimed")
    ),
    invitedAt: v.optional(v.number()),
    invitationExpiresAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),
invitationTokens: defineTable({
    waitlistEntryId: v.id("waitlistEntries"),
    token: v.string(),
    email: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("claiming"),
      v.literal("claimed"),
      v.literal("revoked")
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    claimedAt: v.optional(v.number()),
    claimStartedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_waitlist_entry", ["waitlistEntryId"]),
adminInvitations: defineTable({
    email: v.string(),
    token: v.optional(v.string()),
    status: v.union(
      v.literal("invited"),
      v.literal("claimed"),
      v.literal("completed")
    ),
    onboardingStep: v.optional(v.number()),
    invitedAt: v.number(),
    invitationExpiresAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_created", ["createdAt"])
    .index("by_token", ["token"]),
announcements: defineTable({
    name: v.string(),
    bannerText: v.string(),
    callToActionName: v.optional(v.string()),
    callToActionUrl: v.optional(v.string()),
    learnMoreName: v.optional(v.string()),
    learnMoreContent: v.optional(v.string()),
    scheduleStart: v.optional(v.number()),
    scheduleEnd: v.optional(v.number()),
    publishJobId: v.optional(v.id("_scheduled_functions")),
    unpublishJobId: v.optional(v.id("_scheduled_functions")),
    isLive: v.boolean(),
    isArchived: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.optional(v.string()),
    updatedBy: v.optional(v.string()),
  })
    .index("by_isLive", ["isLive"])
    .index("by_scheduleEnd", ["scheduleEnd"])
    .index("by_updatedAt", ["updatedAt"]),
auditTrail: defineTable({
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
  })
    .index("by_happenedAt", ["happenedAt"])
    .index("by_action_happenedAt", ["action", "happenedAt"])
    .index("by_actor_happenedAt", ["actor", "happenedAt"])
    .index("by_source_happenedAt", ["source", "happenedAt"])
    .index("by_status_happenedAt", ["status", "happenedAt"])
    .index("by_action_status_happenedAt", ["action", "status", "happenedAt"])
    .index("by_authenticatedUserId_happenedAt", ["authenticatedUserId", "happenedAt"])
};
export const legacySchema = defineSchema(legacyTables);
export type LegacyDataModel = DataModelFromSchemaDefinition<typeof legacySchema>;

/** Tables omitted from the current schema remain readable for migration/recovery. */
export function legacyReader(db: unknown): GenericDatabaseReader<LegacyDataModel> {
  return db as GenericDatabaseReader<LegacyDataModel>;
}
export function legacyWriter(db: unknown): GenericDatabaseWriter<LegacyDataModel> {
  return db as GenericDatabaseWriter<LegacyDataModel>;
}
