/**
 * SPIKE: app-side wrappers for the platform component's audit trail.
 *
 * The component (`@repo/convex-platform`, installed as `components.platform`)
 * owns the table and the logic. These wrappers own what a component cannot:
 * - identity (`ctx.auth` / Better Auth) and the admin check,
 * - rate limiting (the limiter's state still lives in the app),
 * - the public API surface clients call (`api.platform.auditTrail.*`).
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { authComponent } from "../auth";
import { rateLimit } from "../rateLimits";
import { components } from "../_generated/api";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";

// ---------------------------------------------------------------------------
// insertEvent — server-side write path (scheduled by scheduleAuditEvent, run by
// runAuditEvent). Kept as an app function so callers keep a stable
// `internal.platform.auditTrail.insertEvent` reference and fire-and-forget
// scheduling semantics.
// ---------------------------------------------------------------------------

export const insertEvent = internalMutation({
  args: {
    happenedAt: v.optional(v.number()),
    authenticatedUserId: v.optional(v.string()),
    actor: v.string(),
    sourceDetail: v.string(),
    action: v.string(),
    resource: v.string(),
    status: v.string(),
    oldValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
    reason: v.optional(v.string()),
    meta: v.optional(v.string()),
  },
  handler: async (ctx, { sourceDetail, ...rest }) => {
    await ctx.runMutation(components.platform.auditTrail.insertEvent, {
      ...rest,
      source: `server:${sourceDetail}`,
    });
  },
});

// ---------------------------------------------------------------------------
// postEvent — frontend clients (over Convex WebSocket)
// ---------------------------------------------------------------------------

export const postEvent = mutation({
  args: {
    happenedAt: v.number(),
    sourceDetail: v.optional(v.string()),
    action: v.string(),
    resource: v.string(),
    status: v.optional(v.string()),
    oldValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
    reason: v.optional(v.string()),
    meta: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return;

    const ownerId = (
      (user.userId as string | undefined) ??
      (user._id as string | undefined)
    )?.toString();
    if (!ownerId) return;

    await rateLimit(ctx, {
      name: "mutationGlobal",
      key: ownerId,
      throws: true,
    });

    const email = (user as Record<string, unknown>).email as string;
    await ctx.runMutation(components.platform.auditTrail.insertEvent, {
      authenticatedUserId: ownerId,
      actor: email,
      source: `web:${args.sourceDetail ?? ""}`,
      action: args.action,
      resource: args.resource,
      status: args.status ?? "succeeded",
      happenedAt: args.happenedAt,
      oldValue: args.oldValue,
      newValue: args.newValue,
      reason: args.reason,
      meta: args.meta,
    });
  },
});

// ---------------------------------------------------------------------------
// list — admin-only paginated read, reverse chronological
// ---------------------------------------------------------------------------

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    filterAction: v.optional(v.string()),
    filterActor: v.optional(v.string()),
    filterSource: v.optional(v.string()),
    filterStatus: v.optional(v.string()),
    filterAuthenticatedUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Return an empty page while auth resolves or for non-admins; the query
    // re-runs reactively once auth resolves.
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user || (user as Record<string, unknown>).role !== "admin") {
      return { page: [], isDone: true, continueCursor: "" };
    }
    return await ctx.runQuery(components.platform.auditTrail.list, args);
  },
});

// ---------------------------------------------------------------------------
// envProbe — SPIKE ONLY: `npx convex run platform/auditTrail:envProbe`
// ---------------------------------------------------------------------------

export const envProbe = internalQuery({
  args: {},
  handler: async (ctx) => {
    const component = await ctx.runQuery(
      components.platform.auditTrail.envProbe,
      {},
    );
    return {
      component,
      // Declaring `env` in defineApp must not hide undeclared app env.
      appSeesUndeclaredBetterAuthSecret:
        typeof process.env.BETTER_AUTH_SECRET === "string",
    };
  },
});
