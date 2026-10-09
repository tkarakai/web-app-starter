import { v } from "convex/values";

import {
  authedMutation,
  authedQuery,
  assertMaxLength,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from "./platform/functions";
import { requireFileAccess } from "./fileAccess";
import { requireProjectAccess } from "./projectAccess";
import { requireLegacyPrivateAccess } from "./platform/tenantContext";

export const list = authedQuery({
  args: { organizationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireLegacyPrivateAccess(ctx, args.organizationId);
    return ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.ownerId))
      .order("desc")
      .collect().then(rows => rows.filter(row => row.organizationId === undefined));
  },
});

export const listWithStats = authedQuery({
  args: { organizationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireLegacyPrivateAccess(ctx, args.organizationId);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.ownerId))
      .order("desc")
      .collect();

    return Promise.all(
      projects.filter(project => project.organizationId === undefined).map(async (project) => {
        const tasks = await ctx.db
          .query("tasks")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();

        const uploads = await ctx.db
          .query("uploads")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();

        if (tasks.some(task => task.organizationId !== undefined || task.ownerId !== ctx.ownerId)
          || uploads.some(upload => upload.organizationId !== undefined || upload.ownerId !== ctx.ownerId)) throw new Error("LEGACY_RESOURCE_REQUIRES_MIGRATION");
        return {
          ...project,
          taskCount: tasks.length,
          doneCount: tasks.filter((t) => t.status === "done").length,
          uploadCount: uploads.length,
        };
      })
    );
  },
});

export const get = authedQuery({
  args: { id: v.id("projects"), organizationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireLegacyPrivateAccess(ctx, args.organizationId);
    const project = await ctx.db.get(args.id);
    return project && project.ownerId === ctx.ownerId && project.organizationId === undefined ? project : null;
  },
});

export const create = authedMutation({
  args: {
    organizationId: v.optional(v.string()),
    name: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    await requireLegacyPrivateAccess(ctx, args.organizationId);
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");

    return ctx.db.insert("projects", {
      name: args.name,
      description: args.description,
      ownerId: ctx.ownerId,
      createdAt: Date.now(),
    });
  },
});

export const update = authedMutation({
  args: {
    organizationId: v.optional(v.string()),
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.id, args.organizationId);
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");

    const updates: Partial<{ name: string; description: string }> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;

    return ctx.db.patch(args.id, updates);
  },
});

export const remove = authedMutation({
  args: { id: v.id("projects"), organizationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.id, args.organizationId);

    // Cascade delete all tasks belonging to this project
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();

    for (const task of tasks) {
      if (task.organizationId !== undefined || task.ownerId !== ctx.ownerId) throw new Error("LEGACY_RESOURCE_REQUIRES_MIGRATION");
      await ctx.db.delete(task._id);
    }

    // Cascade delete all uploads belonging to this project
    const uploads = await ctx.db
      .query("uploads")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();

    // Refuse the entire cascade when a legacy or aliased object needs operator review.
    for (const upload of uploads) await requireFileAccess(ctx, upload, args.organizationId);

    for (const upload of uploads) {
      await ctx.storage.delete(upload.storageId);
      await ctx.db.delete(upload._id);
    }

    await ctx.db.delete(args.id);
  },
});
