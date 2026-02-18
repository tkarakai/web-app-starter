/**
 * Database migrations using the convex-helpers migration framework.
 *
 * ## How it works
 *
 * Each migration is defined with `makeMigration` which provides batching,
 * cursor-based pagination, resume-on-failure, and state tracking via the
 * `migrations` table in the schema.
 *
 * ## Running migrations
 *
 * ```bash
 * # Run all pending migrations in order (dev)
 * npx convex run migrations
 *
 * # Run all pending migrations in order (production)
 * npx convex run migrations --prod
 *
 * # Run a single migration
 * npx convex run migrations:migrateAuditTrailV2 '{"fn":"migrations:migrateAuditTrailV2"}'
 *
 * # Dry run — preview without committing
 * npx convex run migrations:migrateAuditTrailV2 '{"fn":"migrations:migrateAuditTrailV2","dryRun":true}'
 * ```
 *
 * ## Adding new migrations
 *
 * 1. Define the migration with `migration({ table, migrateOne })`
 * 2. Export it (name = CLI identifier)
 * 3. Add it to the `startMigrationsSerially` list in the default export
 *
 * For the full migration workflow (widen/migrate/narrow), see `docs/convex-migrations.md`.
 *
 * @module
 */
import { makeMigration, startMigrationsSerially } from "convex-helpers/server/migrations";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const migration = makeMigration(internalMutation, {
  migrationTable: "migrations",
});

// ---------------------------------------------------------------------------
// migrateAuditTrailV2 — delete old-shape audit trail records
//
// Old shape: { eventId, actorType, receivedAt, ... } (missing: source)
// New shape: { source, authenticatedUserId?, truncatedFields?, ... }
//
// Strategy: delete old records — audit trail is append-only observational
// data and old records predate the current schema design.
// ---------------------------------------------------------------------------

export const migrateAuditTrailV2 = migration({
  table: "auditTrail",
  migrateOne: async (ctx, doc) => {
    const raw = doc as Record<string, unknown>;

    // Old records have `actorType` or `eventId` or are missing `source`
    if (raw.actorType !== undefined || raw.eventId !== undefined || raw.source === undefined) {
      await ctx.db.delete(doc._id);
    }
  },
});

// ---------------------------------------------------------------------------
// Default export: run all pending migrations in series.
// `npx convex run migrations` calls this.
// ---------------------------------------------------------------------------

export default internalMutation(async (ctx) => {
  await startMigrationsSerially(ctx, [
    internal.migrations.migrateAuditTrailV2,
    // Add future migrations here, in order.
  ]);
});
