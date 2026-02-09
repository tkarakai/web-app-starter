import { internalQuery, query } from "./_generated/server";

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("adminEmails").collect();
  },
});

/** Returns the list of protected admin emails (public, for UI-level guards). */
export const listProtected = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("adminEmails").collect();
    return rows.map((r) => r.email);
  },
});
