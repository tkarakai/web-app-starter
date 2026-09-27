/** Operator-only v2 migration. See platform/docs/component-data-migration.md. */
import { v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { migrationTables, migrationTableValidator, snapshot } from "@web-app-starter/convex-platform/migration";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { legacyReader, legacyWriter, legacySchema, type LegacyDataModel } from "./componentMigrationLegacy";

const migration = components.platform.migration;
const self = internal.platform.componentMigration;
const confirmation = { confirmDeployment: v.string(), writersStopped: v.literal(true) };
function confirm(deployment: string): void {
  if (!process.env.CONVEX_CLOUD_URL || deployment !== process.env.CONVEX_CLOUD_URL) throw new Error("MIGRATION_WRONG_DEPLOYMENT");
}
function batchLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error("MIGRATION_INVALID_BATCH_SIZE");
  return value;
}

export const begin = internalMutation({
  args: confirmation,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    confirm(args.confirmDeployment);
    return ctx.runMutation(migration.begin, { deployment: args.confirmDeployment });
  },
});

type Announcement = LegacyDataModel["announcements"]["document"];
async function takeSchedule(ctx: MutationCtx, row: Announcement, kind: "Start" | "End"): Promise<number | undefined> {
  const id = kind === "Start" ? row.publishJobId : row.unpublishJobId;
  if (!id) return undefined;
  const job = await ctx.db.system.get(id);
  if (!job) throw new Error("MIGRATION_SCHEDULE_MISSING:" + id);
  if (job.state.kind === "inProgress") throw new Error("MIGRATION_SCHEDULE_RUNNING:" + id);
  if (job.state.kind !== "pending") return undefined;
  const expectedName = "announcements:handleScheduled" + kind;
  const canonicalName = job.name.replace(".js:", ":");
  if (canonicalName !== expectedName && canonicalName !== "platform/" + expectedName) throw new Error("MIGRATION_UNEXPECTED_SCHEDULE:" + id);
  const args: unknown = job.args[0];
  if (!args || typeof args !== "object" || !("announcementId" in args) || args.announcementId !== row._id) throw new Error("MIGRATION_UNEXPECTED_SCHEDULE_ARGS:" + id);
  // Cancellation and destination import share this host transaction: neither commits alone.
  await ctx.scheduler.cancel(id);
  const startMatches = "expectedScheduleStart" in args && args.expectedScheduleStart === row.scheduleStart;
  const endMatches = ("expectedScheduleEnd" in args ? args.expectedScheduleEnd : undefined) === row.scheduleEnd;
  if (row.isArchived || !endMatches || (kind === "Start" && !startMatches)) return undefined;
  return job.scheduledTime;
}

