import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { rateLimitTables } from "convex-helpers/server/rateLimit";

export default defineSchema({
  ...rateLimitTables,

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
});
