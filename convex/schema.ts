import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Convex schema documents the data model used in the sample task workflow.
export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    status: v.string(),
  }).index("by_status", ["status"]),
});