const copyResult = v.object({ inserted: v.number(), skipped: v.number(), complete: v.boolean() });
export const copyBatch = internalMutation({
  args: { ...confirmation, table: migrationTableValidator, batchSize: v.number() },
  returns: copyResult,
  handler: async (ctx, args): Promise<Infer<typeof copyResult>> => {
    confirm(args.confirmDeployment);
    const size = batchLimit(args.batchSize);
    const progress = await ctx.runQuery(migration.progress, { table: args.table });
    if (progress.complete) return { inserted: 0, skipped: 0, complete: true };
    const db = legacyReader(ctx.db);
    const pagination = { cursor: progress.cursor, numItems: size };
    // Keep the discriminant and rows correlated, without weakening document types.
    switch (args.table) {
      case "auditTrail": {
        const page = await paginator(db, legacySchema).query("auditTrail").paginate(pagination);
        const result = await ctx.runMutation(components.platform.migrationImport.copy, { batch: { table: "auditTrail", rows: page.page }, nextCursor: page.continueCursor, complete: page.isDone });
        return { ...result, complete: page.isDone };
      }
      case "appSettings": {
        const page = await paginator(db, legacySchema).query("appSettings").paginate(pagination);
        const result = await ctx.runMutation(components.platform.migrationImport.copy, { batch: { table: "appSettings", rows: page.page }, nextCursor: page.continueCursor, complete: page.isDone });
        return { ...result, complete: page.isDone };
      }
      case "adminEmails": {
        const page = await paginator(db, legacySchema).query("adminEmails").paginate(pagination);
        const result = await ctx.runMutation(components.platform.migrationImport.copy, { batch: { table: "adminEmails", rows: page.page }, nextCursor: page.continueCursor, complete: page.isDone });
        return { ...result, complete: page.isDone };
      }
      case "waitlistEntries": {
        const page = await paginator(db, legacySchema).query("waitlistEntries").paginate(pagination);
        const result = await ctx.runMutation(components.platform.migrationImport.copy, { batch: { table: "waitlistEntries", rows: page.page }, nextCursor: page.continueCursor, complete: page.isDone });
        return { ...result, complete: page.isDone };
      }
      case "invitationTokens": {
        const page = await paginator(db, legacySchema).query("invitationTokens").paginate(pagination);
        const result = await ctx.runMutation(components.platform.migrationImport.copy, { batch: { table: "invitationTokens", rows: page.page }, nextCursor: page.continueCursor, complete: page.isDone });
        return { ...result, complete: page.isDone };
      }
      case "adminInvitations": {
        const page = await paginator(db, legacySchema).query("adminInvitations").paginate(pagination);
        const result = await ctx.runMutation(components.platform.migrationImport.copy, { batch: { table: "adminInvitations", rows: page.page }, nextCursor: page.continueCursor, complete: page.isDone });
        return { ...result, complete: page.isDone };
      }
      case "announcements": {
        const page = await paginator(db, legacySchema).query("announcements").paginate(pagination);
        const rows = [];
        for (const row of page.page) {
          const pendingPublishAt = await takeSchedule(ctx, row, "Start");
          const pendingUnpublishAt = await takeSchedule(ctx, row, "End");
          rows.push({ ...row, pendingPublishAt, pendingUnpublishAt });
          await legacyWriter(ctx.db).patch(row._id, { publishJobId: undefined, unpublishJobId: undefined });
        }
        const result = await ctx.runMutation(components.platform.migrationImport.copy, { batch: { table: "announcements", rows: rows }, nextCursor: page.continueCursor, complete: page.isDone });
        return { ...result, complete: page.isDone };
      }
    }
  },
});

