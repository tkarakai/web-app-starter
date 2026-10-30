/** @deprecated API namespace retained for compatibility; these are app-operator operations. */
import { LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS } from "./appOperatorAuditCompatibility";
import { v } from "convex/values";

import { components } from "../_generated/api";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { appOperatorMutation, authedQuery } from "./functions";
import { parseUserAgent } from "./parseUserAgent";
import { requireAppOperator } from "./appOperatorAccess";

// ---------------------------------------------------------------------------
// Operator policy and passkey enrollment status. Shared bodies verify live app-operator authority.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Admin query: get MFA policy setting
// ---------------------------------------------------------------------------

export const getMfaPolicy = authedQuery({
  args: {},
  handler: async (ctx) => {
    await requireAppOperator(ctx);

    const setting = await ctx.runQuery(components.platform.appSettings.getRaw, { key: "emailMfaRequired" });

    return {
      mfaRequired: setting ? JSON.parse(setting.value) === true : false,
    };
  },
});

// ---------------------------------------------------------------------------
// Admin mutation: toggle MFA policy
// ---------------------------------------------------------------------------

export const setMfaPolicy = appOperatorMutation({
  args: { required: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await requireAppOperator(ctx, { write: true });

    const key = "emailMfaRequired";
    const value = JSON.stringify(args.required);
    const { previousValue: oldValue } = await ctx.runMutation(components.platform.appSettings.putRaw, { key, value, updatedBy: ctx.ownerId });

    await scheduleAuditEvent(ctx, {
      actor: actor.user.email,
      authenticatedUserId: actor.user._id,
      sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.administrativeMutation,
      action: "admin.mfa_policy_changed",
      resource: `appSettings:${key}`,
      status: "succeeded",
      oldValue,
      newValue: value,
    });
  },
});

// ---------------------------------------------------------------------------
// Admin query: get email verification policy setting
// ---------------------------------------------------------------------------

export const getEmailVerificationPolicy = authedQuery({
  args: {},
  handler: async (ctx) => {
    await requireAppOperator(ctx);

    const setting = await ctx.runQuery(components.platform.appSettings.getRaw, { key: "emailVerificationRequired" });

    return {
      emailVerificationRequired: setting ? JSON.parse(setting.value) === true : true,
    };
  },
});

// ---------------------------------------------------------------------------
// Admin mutation: toggle email verification policy
// ---------------------------------------------------------------------------

export const setEmailVerificationPolicy = appOperatorMutation({
  args: { required: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await requireAppOperator(ctx, { write: true });

    const key = "emailVerificationRequired";
    const value = JSON.stringify(args.required);
    const { previousValue: oldValue } = await ctx.runMutation(components.platform.appSettings.putRaw, { key, value, updatedBy: ctx.ownerId });

    await scheduleAuditEvent(ctx, {
      actor: actor.user.email,
      authenticatedUserId: actor.user._id,
      sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.administrativeMutation,
      action: "admin.email_verification_policy_changed",
      resource: `appSettings:${key}`,
      status: "succeeded",
      oldValue,
      newValue: value,
    });
  },
});

// ---------------------------------------------------------------------------
// Admin query: passkey status for a set of user IDs
// ---------------------------------------------------------------------------

/** @deprecated Wire name retained for app-operator passkey-status compatibility. */
export const listAdminPasskeyUserIds = authedQuery({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireAppOperator(ctx);
    if (args.userIds.length > 100) throw new Error("INVALID_PAGE_SIZE");
    return ctx.runQuery(components.betterAuth.appOperators.listPasskeyUserIds, {
      operatorId: actor.user._id, userIds: args.userIds,
    });
  },
});

// ---------------------------------------------------------------------------
// Re-export parseUserAgent for admin session viewer
// ---------------------------------------------------------------------------

export { parseUserAgent };
