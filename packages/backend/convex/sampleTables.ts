import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The sample domain's tables: projects with tasks and file uploads. App-owned;
 * `schema.ts` spreads them in. Delete this file, its spread in `schema.ts`, and
 * `projects.ts`, `tasks.ts`, `files.ts`, `projectAccess.ts` and `fileAccess.ts`,
 * along with their sample tests, to strip the sample backend.
 */
export const sampleTables = {
  projects: defineTable({
    name: v.string(),
    description: v.string(),
    // Widen only: missing context is legacy-private data, never accepted by tenant APIs.
    organizationId: v.optional(v.string()),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"])
    .index("by_organization_owner", ["organizationId", "ownerId"]),

  tasks: defineTable({
    title: v.string(),
    description: v.string(),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("done")
    ),
    deadline: v.optional(v.number()),
    organizationId: v.optional(v.string()),
    projectId: v.id("projects"),
    ownerId: v.string(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_organization_project", ["organizationId", "projectId"]),

  uploads: defineTable({
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    organizationId: v.optional(v.string()),
    projectId: v.id("projects"),
    ownerId: v.string(),
    createdAt: v.number(),
    // Only the authenticated server upload path sets this. Legacy rows remain quarantined.
    ownershipVersion: v.optional(v.literal(1)),
  })
    .index("by_owner", ["ownerId"])
    .index("by_project", ["projectId"])
    .index("by_storage", ["storageId"])
    .index("by_organization_project", ["organizationId", "projectId"]),
};
