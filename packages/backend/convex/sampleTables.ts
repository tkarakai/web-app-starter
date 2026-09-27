import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The sample domain's tables: projects with tasks and file uploads. App-owned;
 * `schema.ts` spreads them in. Delete this file, its spread in `schema.ts`, and
 * `projects.ts`, `tasks.ts`, `files.ts` and `projectAccess.ts` to strip the sample.
 */
export const sampleTables = {
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
    deadline: v.optional(v.number()),
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
};
