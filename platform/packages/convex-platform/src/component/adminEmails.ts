/** Protected admin addresses. Only the installing app can call these functions. */
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./functions";

export const adminEmailValidator = v.object({
  _id: v.id("adminEmails"),
  _creationTime: v.number(),
  email: v.string(),
});

export async function ensureAdminEmail(ctx: MutationCtx, email: string) {
  const existing = await ctx.db.query("adminEmails")
    .withIndex("by_email", q => q.eq("email", email)).first();
  return existing?._id ?? await ctx.db.insert("adminEmails", { email });
}

export const list = query({
  args: {},
  returns: v.array(adminEmailValidator),
  handler: async ctx => ctx.db.query("adminEmails").collect(),
});

export const contains = query({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { email }) => (await ctx.db.query("adminEmails")
    .withIndex("by_email", q => q.eq("email", email)).first()) !== null,
});

export const ensure = mutation({
  args: { email: v.string() },
  returns: v.id("adminEmails"),
  handler: async (ctx, { email }) => ensureAdminEmail(ctx, email),
});

/** Bootstrap rescue keeps the identity of its protected-admin row. */
export const replace = mutation({
  args: { id: v.id("adminEmails"), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, email }) => { await ctx.db.patch(id, { email }); },
});
