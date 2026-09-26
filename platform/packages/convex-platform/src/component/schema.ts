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

export const appSettingsFields = { key: v.string(), value: v.string(), updatedAt: v.number(), updatedBy: v.optional(v.string()) };

export const announcementFields = {
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
};

export const waitlistEntriesFields = {
    email: v.string(),
    meta: v.string(), // JSON: { superpowers: string[], excitement: string[] }
    status: v.union(
      v.literal("waiting"),
      v.literal("invited"),
      v.literal("claimed")
    ),
    invitedAt: v.optional(v.number()),
    invitationExpiresAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
  };

export const invitationTokensFields = {
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
  };

export const adminInvitationsFields = {
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
  };

export default defineSchema({
  adminEmails: defineTable({ email: v.string() }).index("by_email", ["email"]),
  adminInvitations: defineTable(adminInvitationsFields)
    .index("by_email", ["email"])
    .index("by_created", ["createdAt"])
    .index("by_token", ["token"]),
  invitationTokens: defineTable(invitationTokensFields)
    .index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_waitlist_entry", ["waitlistEntryId"]),
  waitlistEntries: defineTable(waitlistEntriesFields)
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),
  appSettings: defineTable(appSettingsFields).index("by_key", ["key"]),
  announcements: defineTable(announcementFields)
    .index("by_isLive", ["isLive"])
    .index("by_scheduleEnd", ["scheduleEnd"])
    .index("by_updatedAt", ["updatedAt"]),
  auditTrail: defineTable({
    ...auditTrailFields,
    // Set only on rows copied from the app's legacy `auditTrail` table.
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
