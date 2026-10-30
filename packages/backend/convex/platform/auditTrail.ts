import { rememberNative } from "./nativeCapabilities";
import type { QueryCtx } from "../_generated/server";
import type { ObjectType } from "convex/values";
/**
 * App-side wrappers for the platform component's audit trail.
 *
 * The component (`@web-app-starter/convex-platform`, installed as `components.platform`)
 * owns the table and the logic. These wrappers own what a component cannot:
 * - identity (`ctx.auth` / Better Auth) and the admin check,
 * - rate limiting (the limiter's state still lives in the app),
 * - the public API surface clients call (`api.platform.auditTrail.*`).
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { getAuth } from "./functions";
import { rateLimit } from "./rateLimits";
import { components } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";
import { requireAppOperator } from "./appOperatorAccess";
import { classifiedAuditSource, APP_OPERATOR_AUDIT_SOURCE, projectAppOperatorAudit, type AppOperatorAuditEvent } from "./auditPrivacy";

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
      source: await classifiedAuditSource(ctx, { ...rest, sourceDetail }),
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
    const user = (await getAuth(ctx))?.user;
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
      // Client action/source text cannot create an operator classification, even for an operator.
      source: `web:private-audit:v1:${args.sourceDetail ?? ""}`,
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

const listNativeArgs = {
    paginationOpts: paginationOptsValidator,
    filterAction: v.optional(v.string()),
    filterActor: v.optional(v.string()),
    filterSource: v.optional(v.string()),
    filterStatus: v.optional(v.string()),
    filterAuthenticatedUserId: v.optional(v.string()),
  };
async function listAppOperatorAudit(ctx: QueryCtx, args: ObjectType<typeof listNativeArgs>) {
  const empty = { page: [] as AppOperatorAuditEvent[], isDone: true, continueCursor: "" };
  try {
    await requireAppOperator(ctx);
  } catch (error) {
    // Preserve reactive query behavior; direct and captured handlers apply the same boundary.
    if (error instanceof Error && ["NOT_AUTHENTICATED", "NOT_ADMIN"].includes(error.message)) return empty;
    throw error;
  }
  if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100) {
    throw new Error("INVALID_PAGE_SIZE");
  }
  // Never run caller-selected indexes over private rows. Their cursors can contain raw identities.
  if (args.filterSource !== undefined && args.filterSource !== APP_OPERATOR_AUDIT_SOURCE) return empty;
  const result = await ctx.runQuery(components.platform.auditTrail.list, {
    paginationOpts: args.paginationOpts, filterSource: APP_OPERATOR_AUDIT_SOURCE,
  });
  const page: AppOperatorAuditEvent[] = [];
  for (const event of result.page) {
    const projection = await projectAppOperatorAudit(ctx, event);
    if (!projection) continue;
    if (args.filterAction !== undefined && projection.action !== args.filterAction
      || args.filterActor !== undefined && projection.actor !== args.filterActor
      || args.filterStatus !== undefined && projection.status !== args.filterStatus
      || args.filterAuthenticatedUserId !== undefined && projection.authenticatedUserId !== args.filterAuthenticatedUserId) continue;
    page.push(projection);
  }
  return { page, isDone: result.isDone, continueCursor: result.continueCursor };
}

export const list = rememberNative(query({ args: listNativeArgs, handler: listAppOperatorAudit }), {
  args: listNativeArgs, handler: listAppOperatorAudit,
}, "query");
