import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Convex schema defines the tables and their fields.
export default defineSchema({
  messages: defineTable({
    author: v.string(),
    body: v.string(),
    createdAt: v.number()
  }).index("by_created_at", ["createdAt"]),
  files: defineTable({
    name: v.string(),
    storageId: v.string(),
    type: v.string(),
    size: v.number(),
    createdAt: v.number()
  }).index("by_created_at", ["createdAt"])
});
