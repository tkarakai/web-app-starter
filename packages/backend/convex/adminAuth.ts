import { v } from "convex/values";

import { authedMutation, authedQuery } from "./functions";
import { parseUserAgent } from "./parseUserAgent";

// ---------------------------------------------------------------------------
// Admin auth functions — session management, MFA policy, and audit trail
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

    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (existing) {
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

    // Audit trail
    await ctx.db.insert("auditLog", {
      action: "mfa_policy_changed",
      actorId: ctx.ownerId,
      details: JSON.stringify({ mfaRequired: args.required }),
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Admin query: list audit log entries
// ---------------------------------------------------------------------------

export const listAuditLog = authedQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user as Record<string, unknown>);

    const limit = args.limit ?? 50;
    const entries = await ctx.db
      .query("auditLog")
      .withIndex("by_created")
      .order("desc")
      .take(limit);

    return entries.map((entry) => ({
      ...entry,
      details: entry.details ? JSON.parse(entry.details) : null,
    }));
  },
});

// ---------------------------------------------------------------------------
// Admin mutation: log an admin action (for HTTP-action-based operations)
// ---------------------------------------------------------------------------

export const logAdminAction = authedMutation({
  args: {
    action: v.string(),
    targetId: v.optional(v.string()),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(ctx.user as Record<string, unknown>);

    await ctx.db.insert("auditLog", {
      action: args.action,
      actorId: ctx.ownerId,
      targetId: args.targetId,
      details: args.details,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Re-export parseUserAgent for admin session viewer
// ---------------------------------------------------------------------------

export { parseUserAgent };
