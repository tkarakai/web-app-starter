import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The sample domain's tables: projects with tasks and file uploads. App-owned;
 * each project belongs to an organization, and tasks and uploads reach theirs
 * through their project (`requireProjectAccess`). `ownerId` records who created a row.
 * `schema.ts` spreads them in. Delete this file, its spread in `schema.ts`, and
 * `projects.ts`, `tasks.ts`, `files.ts`, `projectAccess.ts` and `fileAccess.ts`,
 * along with their sample tests, to strip the sample backend.
 */
export const sampleTables = {
  projects: defineTable({
    name: v.string(),
    description: v.string(),
    ownerId: v.string(),
    // Optional only until `migrations.ts` has backfilled pre-organization rows; the next
    // release makes it required (platform/docs/organizations.md#upgrading-existing-data).
    organizationId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_organization", ["organizationId"]),

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
    // Only the authenticated server upload path sets this. Legacy rows remain quarantined.
    ownershipVersion: v.optional(v.literal(1)),
  })
    .index("by_owner", ["ownerId"])
    .index("by_project", ["projectId"])
    .index("by_storage", ["storageId"]),
};
