import { v } from "convex/values";

import { authComponent } from "./auth";
import { mutation, query } from "./_generated/server";

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await authComponent.getAuthUser(ctx);
    } catch {
      return [];
    }
    if (!user) {
      return [];
    }

    return ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("done")
    ),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const ownerId = (user.userId ?? user._id).toString();

    // Verify the project exists and belongs to the user
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    if (project.ownerId !== ownerId) {
      throw new Error("Not authorized to add tasks to this project");
    }

    return ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      status: args.status,
      projectId: args.projectId,
      ownerId,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("todo"),
        v.literal("in_progress"),
        v.literal("done")
      )
    ),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const ownerId = (user.userId ?? user._id).toString();
    const task = await ctx.db.get(args.id);

    if (!task) {
      throw new Error("Task not found");
    }

    if (task.ownerId !== ownerId) {
      throw new Error("Not authorized to update this task");
    }

    const updates: Partial<{
      title: string;
      description: string;
      status: "todo" | "in_progress" | "done";
    }> = {};

    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.status !== undefined) updates.status = args.status;

    return ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const ownerId = (user.userId ?? user._id).toString();
    const task = await ctx.db.get(args.id);

    if (!task) {
      throw new Error("Task not found");
    }

    if (task.ownerId !== ownerId) {
      throw new Error("Not authorized to delete this task");
    }

    await ctx.db.delete(args.id);
  },
});
