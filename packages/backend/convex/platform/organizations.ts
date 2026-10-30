import { LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS } from "./appOperatorAuditCompatibility";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { appOperatorMutation, authedQuery } from "./functions";
import { requireAppOperator } from "./appOperatorAccess";
import { scheduleAuditEvent } from "./auditTrailHelpers";

/** App-operator organization control DTOs. Membership, credentials and private application records never escape. */
export const list = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const actor = await requireAppOperator(ctx);
    return ctx.runQuery(components.betterAuth.organizations.controlList, { ...args, operatorId: actor.user._id });
  },
});
export const get = authedQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireAppOperator(ctx);
    return ctx.runQuery(components.betterAuth.organizations.contacts, { ...args, operatorId: actor.user._id });
  },
});
/** @deprecated Wire name retained for changing organization availability without a migration. */
export const setLifecycle = appOperatorMutation({
  args: { organizationId: v.string(), lifecycle: v.union(v.literal("active"), v.literal("disabled")) },
  handler: async (ctx, args) => {
    const actor = await requireAppOperator(ctx, { write: true });
    await ctx.runMutation(components.betterAuth.organizations.setLifecycle, { ...args, operatorId: actor.user._id });
    await scheduleAuditEvent(ctx, { actor: actor.user.email, authenticatedUserId: actor.user._id,
      sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.organizationAvailability, action: "admin.organization.lifecycle_changed", resource: `organization:${args.organizationId}`,
      status: "succeeded", newValue: args.lifecycle });
  },
});
