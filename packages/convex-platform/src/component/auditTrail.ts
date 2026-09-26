/**
 * SPIKE: audit trail logic inside the platform component.
 *
 * Rules that differ from app code (see docs.convex.dev/components/authoring):
 * - No `ctx.auth`: callers (the app-side wrappers in
 *   `packages/backend/convex/platform/`) resolve identity and pass it in.
 * - Every function exported here is reachable only by the installing app
 *   (as `components.platform.auditTrail.*`), never by clients directly.
 * - `.paginate()` is unavailable; `list` uses the `convex-helpers` paginator.
 * - Env is read through the typed `env` from `_generated/server`, and only the
 *   variables declared in `convex.config.ts` are visible.
 */
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";

import {
  AUDIT_ACTIONS,
  AUDIT_SOURCE_TRANSPORTS,
  AUDIT_STATUSES,
} from "./auditTrailConstants";
import { env, mutation, query } from "./_generated/server";
import schema, { auditTrailFields } from "./schema";

// ---------------------------------------------------------------------------
// Field length limits (defense in depth — truncate, never reject)
// ---------------------------------------------------------------------------

const MAX_ACTOR_LENGTH = 500;
const MAX_ACTION_LENGTH = 100;
const MAX_RESOURCE_LENGTH = 500;
const MAX_VALUE_LENGTH = 10_000;
const MAX_REASON_LENGTH = 2_000;
const MAX_META_LENGTH = 5_000;
const MAX_STATUS_LENGTH = 200;
const MAX_SOURCE_LENGTH = 200;

function truncateField(
  value: string | undefined,
  max: number,
): { value: string | undefined; wasTruncated: boolean } {
  if (value === undefined) return { value: undefined, wasTruncated: false };
  if (value.length <= max) return { value, wasTruncated: false };
  return { value: value.slice(0, max), wasTruncated: true };
}

interface AuditEventInput {
  happenedAt?: number;
  authenticatedUserId?: string;
  actor: string;
  source: string;
  action: string;
  resource: string;
  status: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  meta?: string;
}

interface AuditTrailDoc {
  happenedAt: number;
  authenticatedUserId?: string;
  actor: string;
  source: string;
  action: string;
  resource: string;
  status: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  meta?: string;
  truncatedFields?: string;
}

function buildAuditEvent(fields: AuditEventInput): AuditTrailDoc {
  if (!(AUDIT_ACTIONS as readonly string[]).includes(fields.action)) {
    throw new Error(`UNKNOWN_AUDIT_ACTION: ${fields.action}`);
  }
  if (!(AUDIT_STATUSES as readonly string[]).includes(fields.status)) {
    throw new Error(`UNKNOWN_AUDIT_STATUS: ${fields.status}`);
  }
  const colonIdx = fields.source.indexOf(":");
  const transport =
    colonIdx >= 0 ? fields.source.slice(0, colonIdx) : fields.source;
  if (!(AUDIT_SOURCE_TRANSPORTS as readonly string[]).includes(transport)) {
    throw new Error(`UNKNOWN_AUDIT_SOURCE_TRANSPORT: ${transport}`);
  }

  const truncated: string[] = [];
  const t = (name: string, value: string | undefined, max: number) => {
    const r = truncateField(value, max);
    if (r.wasTruncated) truncated.push(name);
    return r.value;
  };

  const actor = t("actor", fields.actor, MAX_ACTOR_LENGTH)!;
  const action = t("action", fields.action, MAX_ACTION_LENGTH)!;
  const resource = t("resource", fields.resource, MAX_RESOURCE_LENGTH)!;
  const status = t("status", fields.status, MAX_STATUS_LENGTH)!;
  const source = t("source", fields.source, MAX_SOURCE_LENGTH)!;
  const oldValue = t("oldValue", fields.oldValue, MAX_VALUE_LENGTH);
  const newValue = t("newValue", fields.newValue, MAX_VALUE_LENGTH);
  const reason = t("reason", fields.reason, MAX_REASON_LENGTH);
  const meta = t("meta", fields.meta, MAX_META_LENGTH);

  const doc: AuditTrailDoc = {
    happenedAt: fields.happenedAt ?? Date.now(),
    actor,
    source,
    action,
    resource,
    status,
  };
  if (fields.authenticatedUserId !== undefined) {
    doc.authenticatedUserId = fields.authenticatedUserId;
  }
  if (oldValue !== undefined) doc.oldValue = oldValue;
  if (newValue !== undefined) doc.newValue = newValue;
  if (reason !== undefined) doc.reason = reason;
  if (meta !== undefined) doc.meta = meta;
  if (truncated.length > 0) doc.truncatedFields = truncated.join(",");
  return doc;
}

/**
 * The shape of a stored event as the app sees it: ids are plain strings
 * across the component boundary.
 */
export const auditEventValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  ...auditTrailFields,
  legacyId: v.optional(v.string()),
  legacyCreationTime: v.optional(v.number()),
});

// ---------------------------------------------------------------------------
// insertEvent — the single write path. `source` carries the transport prefix
// ("server:..." or "web:..."), which the app-side wrapper sets.
// ---------------------------------------------------------------------------

export const insertEvent = mutation({
  args: {
    happenedAt: v.optional(v.number()),
    authenticatedUserId: v.optional(v.string()),
    actor: v.string(),
    source: v.string(),
    action: v.string(),
    resource: v.string(),
    status: v.string(),
    oldValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
    reason: v.optional(v.string()),
    meta: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await ctx.db.insert("auditTrail", buildAuditEvent(args));
  },
});