const pageCheck = v.object({ count: v.number(), missing: v.number(), mismatched: v.number(), problems: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() });
export const verifyPage = internalQuery({
  args: { table: migrationTableValidator, paginationOpts: paginationOptsValidator },
  returns: pageCheck,
  handler: async (ctx, args): Promise<Infer<typeof pageCheck>> => {
    const page = await paginator(legacyReader(ctx.db), legacySchema).query(args.table).paginate(args.paginationOpts);
    const checks = await ctx.runQuery(migration.verifyRows, { table: args.table, legacyIds: page.page.map(row => row._id) });
    let missing = 0;
    let mismatched = 0;
    const problems: string[] = [];
    for (const [i, row] of page.page.entries()) {
      const check = checks[i];
      const hasLegacyJobs = args.table === "announcements" &&
        (("publishJobId" in row && row.publishJobId !== undefined) || ("unpublishJobId" in row && row.unpublishJobId !== undefined));
      if (!check?.exists) { missing++; problems.push(row._id); }
      else if (hasLegacyJobs || !check.fieldsMatch || check.sourceSnapshot !== snapshot(row) || check.legacyCreationTime !== row._creationTime) { mismatched++; problems.push(row._id); }
    }
    return { count: page.page.length, missing, mismatched, problems: problems.slice(0, 10), isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

const tableStatus = v.object({ table: migrationTableValidator, legacy: v.number(), receipts: v.number(), component: v.number(), missing: v.number(), mismatched: v.number(), problems: v.array(v.string()), matches: v.boolean() });
const statusResult = v.object({ deployment: v.string(), phase: v.string(), matches: v.boolean(), tables: v.array(tableStatus) });
export const status = internalAction({
  args: {},
  returns: statusResult,
  handler: async (ctx): Promise<Infer<typeof statusResult>> => {
    const current = await ctx.runQuery(migration.getState, {});
    const tables: Infer<typeof tableStatus>[] = [];
    for (const table of migrationTables) {
      const result: Infer<typeof tableStatus> = { table, legacy: 0, receipts: 0, component: 0, missing: 0, mismatched: 0, problems: [], matches: false };
      let cursor: string | null = null;
      for (;;) {
        const page: Infer<typeof pageCheck> = await ctx.runQuery(self.verifyPage, { table, paginationOpts: { cursor, numItems: 100 } });
        result.legacy += page.count; result.missing += page.missing; result.mismatched += page.mismatched;
        result.problems = [...result.problems, ...page.problems].slice(0, 10);
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      for (const receipts of [true, false]) {
        cursor = null;
        for (;;) {
          const page: { count: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(migration.countPage, { table, receipts, paginationOpts: { cursor, numItems: 100 } });
          result[receipts ? "receipts" : "component"] += page.count;
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
      }
      // Scheduled publication may append audit rows after activation. All source rows must still exist.
      result.matches = result.missing === 0 && result.mismatched === 0 && result.legacy === result.receipts && (table === "auditTrail" ? result.component >= result.receipts : result.component === result.receipts);
      tables.push(result);
    }
    return { deployment: process.env.CONVEX_CLOUD_URL ?? "unknown", phase: current?.phase ?? "not-started", matches: current !== null && tables.every(row => row.matches), tables };
  },
});

/** Re-run with the same arguments after interruption. Never scheduled or called by CD. */
export const run = internalAction({
  args: { ...confirmation, batchSize: v.optional(v.number()), maxBatches: v.optional(v.number()) },
  returns: v.object({ phase: v.string(), resume: v.boolean(), batches: v.number() }),
  handler: async (ctx, args): Promise<{ phase: string; resume: boolean; batches: number }> => {
    confirm(args.confirmDeployment);
    const batchSize = batchLimit(args.batchSize ?? 50);
    const maxBatches = batchLimit(args.maxBatches ?? 100);
    let phase: string = await ctx.runMutation(self.begin, { confirmDeployment: args.confirmDeployment, writersStopped: true });
    let batches = 0;
    if (phase === "copying") {
      for (const table of migrationTables) {
        if ((await ctx.runQuery(migration.progress, { table })).complete) continue;
        for (;;) {
          if (batches >= maxBatches) return { phase, resume: true, batches };
          const result: Infer<typeof copyResult> = await ctx.runMutation(self.copyBatch, { confirmDeployment: args.confirmDeployment, writersStopped: true, table, batchSize });
          batches++;
          if (result.complete) break;
        }
      }
      const verified = await ctx.runAction(self.status, {});
      if (!verified.matches) throw new Error("MIGRATION_VERIFICATION_FAILED:" + JSON.stringify(verified));
      await ctx.runMutation(migration.markVerified, {});
      phase = "verified";
    }
    if (phase !== "complete") {
      let cursor: string | null = null;
      for (;;) {
        if (batches >= maxBatches) return { phase, resume: true, batches };
        const page: { isDone: boolean; continueCursor: string } = await ctx.runMutation(migration.activateSchedules, { paginationOpts: { cursor, numItems: batchSize } });
        batches++;
        phase = "activating";
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return { phase: "complete", resume: false, batches };
  },
});

/** Deliberate rescan after inspecting a failed copy; already copied values are never overwritten. */
export const restartTable = internalMutation({
  args: { ...confirmation, table: migrationTableValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    confirm(args.confirmDeployment);
    await ctx.runMutation(components.platform.migrationImport.restartTable, { table: args.table });
  },
});

/** Durable cutover receipt for later deploys, after normal app writes resume. */
export const deploymentStatus = internalQuery({
  args: {},
  returns: v.object({ deployment: v.string(), phase: v.string() }),
  handler: async (ctx): Promise<{ deployment: string; phase: string }> => {
    const current = await ctx.runQuery(migration.getState, {});
    return { deployment: process.env.CONVEX_CLOUD_URL ?? "unknown", phase: current?.phase ?? "not-started" };
  },
});
