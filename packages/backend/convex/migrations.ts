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
import { personalOrganizationForOwner } from "./platform/organizationAccess";

const migration = makeMigration(internalMutation, { migrationTable: "migrations" });

/**
 * Organizations (platform v4.2): put each pre-organization project in its creator's
 * personal organization, so nobody loses access on upgrade. Tasks and uploads follow
 * their project. A project whose creator's account was deleted stays unassigned
 * (unreachable, as before) and is logged.
 */
export const projectsToOrganizations = migration({
  table: "projects",
  migrateOne: async (ctx, project) => {
    if (project.organizationId) return;
    const organizationId = await personalOrganizationForOwner(ctx, project.ownerId);
    if (organizationId) return { organizationId };
    console.warn("PROJECT_WITHOUT_OWNER_ACCOUNT", { projectId: project._id });
  },
});

// ---------------------------------------------------------------------------
// Default export: run all pending migrations in series.
// `npx convex run migrations` calls this.
// ---------------------------------------------------------------------------

export default internalMutation(async (ctx) => {
  await startMigrationsSerially(ctx, [
    internal.migrations.projectsToOrganizations,
    // Add future migrations here, in order.
  ]);
});
