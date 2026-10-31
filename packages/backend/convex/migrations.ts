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
 * ```
 *
 * ## Adding new migrations
 *
 * 1. Define the migration with `migration({ table, migrateOne })`
 * 2. Export it (name = CLI identifier)
 * 3. Add it to the `startMigrationsSerially` list in the default export
 *
 * For the full migration workflow (widen/migrate/narrow), see `platform/docs/convex-migrations.md`.
 *
 * @module
 */
import { makeMigration, startMigrationsSerially } from "convex-helpers/server/migrations";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/** Define a migration: `export const myMigration = migration({ table, migrateOne })`. */
export const migration = makeMigration(internalMutation, { migrationTable: "migrations" });

// ---------------------------------------------------------------------------
// Default export: run all pending migrations in series.
// `npx convex run migrations` calls this.
// ---------------------------------------------------------------------------

export default internalMutation(async (ctx) => {
  await startMigrationsSerially(ctx, [
    internal.sampleMigrations.projectsToOrganizations, // Sample domain; removed with the sample.
    // Add future migrations here, in order.
  ]);
});
