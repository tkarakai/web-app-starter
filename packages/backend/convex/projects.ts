import { v } from "convex/values";

import {
  orgMutation,
  orgQuery,
  assertMaxLength,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from "./platform/functions";
import { requireFileAccess } from "./fileAccess";
import { requireProjectAccess } from "./projectAccess";

export const list = orgQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
      .order("desc")
      .collect();
  },
});

export const listWithStats = orgQuery({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
      .order("desc")
      .collect();

    return Promise.all(
      projects.map(async (project) => {
        const tasks = await ctx.db
          .query("tasks")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();

        const uploads = await ctx.db
          .query("uploads")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();

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

/** `null` when the project is gone or belongs to another organization (a teammate may delete it). */
export const get = orgQuery({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.id);
    return project?.organizationId && project.organizationId === ctx.organizationId ? project : null;
  },
});

export const create = orgMutation({
  args: {
    name: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");

    return ctx.db.insert("projects", {
      name: args.name,
      description: args.description,
      ownerId: ctx.ownerId,
      organizationId: ctx.organizationId,
      createdAt: Date.now(),
    });
  },
});

export const update = orgMutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.id);
    assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME");
    assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "DESCRIPTION");

    const updates: Partial<{ name: string; description: string }> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;

    return ctx.db.patch(args.id, updates);
  },
});

export const remove = orgMutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.id);

    // Cascade delete all tasks belonging to this project
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();

    for (const task of tasks) {
      await ctx.db.delete(task._id);
    }

    // Cascade delete all uploads belonging to this project
    const uploads = await ctx.db
      .query("uploads")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();

    // Refuse the entire cascade when a legacy or aliased object needs operator review.
    for (const upload of uploads) await requireFileAccess(ctx, upload);

    for (const upload of uploads) {
      await ctx.storage.delete(upload.storageId);
      await ctx.db.delete(upload._id);
    }

    await ctx.db.delete(args.id);
  },
});
