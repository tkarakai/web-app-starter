import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { rateLimitTables } from "convex-helpers/server/rateLimit";

export default defineSchema({
  ...rateLimitTables,

  userProfiles: defineTable({
    ownerId: v.string(),
    locale: v.optional(v.string()),
    theme: v.optional(v.string()),
    timezone: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  adminEmails: defineTable({
    email: v.string(),
  }).index("by_email", ["email"]),

  projects: defineTable({
    name: v.string(),
    description: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  tasks: defineTable({
    title: v.string(),
    description: v.string(),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("done")
    ),
    projectId: v.id("projects"),
    ownerId: v.string(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"]),

  uploads: defineTable({
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    projectId: v.id("projects"),
    ownerId: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_project", ["projectId"]),

  // --- Global application settings (generic key-value store) ---

  appSettings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  }).index("by_key", ["key"]),

  // --- Waitlist ---

  waitlistEntries: defineTable({
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
});
