/**
 * SPIKE: one-off migration of the app's legacy `auditTrail` table into the
 * platform component's `auditTrail` table.
 *
 * Expand/contract:
 *   1. expand   — the component table exists, new writes go there, the legacy
 *                 table stays in `schema.ts` (read by nothing but this file).
 *   2. migrate  — `npx convex run platform/migrateAuditTrail:run`
 *                 (idempotent: rows are keyed by `legacyId`, re-runs skip them).
 *   3. verify   — `run` ends with `verify`; `status` can be called any time.
 *   4. contract — a later release drops `auditTrail` from `schema.ts` after
 *                 the rows are deleted.
 *
 * Batches go through an app mutation (the app owns the legacy table) that
 * hands the whole batch to one component mutation, so each batch is a single
 * transaction across both tables.
 */
import { v } from "convex/values";

import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";

const DEFAULT_BATCH_SIZE = 100;

function toLegacyEvent(doc: Doc<"auditTrail">) {
  const { _id, _creationTime, ...fields } = doc;
  return { ...fields, legacyId: _id, legacyCreationTime: _creationTime };
}

export const copyBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.optional(v.number()) },
  returns: v.object({
    read: v.number(),
    inserted: v.number(),
    skipped: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, batchSize }) => {
    const page = await ctx.db
      .query("auditTrail")
      .order("asc")
      .paginate({ cursor, numItems: batchSize ?? DEFAULT_BATCH_SIZE });
    const { inserted, skipped } = await ctx.runMutation(
      components.platform.auditTrail.importLegacyEvents,
      { events: page.page.map(toLegacyEvent) },
    );
    return {
      read: page.page.length,
      inserted,
      skipped,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** One page of legacy rows compared field by field with their copies. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.optional(v.number()) },
  returns: v.object({
    legacyRows: v.number(),
    missing: v.array(v.string()),
    mismatched: v.array(v.string()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, batchSize }) => {
    const page = await ctx.db
      .query("auditTrail")
      .order("asc")
      .paginate({ cursor, numItems: batchSize ?? DEFAULT_BATCH_SIZE });
    const copies = await ctx.runQuery(
      components.platform.auditTrail.getByLegacyIds,
      { legacyIds: page.page.map((d) => d._id) },
    );
    const missing: string[] = [];
    const mismatched: string[] = [];
    page.page.forEach((legacy, i) => {
      const copy = copies[i];
      if (!copy) {
        missing.push(legacy._id);
        return;
      }
      const expected = toLegacyEvent(legacy);
      const actual: Record<string, unknown> = { ...copy };
      delete actual._id;
      delete actual._creationTime;
      if (JSON.stringify(sortKeys(expected)) !== JSON.stringify(sortKeys(actual))) {
        mismatched.push(legacy._id);
      }
    });
    return {
      legacyRows: page.page.length,
      missing,
      mismatched,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

const statusValidator = v.object({
  legacyRows: v.number(),
  componentRows: v.number(),
  componentRowsFromLegacy: v.number(),
  missing: v.array(v.string()),
  mismatched: v.array(v.string()),
  ok: v.boolean(),
});

type MigrationStatus = typeof statusValidator.type;

/** Counts both tables and checks every legacy row has an identical copy. */
export const status = internalAction({
  args: { batchSize: v.optional(v.number()) },
  returns: statusValidator,
  handler: async (ctx, { batchSize }): Promise<MigrationStatus> => {
    let legacyRows = 0;
    const missing: string[] = [];
    const mismatched: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: {
        legacyRows: number;
        missing: string[];
        mismatched: string[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.platform.migrateAuditTrail.verifyPage, {
        cursor,
        batchSize,
      });
      legacyRows += page.legacyRows;
      missing.push(...page.missing);
      mismatched.push(...page.mismatched);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    let componentRows = 0;
    let componentRowsFromLegacy = 0;
    let componentCursor: string | null = null;
    for (;;) {
      const page: {
        total: number;
        migrated: number;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(components.platform.auditTrail.countPage, {
        cursor: componentCursor,
        numItems: batchSize ?? DEFAULT_BATCH_SIZE,
      });
      componentRows += page.total;
      componentRowsFromLegacy += page.migrated;
      if (page.isDone) break;
      componentCursor = page.continueCursor;
    }

    return {
      legacyRows,
      componentRows,
      componentRowsFromLegacy,
      missing,
      mismatched,
      ok:
        missing.length === 0 &&
        mismatched.length === 0 &&
        componentRowsFromLegacy === legacyRows,
    };
  },
});

/** Copies every legacy row (idempotent), then verifies. */
export const run = internalAction({
  args: { batchSize: v.optional(v.number()) },
  returns: v.object({
    batches: v.number(),
    read: v.number(),
    inserted: v.number(),
    skipped: v.number(),
    status: statusValidator,
  }),
  handler: async (ctx, { batchSize }) => {
    let cursor: string | null = null;
    let batches = 0;
    let read = 0;
    let inserted = 0;
    let skipped = 0;
    for (;;) {
      const result: {
        read: number;
        inserted: number;
        skipped: number;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runMutation(internal.platform.migrateAuditTrail.copyBatch, {
        cursor,
        batchSize,
      });
      batches++;
      read += result.read;
      inserted += result.inserted;
      skipped += result.skipped;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    const status: MigrationStatus = await ctx.runAction(
      internal.platform.migrateAuditTrail.status,
      { batchSize },
    );
    return { batches, read, inserted, skipped, status };
  },
});

/**
 * SPIKE ONLY: seeds the legacy table with varied rows so the migration can be
 * rehearsed on a local backend. Would not ship.
 */
export const seedLegacyForSpike = internalMutation({
  args: { count: v.number(), offset: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, { count, offset }) => {
    const actions = ["auth.sign_in", "auth.sign_out", "admin.user.banned", "waitlist.joined"];
    const statuses = ["succeeded", "failed.wrong_password", "failed.expired"];
    const base = offset ?? 0;
    for (let i = base; i < base + count; i++) {
      await ctx.db.insert("auditTrail", {
        happenedAt: 1_700_000_000_000 + i * 1000,
        actor: `user${i % 7}@example.com`,
        source: i % 2 === 0 ? "server:auth-hook" : "web:settings",
        action: actions[i % actions.length],
        resource: `session:${i}`,
        status: statuses[i % statuses.length],
        ...(i % 3 === 0 ? { authenticatedUserId: `user-${i % 7}` } : {}),
        ...(i % 5 === 0 ? { oldValue: JSON.stringify({ n: i }), newValue: "{}" } : {}),
        ...(i % 11 === 0 ? { reason: "spike", meta: '{"ip":"127.0.0.1"}' } : {}),
        ...(i % 13 === 0 ? { truncatedFields: "meta" } : {}),
      });
    }
    return count;
  },
});
