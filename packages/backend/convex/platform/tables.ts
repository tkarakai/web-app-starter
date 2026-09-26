import { defineTable } from "convex/server";
import { v } from "convex/values";
import { migrationsTable } from "convex-helpers/server/migrations";
import { rateLimitTables } from "convex-helpers/server/rateLimit";

/**
 * The platform's tables. The app's `convex/schema.ts` spreads them into its schema
 * (the platform hook); never define a table with one of these names yourself.
 */
export const platformTables = {
  ...rateLimitTables,

  // --- Migrations state (convex-helpers framework) ---
  migrations: migrationsTable,

  userProfiles: defineTable({
    ownerId: v.string(),
    locale: v.optional(v.string()),
    theme: v.optional(v.string()),
    timezone: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),
};
