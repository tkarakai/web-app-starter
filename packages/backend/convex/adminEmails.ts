import { internalQuery, query } from "./_generated/server";
import { authComponent } from "./auth";

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("adminEmails").collect();
  },
});

/**
 * Returns the list of protected admin emails.
 * Requires authentication to prevent exposing admin email addresses to unauthorized users.
 */
export const listProtected = query({
  args: {},
  handler: async (ctx) => {
    // Verify user is authenticated
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    const rows = await ctx.db.query("adminEmails").collect();
    return rows.map((r) => r.email);
  },
});
