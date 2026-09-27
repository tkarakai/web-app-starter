/** Migration-only API. These builders deliberately bypass the normal maintenance guard. */
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { api } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { MIGRATION_NAME, migrationTables, migrationTableValidator, migrationPhaseValidator, type MigrationTable } from "./migrationTables";
import { mapping, snapshot, state } from "./migrationShared";

export const begin = mutation({
  args: { deployment: v.string() },
  returns: migrationPhaseValidator,
  handler: async (ctx, { deployment }) => {
    const existing = await state(ctx);
    if (existing) {
      if (existing.deployment !== deployment) throw new Error("MIGRATION_DEPLOYMENT_CHANGED");
      return existing.phase;
    }
    // A fresh installation and an existing v2 app must not be silently merged.
    for (const table of migrationTables) {
      if (await ctx.db.query(table).first()) throw new Error("MIGRATION_TARGET_NOT_EMPTY:" + table);
    }
    await ctx.db.insert("migrationState", { name: MIGRATION_NAME, deployment, phase: "copying", startedAt: Date.now() });
    return "copying" as const;
  },
});

export const getState = query({
  args: {},
  returns: v.union(v.null(), v.object({ deployment: v.string(), phase: migrationPhaseValidator, startedAt: v.number(), verifiedAt: v.optional(v.number()), completedAt: v.optional(v.number()) })),
  handler: async ctx => {
    const current = await state(ctx);
    if (!current) return null;
    return { deployment: current.deployment, phase: current.phase, startedAt: current.startedAt, verifiedAt: current.verifiedAt, completedAt: current.completedAt };
  },
});

export const progress = query({
  args: { table: migrationTableValidator },
  returns: v.object({ cursor: v.union(v.string(), v.null()), complete: v.boolean() }),
  handler: async (ctx, { table }) => {
    const row = await ctx.db.query("migrationProgress").withIndex("by_table", q => q.eq("table", table)).unique();
    return row ? { cursor: row.cursor, complete: row.complete } : { cursor: null, complete: false };
  },
});

export const verifyRows = query({
  args: { table: migrationTableValidator, legacyIds: v.array(v.string()) },
  returns: v.array(v.object({ legacyId: v.string(), componentId: v.optional(v.string()), sourceSnapshot: v.optional(v.string()), legacyCreationTime: v.optional(v.number()), exists: v.boolean(), fieldsMatch: v.boolean() })),
  handler: async (ctx, { table, legacyIds }) => {
    const current = await state(ctx);
    const strict = !current || current.phase === "copying" || current.phase === "verified";
    return Promise.all(legacyIds.map(async legacyId => {
      const receipt = await mapping(ctx, table, legacyId);
      if (!receipt) return { legacyId, exists: false, fieldsMatch: false };
      const row = await ctx.db.get(receipt.componentId as Id<MigrationTable>);
      let fieldsMatch = false;
      if (row) {
        const actual: Record<string, unknown> = { ...row };
        if (table === "invitationTokens") {
          const original = JSON.parse(receipt.snapshot) as Record<string, unknown>;
          if (typeof original.waitlistEntryId !== "string") throw new Error("MIGRATION_INVALID_RECEIPT");
          const parent = await mapping(ctx, "waitlistEntries", original.waitlistEntryId);
          if (actual.waitlistEntryId === parent?.componentId) actual.waitlistEntryId = original.waitlistEntryId;
        }
        fieldsMatch = !strict || snapshot(actual) === receipt.snapshot;
      }
      return { legacyId, componentId: receipt.componentId, sourceSnapshot: receipt.snapshot, legacyCreationTime: receipt.legacyCreationTime, exists: row !== null, fieldsMatch };
    }));
  },
});

export const countPage = query({
  args: { table: migrationTableValidator, receipts: v.boolean(), paginationOpts: paginationOptsValidator },
  returns: v.object({ count: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, receipts, paginationOpts }) => {
    const page = receipts
      ? await paginator(ctx.db, schema).query("migrationRows").withIndex("by_table", q => q.eq("table", table)).paginate(paginationOpts)
      : await paginator(ctx.db, schema).query(table).paginate(paginationOpts);
    return { count: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const markVerified = mutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const current = await state(ctx);
    if (!current || current.phase !== "copying") throw new Error("MIGRATION_NOT_COPYING");
    for (const table of migrationTables) {
      const done = await ctx.db.query("migrationProgress").withIndex("by_table", q => q.eq("table", table)).unique();
      if (!done?.complete) throw new Error("MIGRATION_INCOMPLETE:" + table);
    }
    await ctx.db.patch(current._id, { phase: "verified", verifiedAt: Date.now() });
  },
});

export const activateSchedules = mutation({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.string()),
  handler: async (ctx, { paginationOpts }) => {
    const current = await state(ctx);
    if (!current || !["verified", "activating", "complete"].includes(current.phase)) throw new Error("MIGRATION_NOT_VERIFIED");
    if (current.phase !== "complete") await ctx.db.patch(current._id, { phase: "activating" });
    const page = await paginator(ctx.db, schema).query("migrationRows").withIndex("by_table_activated", q => q.eq("table", "announcements").eq("schedulesActivated", false)).paginate(paginationOpts);
    for (const row of page.page) {
      if (row.schedulesActivated) continue;
      const announcementId = row.componentId as Id<"announcements">;
      const announcement = await ctx.db.get(announcementId);
      if (!announcement) throw new Error("MIGRATION_TARGET_MISSING:" + row.legacyId);
      let publishJobId: Id<"_scheduled_functions"> | undefined;
      let unpublishJobId: Id<"_scheduled_functions"> | undefined;
      if (row.publishAt !== undefined) {
        if (announcement.scheduleStart === undefined) throw new Error("MIGRATION_SCHEDULE_START_MISSING");
        publishJobId = await ctx.scheduler.runAt(Math.max(Date.now(), row.publishAt), api.announcements.handleScheduledStart, {
          announcementId, expectedScheduleStart: announcement.scheduleStart, expectedScheduleEnd: announcement.scheduleEnd,
        });
      }
      if (row.unpublishAt !== undefined) {
        if (announcement.scheduleEnd === undefined) throw new Error("MIGRATION_SCHEDULE_END_MISSING");
        unpublishJobId = await ctx.scheduler.runAt(Math.max(Date.now(), row.unpublishAt), api.announcements.handleScheduledEnd, {
          announcementId, expectedScheduleEnd: announcement.scheduleEnd,
        });
      }
      await ctx.db.patch(announcementId, { publishJobId, unpublishJobId });
      await ctx.db.patch(row._id, { schedulesActivated: true });
    }
    if (page.isDone && current.phase !== "complete") {
      // Query all outstanding receipts through the index to make a forged cursor unable to unlock early.
      const pending = await ctx.db.query("migrationRows").withIndex("by_table_activated", q => q.eq("table", "announcements").eq("schedulesActivated", false)).first();
      if (pending) throw new Error("MIGRATION_SCHEDULES_INCOMPLETE");
      await ctx.db.patch(current._id, { phase: "complete", completedAt: Date.now() });
    }
    return { ...page, page: page.page.map(row => row.legacyId) };
  },
});
