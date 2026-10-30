import { v } from "convex/values";
import { tenantMutation, tenantQuery } from "./platform/tenantFunctions";
import { assertMaxLength, MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from "./platform/functions";
import { requireTenantChild, requireTenantProject } from "./tenantAccess";

const status = v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done"));
export const listByProject = tenantQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireTenantProject(ctx, projectId);
    const rows = await ctx.db.query("tasks").withIndex("by_project", q => q.eq("projectId", projectId)).order("desc").collect();
    for (const row of rows) requireTenantChild(ctx, row, projectId);
    return rows;
  },
});
export const create = tenantMutation({
  args: { projectId: v.id("projects"), title: v.string(), description: v.string(), status, deadline: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireTenantProject(ctx, args.projectId);
    assertMaxLength(args.title, MAX_NAME_LENGTH, "TITLE");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");
    return ctx.db.insert("tasks", { title: args.title, description: args.description, status: args.status,
      deadline: args.deadline, projectId: args.projectId, organizationId: ctx.organizationId, ownerId: ctx.ownerId, createdAt: Date.now() });
  },
});
export const update = tenantMutation({
  args: { id: v.id("tasks"), title: v.optional(v.string()), description: v.optional(v.string()), status: v.optional(status), deadline: v.optional(v.union(v.number(), v.null())) },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) throw new Error("TASK_NOT_FOUND");
    await requireTenantProject(ctx, task.projectId);
    requireTenantChild(ctx, task, task.projectId);
    assertMaxLength(args.title, MAX_NAME_LENGTH, "TITLE");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");
    const patch: { title?: string; description?: string; status?: "todo" | "in_progress" | "done"; deadline?: number } = {};
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.status !== undefined) patch.status = args.status;
    if (args.deadline !== undefined) patch.deadline = args.deadline ?? undefined;
    await ctx.db.patch(args.id, patch);
  },
});
export const remove = tenantMutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    const task = await ctx.db.get(id);
    if (!task) throw new Error("TASK_NOT_FOUND");
    await requireTenantProject(ctx, task.projectId);
    requireTenantChild(ctx, task, task.projectId);
    await ctx.db.delete(id);
  },
});
