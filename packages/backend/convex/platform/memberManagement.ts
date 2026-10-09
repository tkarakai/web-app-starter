import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { authorizedSession, requireOrgAdminSession } from "./sessionPolicy";
import { requireOrganizationReadiness } from "./organizationReadiness";
import { rateLimit } from "./rateLimits";

const contextArgs = { organizationId: v.string() };

/** Every directory request is bound to an explicit live organization and admin session. */
export const directory = query({
  args: { ...contextArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const actor = await requireOrgAdminSession(ctx, args.organizationId);
    await requireOrganizationReadiness(ctx);
    return ctx.runQuery(components.betterAuth.organizations.directory, { ...args, actorId: actor.user._id });
  },
});

export const change = mutation({
  args: { ...contextArgs, memberId: v.string(), operation: v.union(v.literal("remove"), v.literal("demote"), v.literal("promote")) },
  handler: async (ctx, args) => {
    const actor = await requireOrgAdminSession(ctx, args.organizationId, true);
    await requireOrganizationReadiness(ctx);
    await rateLimit(ctx, { name: "mutationGlobal", key: actor.user._id, throws: true });
    await ctx.runMutation(components.betterAuth.organizations.changeMember, { ...args, actorId: actor.user._id });
  },
});

/** Leaving removes only this membership and preserves the shared identity and private rows. */
export const leave = mutation({
  args: contextArgs,
  handler: async (ctx, args) => {
    const actor = await authorizedSession(ctx, true);
    if (!actor) throw new Error("NOT_AUTHENTICATED");
    if (actor.assurance.scope !== "user") throw new Error("NOT_CUSTOMER");
    await requireOrganizationReadiness(ctx);
    await rateLimit(ctx, { name: "mutationGlobal", key: actor.user._id, throws: true });
    await ctx.runMutation(components.betterAuth.organizations.leave, { ...args, userId: actor.user._id });
  },
});

export const setContact = mutation({
  args: { ...contextArgs, memberId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireOrgAdminSession(ctx, args.organizationId, true);
    await requireOrganizationReadiness(ctx);
    await rateLimit(ctx, { name: "mutationGlobal", key: actor.user._id, throws: true });
    await ctx.runMutation(components.betterAuth.organizations.setContact, { ...args, actorId: actor.user._id });
  },
});

export const audit = query({
  args: contextArgs,
  handler: async (ctx, args) => {
    const actor = await requireOrgAdminSession(ctx, args.organizationId);
    await requireOrganizationReadiness(ctx);
    return ctx.runQuery(components.betterAuth.organizationAudit.list, { ...args, actorId: actor.user._id });
  },
});
