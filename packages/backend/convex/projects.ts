import { v } from "convex/values";

import { authComponent } from "./auth";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    let user;
    try {
      user = await authComponent.getAuthUser(ctx);
    } catch {
      return [];
    }
    if (!user) {
      return [];
    }

    const ownerId = (user.userId ?? user._id).toString();

    return ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await authComponent.getAuthUser(ctx);
    } catch {
      return null;
    }
    if (!user) {
      return null;
    }

    const ownerId = (user.userId ?? user._id).toString();
    const project = await ctx.db.get(args.id);

    if (!project || project.ownerId !== ownerId) {
      return null;
    }

    return project;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const ownerId = (user.userId ?? user._id).toString();

    return ctx.db.insert("projects", {
      name: args.name,
      description: args.description,
      ownerId,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const ownerId = (user.userId ?? user._id).toString();
    const project = await ctx.db.get(args.id);

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== ownerId) {
      throw new Error("Not authorized to update this project");
    }

    const updates: Partial<{ name: string; description: string }> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;

    return ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const ownerId = (user.userId ?? user._id).toString();
    const project = await ctx.db.get(args.id);

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== ownerId) {
      throw new Error("Not authorized to delete this project");
    }

    // Cascade delete all tasks belonging to this project
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();

    for (const task of tasks) {
      await ctx.db.delete(task._id);
    }

    await ctx.db.delete(args.id);
  },
});
