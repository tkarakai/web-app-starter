import { v } from "convex/values";

import { components } from "../_generated/api";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { adminMutation, authedQuery } from "./functions";
import { parseUserAgent } from "./parseUserAgent";
import { requireOperator, requireOperatorTarget } from "./operatorAccess";

// ---------------------------------------------------------------------------
// Operator policy and passkey enrollment status. Shared bodies verify live operator authority.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Admin query: get MFA policy setting
// ---------------------------------------------------------------------------

export const getMfaPolicy = authedQuery({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);

    const setting = await ctx.runQuery(components.platform.appSettings.getRaw, { key: "emailMfaRequired" });

    return {
      mfaRequired: setting ? JSON.parse(setting.value) === true : false,
    };
  },
});

// ---------------------------------------------------------------------------
// Admin mutation: toggle MFA policy
// ---------------------------------------------------------------------------

export const setMfaPolicy = adminMutation({
  args: { required: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await requireOperator(ctx, { write: true });

    const key = "emailMfaRequired";
    const value = JSON.stringify(args.required);
    const { previousValue: oldValue } = await ctx.runMutation(components.platform.appSettings.putRaw, { key, value, updatedBy: ctx.ownerId });

    await scheduleAuditEvent(ctx, {
      actor: actor.user.email,
      authenticatedUserId: actor.user._id,
      sourceDetail: "admin-mutation",
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
    await requireOperator(ctx);

    const setting = await ctx.runQuery(components.platform.appSettings.getRaw, { key: "emailVerificationRequired" });

    return {
      emailVerificationRequired: setting ? JSON.parse(setting.value) === true : true,
    };
  },
});

// ---------------------------------------------------------------------------
// Admin mutation: toggle email verification policy
// ---------------------------------------------------------------------------

export const setEmailVerificationPolicy = adminMutation({
  args: { required: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await requireOperator(ctx, { write: true });

    const key = "emailVerificationRequired";
    const value = JSON.stringify(args.required);
    const { previousValue: oldValue } = await ctx.runMutation(components.platform.appSettings.putRaw, { key, value, updatedBy: ctx.ownerId });

    await scheduleAuditEvent(ctx, {
      actor: actor.user.email,
      authenticatedUserId: actor.user._id,
      sourceDetail: "admin-mutation",
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

export const listAdminPasskeyUserIds = authedQuery({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireOperator(ctx);

    if (args.userIds.length > 100) throw new Error("INVALID_PAGE_SIZE");
    const operatorIds = [...new Set(args.userIds)];
    // Check every target before reading factors. A mixed request never discloses a partial directory.
    for (const userId of operatorIds) await requireOperatorTarget(ctx, userId);

    const userIdsWithPasskey: string[] = [];
    for (const userId of operatorIds) {
      const passkey = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "passkey", where: [{ field: "userId", value: userId }],
      });
      if (passkey) userIdsWithPasskey.push(userId);
    }
    return userIdsWithPasskey;
  },
});

// ---------------------------------------------------------------------------
// Re-export parseUserAgent for admin session viewer
// ---------------------------------------------------------------------------

export { parseUserAgent };
