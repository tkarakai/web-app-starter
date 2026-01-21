import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  launchItems: defineTable({
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal("idea"), v.literal("building"), v.literal("shipping")),
    priority: v.number(),
    ownerId: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"]),
  uploads: defineTable({
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),
});
