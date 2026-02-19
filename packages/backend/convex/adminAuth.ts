import { v } from "convex/values";

import { scheduleAuditEvent } from "./auditTrailHelpers";
import { authedMutation, authedQuery } from "./functions";
import { parseUserAgent } from "./parseUserAgent";

// ---------------------------------------------------------------------------
// Admin auth functions — session management, MFA policy
// All functions verify the caller has role === "admin".
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: verify admin role
// ---------------------------------------------------------------------------

function requireAdmin(user: Record<string, unknown>): void {
  if (user.role !== "admin") {
    throw new Error("NOT_ADMIN");
  }
}

// ---------------------------------------------------------------------------
// Admin query: get MFA policy setting
// ---------------------------------------------------------------------------

export const getMfaPolicy = authedQuery({
  args: {},
  handler: async (ctx) => {
    requireAdmin(ctx.user as Record<string, unknown>);

    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "emailMfaRequired"))
      .unique();

    return {
      mfaRequired: setting ? JSON.parse(setting.value) === true : false,
    };
  },
});

// ---------------------------------------------------------------------------
// Admin mutation: toggle MFA policy
// ---------------------------------------------------------------------------

export const setMfaPolicy = authedMutation({
  args: { required: v.boolean() },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user as Record<string, unknown>);

    const key = "emailMfaRequired";
    const value = JSON.stringify(args.required);
    let oldValue: string | undefined;

    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (existing) {
      oldValue = existing.value;
      await ctx.db.patch(existing._id, {
        value,
        updatedAt: Date.now(),
        updatedBy: ctx.ownerId,
      });
    } else {
      await ctx.db.insert("appSettings", {
        key,
        value,
        updatedAt: Date.now(),
        updatedBy: ctx.ownerId,
      });
    }

    await scheduleAuditEvent(ctx, {
      actor: ctx.ownerId,
      authenticatedUserId: ctx.ownerId,
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
    requireAdmin(ctx.user as Record<string, unknown>);

    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "emailVerificationRequired"))
      .unique();

    return {
      emailVerificationRequired: setting ? JSON.parse(setting.value) === true : true,
    };
  },
});

// ---------------------------------------------------------------------------
// Admin mutation: toggle email verification policy
// ---------------------------------------------------------------------------

export const setEmailVerificationPolicy = authedMutation({
  args: { required: v.boolean() },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user as Record<string, unknown>);

    const key = "emailVerificationRequired";
    const value = JSON.stringify(args.required);
    let oldValue: string | undefined;

    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (existing) {
      oldValue = existing.value;
      await ctx.db.patch(existing._id, {
        value,
        updatedAt: Date.now(),
        updatedBy: ctx.ownerId,
      });
    } else {
      await ctx.db.insert("appSettings", {
        key,
        value,
        updatedAt: Date.now(),
        updatedBy: ctx.ownerId,
      });
    }

    await scheduleAuditEvent(ctx, {
      actor: ctx.ownerId,
      authenticatedUserId: ctx.ownerId,
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
// Re-export parseUserAgent for admin session viewer
// ---------------------------------------------------------------------------

export { parseUserAgent };
