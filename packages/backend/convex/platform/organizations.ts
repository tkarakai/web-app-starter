import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { adminMutation, authedQuery } from "./functions";
import { requireOperator } from "./operatorAccess";
import { scheduleAuditEvent } from "./auditTrailHelpers";

/** Operator control DTOs. Membership, credentials and private application records never escape. */
export const list = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const actor = await requireOperator(ctx);
    return ctx.runQuery(components.betterAuth.organizations.controlList, { ...args, operatorId: actor.user._id });
  },
});
export const get = authedQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireOperator(ctx);
    return ctx.runQuery(components.betterAuth.organizations.contacts, { ...args, operatorId: actor.user._id });
  },
});
export const setLifecycle = adminMutation({
  args: { organizationId: v.string(), lifecycle: v.union(v.literal("active"), v.literal("disabled")) },
  handler: async (ctx, args) => {
    const actor = await requireOperator(ctx, { write: true });
    await ctx.runMutation(components.betterAuth.organizations.setLifecycle, { ...args, operatorId: actor.user._id });
    await scheduleAuditEvent(ctx, { actor: actor.user.email, authenticatedUserId: actor.user._id,
      sourceDetail: "organization-control", action: "admin.organization.lifecycle_changed", resource: `organization:${args.organizationId}`,
      status: "succeeded", newValue: args.lifecycle });
  },
});
