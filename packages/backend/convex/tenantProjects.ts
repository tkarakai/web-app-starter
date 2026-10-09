import { v } from "convex/values";
import { tenantMutation, tenantQuery } from "./platform/tenantFunctions";
import { assertMaxLength, MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from "./platform/functions";
import { requireTenantChild, requireTenantFile, requireTenantProject } from "./tenantAccess";

export const list = tenantQuery({
  args: {},
  handler: ctx => ctx.db.query("projects").withIndex("by_organization_owner", q => q.eq("organizationId", ctx.organizationId).eq("ownerId", ctx.ownerId)).order("desc").collect(),
});
export const listWithStats = tenantQuery({
  args: {},
  handler: async ctx => {
    const projects = await ctx.db.query("projects").withIndex("by_organization_owner", q => q.eq("organizationId", ctx.organizationId).eq("ownerId", ctx.ownerId)).order("desc").collect();
    return Promise.all(projects.map(async project => {
      const tasks = await ctx.db.query("tasks").withIndex("by_project", q => q.eq("projectId", project._id)).collect();
      const uploads = await ctx.db.query("uploads").withIndex("by_project", q => q.eq("projectId", project._id)).collect();
      for (const task of tasks) requireTenantChild(ctx, task, project._id);
      for (const upload of uploads) await requireTenantFile(ctx, upload);
      return { ...project, taskCount: tasks.length, doneCount: tasks.filter(task => task.status === "done").length, uploadCount: uploads.length };
    }));
  },
});
export const get = tenantQuery({ args: { id: v.id("projects") }, handler: async (ctx, args) => {
  const project = await ctx.db.get(args.id);
  return project && project.organizationId === ctx.organizationId && project.ownerId === ctx.ownerId ? project : null;
} });
export const create = tenantMutation({
  args: { name: v.string(), description: v.string() },
  handler: async (ctx, args) => {
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");
    return ctx.db.insert("projects", { name: args.name, description: args.description,
      organizationId: ctx.organizationId, ownerId: ctx.ownerId, createdAt: Date.now() });
  },
});
export const update = tenantMutation({
  args: { id: v.id("projects"), name: v.optional(v.string()), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantProject(ctx, args.id);
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");
    const update: { name?: string; description?: string } = {};
    if (args.name !== undefined) update.name = args.name;
    if (args.description !== undefined) update.description = args.description;
    await ctx.db.patch(args.id, update);
  },
});
export const remove = tenantMutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    await requireTenantProject(ctx, id);
    const tasks = await ctx.db.query("tasks").withIndex("by_project", q => q.eq("projectId", id)).collect();
    const uploads = await ctx.db.query("uploads").withIndex("by_project", q => q.eq("projectId", id)).collect();
    // Verify every child before any deletion; malformed aliases block the entire transaction.
    for (const task of tasks) requireTenantChild(ctx, task, id);
    for (const upload of uploads) await requireTenantFile(ctx, upload);
    for (const task of tasks) await ctx.db.delete(task._id);
    for (const upload of uploads) { await ctx.storage.delete(upload.storageId); await ctx.db.delete(upload._id); }
    await ctx.db.delete(id);
  },
});