// ---------------------------------------------------------------------------
// list — reverse-chronological page with conjunctive filters.
// The caller is responsible for the admin check.
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
  returns: paginationResultValidator(auditEventValidator),
  handler: async (ctx, args) => {
    const wantAction = args.filterAction ?? null;
    const wantStatus = args.filterStatus ?? null;
    const wantActor = args.filterActor ?? null;
    const wantSource = args.filterSource ?? null;
    const wantUserId = args.filterAuthenticatedUserId ?? null;

    const handled = {
      action: false,
      status: false,
      actor: false,
      source: false,
      userId: false,
    };

    const table = paginator(ctx.db, schema).query("auditTrail");
    let q;
    if (wantAction !== null && wantStatus !== null) {
      q = table.withIndex("by_action_status_happenedAt", (idx) =>
        idx.eq("action", wantAction).eq("status", wantStatus),
      );
      handled.action = true;
      handled.status = true;
    } else if (wantAction !== null) {
      q = table.withIndex("by_action_happenedAt", (idx) =>
        idx.eq("action", wantAction),
      );
      handled.action = true;
    } else if (wantActor !== null) {
      q = table.withIndex("by_actor_happenedAt", (idx) =>
        idx.eq("actor", wantActor),
      );
      handled.actor = true;
    } else if (wantSource !== null) {
      q = table.withIndex("by_source_happenedAt", (idx) =>
        idx.eq("source", wantSource),
      );
      handled.source = true;
    } else if (wantUserId !== null) {
      q = table.withIndex("by_authenticatedUserId_happenedAt", (idx) =>
        idx.eq("authenticatedUserId", wantUserId),
      );
      handled.userId = true;
    } else if (wantStatus !== null) {
      q = table.withIndex("by_status_happenedAt", (idx) =>
        idx.eq("status", wantStatus),
      );
      handled.status = true;
    } else {
      q = table.withIndex("by_happenedAt");
    }

    // The paginator has no `.filter()`; `filterWith` runs before pagination,
    // so filtered-out rows still count as reads (same as `.filter()` did).
    const ordered = q.order("desc").filterWith(async (doc) => {
      if (wantAction !== null && !handled.action && doc.action !== wantAction)
        return false;
      if (wantStatus !== null && !handled.status && doc.status !== wantStatus)
        return false;
      if (wantActor !== null && !handled.actor && doc.actor !== wantActor)
        return false;
      if (wantSource !== null && !handled.source && doc.source !== wantSource)
        return false;
      if (
        wantUserId !== null &&
        !handled.userId &&
        doc.authenticatedUserId !== wantUserId
      )
        return false;
      return true;
    });

    return await ordered.paginate(args.paginationOpts);
  },
});

// ---------------------------------------------------------------------------
// envProbe — spike-only: proves declared env reaches the component and that
// undeclared deployment env does not. Returns no secret values.
// ---------------------------------------------------------------------------

export const envProbe = query({
  args: {},
  returns: v.object({
    siteUrl: v.string(),
    retentionDays: v.union(v.string(), v.null()),
    seesUndeclaredBetterAuthSecret: v.boolean(),
    visibleEnvKeys: v.array(v.string()),
  }),
  handler: async () => {
    const processEnv = (
      globalThis as unknown as { process: { env: Record<string, unknown> } }
    ).process.env;
    return {
      siteUrl: env.SITE_URL,
      retentionDays: env.AUDIT_TRAIL_RETENTION_DAYS ?? null,
      seesUndeclaredBetterAuthSecret:
        typeof processEnv.BETTER_AUTH_SECRET === "string",
      visibleEnvKeys: Object.keys(processEnv).sort(),
    };
  },
});

// ---------------------------------------------------------------------------
// Data migration support (SPIKE): copy legacy app rows in, idempotently.
// ---------------------------------------------------------------------------

const legacyEventValidator = v.object({
  ...auditTrailFields,
  legacyId: v.string(),
  legacyCreationTime: v.number(),
});

export const importLegacyEvents = mutation({
  args: { events: v.array(legacyEventValidator) },
  returns: v.object({ inserted: v.number(), skipped: v.number() }),
  handler: async (ctx, { events }) => {
    let inserted = 0;
    let skipped = 0;
    for (const event of events) {
      const existing = await ctx.db
        .query("auditTrail")
        .withIndex("by_legacyId", (q) => q.eq("legacyId", event.legacyId))
        .first();
      if (existing) {
        skipped++;
        continue;
      }
      await ctx.db.insert("auditTrail", event);
      inserted++;
    }
    return { inserted, skipped };
  },
});

export const getByLegacyIds = query({
  args: { legacyIds: v.array(v.string()) },
  returns: v.array(v.union(auditEventValidator, v.null())),
  handler: async (ctx, { legacyIds }) => {
    return await Promise.all(
      legacyIds.map((legacyId) =>
        ctx.db
          .query("auditTrail")
          .withIndex("by_legacyId", (q) => q.eq("legacyId", legacyId))
          .first(),
      ),
    );
  },
});

/** One page of a full count, so large tables can be counted across calls. */
export const countPage = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({
    total: v.number(),
    migrated: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    const result = await paginator(ctx.db, schema)
      .query("auditTrail")
      .paginate({ cursor, numItems });
    return {
      total: result.page.length,
      migrated: result.page.filter((d) => d.legacyId !== undefined).length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
