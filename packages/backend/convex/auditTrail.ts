import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { authComponent } from "./auth";
import { authedMutation } from "./functions";
import { internalMutation, query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Field length limits (defense in depth)
// ---------------------------------------------------------------------------

const MAX_ACTOR_LENGTH = 500;
const MAX_ACTION_LENGTH = 100;
const MAX_RESOURCE_LENGTH = 500;
const MAX_VALUE_LENGTH = 10_000;
const MAX_REASON_LENGTH = 2_000;
const MAX_META_LENGTH = 5_000;
const MAX_STATUS_LENGTH = 200;

function assertLength(
  value: string | undefined,
  max: number,
  field: string,
): void {
  if (value !== undefined && value.length > max) {
    throw new Error(`${field}_TOO_LONG`);
  }
}

// ---------------------------------------------------------------------------
// buildAuditEvent — helper that creates the full document shape
// ---------------------------------------------------------------------------

interface AuditEventInput {
  happenedAt?: number;
  actor: string;
  actorType: string;
  action: string;
  resource: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  status: string;
  meta?: string;
}

interface AuditTrailDoc {
  eventId: string;
  happenedAt: number;
  receivedAt: number;
  actor: string;
  actorType: string;
  action: string;
  resource: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  status: string;
  meta?: string;
}

export function buildAuditEvent(fields: AuditEventInput): AuditTrailDoc {
  assertLength(fields.actor, MAX_ACTOR_LENGTH, "actor");
  assertLength(fields.action, MAX_ACTION_LENGTH, "action");
  assertLength(fields.resource, MAX_RESOURCE_LENGTH, "resource");
  assertLength(fields.oldValue, MAX_VALUE_LENGTH, "oldValue");
  assertLength(fields.newValue, MAX_VALUE_LENGTH, "newValue");
  assertLength(fields.reason, MAX_REASON_LENGTH, "reason");
  assertLength(fields.status, MAX_STATUS_LENGTH, "status");
  assertLength(fields.meta, MAX_META_LENGTH, "meta");

  const now = Date.now();
  const doc: AuditTrailDoc = {
    eventId: crypto.randomUUID(),
    happenedAt: fields.happenedAt ?? now,
    receivedAt: now,
    actor: fields.actor,
    actorType: fields.actorType,
    action: fields.action,
    resource: fields.resource,
    status: fields.status,
  };

  if (fields.oldValue !== undefined) doc.oldValue = fields.oldValue;
  if (fields.newValue !== undefined) doc.newValue = fields.newValue;
  if (fields.reason !== undefined) doc.reason = fields.reason;
  if (fields.meta !== undefined) doc.meta = fields.meta;

  return doc;
}

// ---------------------------------------------------------------------------
// insertEvent — internalMutation for server-side code (actions, httpActions)
// ---------------------------------------------------------------------------

export const insertEvent = internalMutation({
  args: {
    happenedAt: v.optional(v.number()),
    actor: v.string(),
    actorType: v.string(),
    action: v.string(),
    resource: v.string(),
    oldValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
    reason: v.optional(v.string()),
    status: v.string(),
    meta: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = buildAuditEvent({
      ...args,
      happenedAt: args.happenedAt ?? undefined,
    });
    await ctx.db.insert("auditTrail", doc);
  },
});

// ---------------------------------------------------------------------------
// postEvent — authedMutation for frontend clients (over Convex WebSocket)
// ---------------------------------------------------------------------------

export const postEvent = authedMutation({
  args: {
    happenedAt: v.number(),
    action: v.string(),
    resource: v.string(),
    oldValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
    reason: v.optional(v.string()),
    status: v.optional(v.string()),
    meta: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorType =
      (ctx.user as Record<string, unknown>).role === "admin" ? "admin" : "user";
    const doc = buildAuditEvent({
      actor: ctx.ownerId,
      actorType,
      ...args,
      status: args.status ?? "succeeded",
    });
    await ctx.db.insert("auditTrail", doc);
  },
});

// ---------------------------------------------------------------------------
// list — paginated query (admin-only, reverse chronological)
// ---------------------------------------------------------------------------

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    filterAction: v.optional(v.string()),
    filterActor: v.optional(v.string()),
    filterActorType: v.optional(v.string()),
    filterStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Return empty page when auth hasn't resolved yet or user isn't admin.
    // The query re-runs reactively once auth resolves — no throw needed.
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user || (user as Record<string, unknown>).role !== "admin") {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }

    let q;
    if (args.filterAction && args.filterStatus) {
      q = ctx.db
        .query("auditTrail")
        .withIndex("by_action_status_happenedAt", (idx) =>
          idx.eq("action", args.filterAction!).eq("status", args.filterStatus!),
        );
    } else if (args.filterAction) {
      q = ctx.db
        .query("auditTrail")
        .withIndex("by_action_happenedAt", (idx) =>
          idx.eq("action", args.filterAction!),
        );
    } else if (args.filterActor) {
      q = ctx.db
        .query("auditTrail")
        .withIndex("by_actor_happenedAt", (idx) =>
          idx.eq("actor", args.filterActor!),
        );
    } else if (args.filterActorType) {
      q = ctx.db
        .query("auditTrail")
        .withIndex("by_actorType_happenedAt", (idx) =>
          idx.eq("actorType", args.filterActorType!),
        );
    } else if (args.filterStatus) {
      q = ctx.db
        .query("auditTrail")
        .withIndex("by_status_happenedAt", (idx) =>
          idx.eq("status", args.filterStatus!),
        );
    } else {
      q = ctx.db.query("auditTrail").withIndex("by_happenedAt");
    }

    return await q.order("desc").paginate(args.paginationOpts);
  },
});
