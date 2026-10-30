import { migration } from "./migrations";
import { personalOrganizationForOwner } from "./platform/organizationAccess";

/**
 * The sample domain's data migrations; `migrations.ts` runs them. Delete this file and its
 * entry there along with the sample.
 *
 * Organizations: put each pre-organization project in its creator's personal organization,
 * so nobody loses access on upgrade. Tasks and uploads follow their project. A project whose
 * creator's account was deleted stays unassigned (unreachable, as before) and is logged.
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
