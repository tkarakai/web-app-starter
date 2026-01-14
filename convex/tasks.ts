import { mutation, query } from "convex/server";
import { v } from "convex/values";

// Task query for the starter UI.
export const list = query({
  handler: async (ctx) => {
    return ctx.db.query("tasks").order("desc").collect();
  },
});

// Task mutation used by the sample input form.
export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const taskId = await ctx.db.insert("tasks", {
      title,
      status: "open",
    });

    return taskId;
  },
});
