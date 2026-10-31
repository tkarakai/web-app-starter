import { organizationDataCleanup } from "./platform/functions";

const BATCH = 100;

/**
 * Removes a deleted organization's data. The platform calls this after an owner deletes an
 * organization, again and again until it returns `true`; by then nobody can reach the rows,
 * so this only frees storage. Delete a bounded batch per call and cover every table that
 * belongs to an organization (platform/docs/organizations.md#deleting-an-organization).
 */
export const deleteOrganizationData = organizationDataCleanup(async (ctx, organizationId) => {
  const project = await ctx.db.query("projects")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  if (!project) return true;

  const tasks = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", project._id)).take(BATCH);
  for (const task of tasks) await ctx.db.delete(task._id);

  const uploads = await ctx.db.query("uploads")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .take(BATCH - tasks.length);
  for (const upload of uploads) {
    await ctx.db.delete(upload._id);
    // A legacy row may share its stored object with another upload; keep it for that one.
    const shared = await ctx.db.query("uploads").withIndex("by_storage", (q) => q.eq("storageId", upload.storageId)).first();
    if (!shared) await ctx.storage.delete(upload.storageId);
  }

  if (tasks.length + uploads.length === 0) await ctx.db.delete(project._id);
  return false;
});
