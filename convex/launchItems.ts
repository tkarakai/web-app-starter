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
      .query("launchItems")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal("idea"), v.literal("building"), v.literal("shipping")),
    priority: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const ownerId = (user.userId ?? user._id).toString();

    return ctx.db.insert("launchItems", {
      title: args.title,
      description: args.description,
      status: args.status,
      priority: args.priority,
      ownerId,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("launchItems"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("idea"), v.literal("building"), v.literal("shipping"))),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const ownerId = (user.userId ?? user._id).toString();

    const item = await ctx.db.get(args.id);
    if (!item) {
      throw new Error("Item not found");
    }

    if (item.ownerId !== ownerId) {
      throw new Error("Not authorized to update this item");
    }

    // Only patch fields that are provided
    const updates: Partial<{
      title: string;
      description: string;
      status: "idea" | "building" | "shipping";
      priority: number;
    }> = {};

    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.status !== undefined) updates.status = args.status;
    if (args.priority !== undefined) updates.priority = args.priority;

    return ctx.db.patch(args.id, updates);
  },
});
