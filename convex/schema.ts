import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Convex schema definition for the starter project.
export default defineSchema({
  messages: defineTable({
    body: v.string(),
    author: v.string(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),
});
