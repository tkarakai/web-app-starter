import { refuse } from "@web-app-starter/convex-platform/errors";
import { createApi } from "@convex-dev/better-auth";
import schema from "./schema";
import { createAuthOptions } from "../auth";
import { paginationOptsValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, createAuthOptions);

export const reuseOtp = mutation({
  args: { identifier: v.string(), value: v.string(), expiresAt: v.number(), allowedAttempts: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("verification")
      .withIndex("identifier", q => q.eq("identifier", args.identifier)).order("desc").first();
    const attempts = existing ? Number(existing.value.slice(existing.value.lastIndexOf(":") + 1)) : NaN;
    if (existing && existing.expiresAt > Date.now() && Number.isInteger(attempts)
      && attempts >= 0 && attempts < args.allowedAttempts) return { ...existing, id: existing._id };
    if (existing) await ctx.db.delete(existing._id);
    const now = Date.now();
    const data = { identifier: args.identifier, value: args.value, expiresAt: args.expiresAt, createdAt: now, updatedAt: now };
    const id = await ctx.db.insert("verification", data);
    return { ...data, id };
  },
});

/**
 * Invitations of one organization, or to one address, with this status whose `expiresAt` is
 * after `expiresAfter`, latest expiry first. The adapter's `findMany` can't bound a range on an
 * index, and Better Auth never rewrites an expired invitation's status, so listings read
 * through this to skip expired history (platform/organizations.ts, organizationAccess.ts).
 * Paginates a convex-helpers stream, as the adapter does: Convex allows one native
 * `.paginate()` per query, nested component calls included.
 */
export const invitationsByExpiry = query({
  args: {
    organizationId: v.optional(v.string()),
    email: v.optional(v.string()),
    status: v.string(),
    expiresAfter: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { organizationId, email, status, expiresAfter } = args;
    if ((organizationId === undefined) === (email === undefined)) refuse("INVALID_INVITATION_SCOPE");
    const invitations = stream(ctx.db, schema).query("invitation");
    const rows = organizationId !== undefined
      ? invitations.withIndex("organizationId_status_expiresAt", (q) =>
        q.eq("organizationId", organizationId).eq("status", status).gt("expiresAt", expiresAfter))
      : invitations.withIndex("email_status_expiresAt", (q) =>
        q.eq("email", email!).eq("status", status).gt("expiresAt", expiresAfter));
    return await rows.order("desc").paginate(args.paginationOpts);
  },
});
