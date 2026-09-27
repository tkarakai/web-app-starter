import { afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { defineSchema, internalMutationGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { registerPlatform } from "@web-app-starter/convex-platform/test";
import { migrationTables } from "@web-app-starter/convex-platform/migration";
import { components, internal } from "./_generated/api";
import { modules } from "./test.modules";
import { platformTables } from "./platform/tables";
import { legacyTables } from "./platform/componentMigrationLegacy";
import { platformRunner } from "../test/platform-component";

const url = "https://migration-test.convex.cloud";
const confirmation = { confirmDeployment: url, writersStopped: true as const };
const api = internal.platform.componentMigration;
function fixture() {
  vi.stubEnv("CONVEX_CLOUD_URL", url);
  const t = convexTest(defineSchema({ ...platformTables, ...legacyTables }), {
    ...modules,
    // Simulate the legacy function path retained by the additive bridge.
    "./announcements.ts": async () => ({
      handleScheduledStart: internalMutationGeneric({
        args: { announcementId: v.id("announcements"), expectedScheduleStart: v.number(), expectedScheduleEnd: v.optional(v.number()) },
        handler: async () => { throw new Error("LEGACY_JOB_MUST_BE_CANCELLED"); },
      }),
    }),
  });
  registerPlatform(t);
  const runPlatform = platformRunner(t);
  return { t, runPlatform };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

async function seedAll(t: ReturnType<typeof fixture>["t"]) {
  return t.run(async ctx => {
    const parent = await ctx.db.insert("waitlistEntries", { email: "wait@example.test", meta: "{}", status: "invited", createdAt: 5 });
    const token = await ctx.db.insert("invitationTokens", { waitlistEntryId: parent, token: "hashed-token", email: "wait@example.test", status: "sent", expiresAt: 500000, createdAt: 6 });
    await ctx.db.insert("adminEmails", { email: "admin@example.test" });
    await ctx.db.insert("appSettings", { key: "siteName", value: "My app", updatedAt: 7 });
    await ctx.db.insert("adminInvitations", { email: "invited@example.test", status: "claimed", invitedAt: 1, createdAt: 2, claimedAt: 3, onboardingStep: 2 });
    await ctx.db.insert("auditTrail", { happenedAt: 8, actor: "operator", source: "test", action: "seed", resource: "app", status: "success" });
    await ctx.db.insert("announcements", { name: "Welcome", bannerText: "Hello", isLive: true, createdAt: 9, updatedAt: 10 });
    return { parent, token };
  });
}

describe("operator component migration", () => {
  test("copies all tables over interrupted batches, remaps foreign keys and reruns without duplication", async () => {
    const { t, runPlatform } = fixture();
    const ids = await seedAll(t);
    let result;
    for (let i = 0; i < 20; i++) {
      result = await t.action(api.run, { ...confirmation, batchSize: 1, maxBatches: 1 });
      if (!result.resume) break;
    }
    expect(result).toMatchObject({ phase: "complete", resume: false });
    const status = await t.action(api.status, {});
    expect(status.matches).toBe(true);
    for (const table of status.tables) expect(table).toMatchObject({ legacy: 1, receipts: 1, component: 1, missing: 0, mismatched: 0 });
    await t.action(api.run, confirmation);
    const copied = await runPlatform(async ctx => ({ parent: await ctx.db.query("waitlistEntries").unique(), token: await ctx.db.query("invitationTokens").unique() }));
    expect(copied.parent?._id).not.toBe(ids.parent);
    expect(copied.token?.waitlistEntryId).toBe(copied.parent?._id);
    expect(copied.token?.token).toBe("hashed-token");
    expect((await t.action(api.status, {})).matches).toBe(true);
  });

  test("refuses a wrong deployment before any writes and pauses normal APIs until verified", async () => {
    const { t } = fixture();
    await expect(t.action(api.run, { ...confirmation, confirmDeployment: "https://wrong.convex.cloud" })).rejects.toThrow("MIGRATION_WRONG_DEPLOYMENT");
    expect(await t.query(components.platform.migration.getState, {})).toBeNull();
    await t.mutation(api.begin, confirmation);
    await expect(t.query(components.platform.adminEmails.list, {})).rejects.toThrow("PLATFORM_MIGRATION_IN_PROGRESS");
    await t.action(api.run, confirmation);
    expect(await t.query(components.platform.adminEmails.list, {})).toEqual([]);
  });

  test("detects source edits and never overwrites a copied value on a rescan", async () => {
    const { t, runPlatform } = fixture();
    const id = await t.run(ctx => ctx.db.insert("appSettings", { key: "test", value: "before", updatedAt: 1 }));
    await t.mutation(api.begin, confirmation);
    await t.mutation(api.copyBatch, { ...confirmation, table: "appSettings", batchSize: 1 });
    await t.run(ctx => ctx.db.patch(id, { value: "after" }));
    await t.mutation(api.restartTable, { ...confirmation, table: "appSettings" });
    await expect(t.mutation(api.copyBatch, { ...confirmation, table: "appSettings", batchSize: 1 })).rejects.toThrow("MIGRATION_SOURCE_CHANGED");
    expect((await runPlatform(ctx => ctx.db.query("appSettings").unique()))?.value).toBe("before");
    expect((await t.action(api.status, {})).tables.find(row => row.table === "appSettings")).toMatchObject({ mismatched: 1, matches: false });
  });

  test("rejects a nonempty destination and detects deleted or changed destination rows", async () => {
    const { t, runPlatform } = fixture();
    await runPlatform(ctx => ctx.db.insert("adminEmails", { email: "new@example.test" }));
    await expect(t.mutation(api.begin, confirmation)).rejects.toThrow("MIGRATION_TARGET_NOT_EMPTY");
    await runPlatform(async ctx => { const row = await ctx.db.query("adminEmails").unique(); if (row) await ctx.db.delete(row._id); });
    await seedAll(t);
    await t.mutation(api.begin, confirmation);
    for (const table of migrationTables) await t.mutation(api.copyBatch, { ...confirmation, table, batchSize: 50 });
    await runPlatform(async ctx => { const row = await ctx.db.query("appSettings").unique(); if (row) await ctx.db.patch(row._id, { value: "corrupt" }); });
    await expect(t.action(api.run, confirmation)).rejects.toThrow("MIGRATION_VERIFICATION_FAILED");
    await runPlatform(async ctx => { const row = await ctx.db.query("waitlistEntries").unique(); if (row) await ctx.db.delete(row._id); });
    expect((await t.action(api.status, {})).tables.find(row => row.table === "waitlistEntries")).toMatchObject({ missing: 1, matches: false });
  });

  test("transfers scheduled publication once and preserves pending work across interrupted activation", async () => {
    vi.useFakeTimers();
    const { t, runPlatform } = fixture();
    const startsAt = Date.now() + 10_000;
    const legacyJob = makeFunctionReference<"mutation">("announcements.js:handleScheduledStart");
    const source = await t.run(async ctx => {
      const id = await ctx.db.insert("announcements", { name: "Scheduled", bannerText: "Soon", isLive: false, scheduleStart: startsAt, createdAt: 1, updatedAt: 1 });
      const job = await ctx.scheduler.runAt(startsAt, legacyJob, { announcementId: id, expectedScheduleStart: startsAt });
      await ctx.db.patch(id, { publishJobId: job });
      return { id, job };
    });
    await t.mutation(api.begin, confirmation);
    for (const table of migrationTables) await t.mutation(api.copyBatch, { ...confirmation, table, batchSize: 1 });
    expect(await t.run(ctx => ctx.db.system.get(source.job))).toMatchObject({ state: { kind: "canceled" } });
    expect((await t.run(ctx => ctx.db.get(source.id)))?.publishJobId).toBeUndefined();
    expect((await t.action(api.status, {})).matches).toBe(true);
    await t.action(api.run, { ...confirmation, batchSize: 1, maxBatches: 1 });
    await t.action(api.run, confirmation);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await runPlatform(ctx => ctx.db.query("announcements").unique()))?.isLive).toBe(true);
    const events = await runPlatform(ctx => ctx.db.query("auditTrail").collect());
    expect(events.filter(event => event.action === "announcement.published")).toHaveLength(1);
    expect((await t.action(api.status, {})).matches).toBe(true);
  });

  test("rolls back legacy cancellation and checkpoint when destination import fails", async () => {
    vi.useFakeTimers();
    const { t, runPlatform } = fixture();
    const at = Date.now() + 10000;
    const source = await t.run(async ctx => {
      const id = await ctx.db.insert("announcements", { name: "Scheduled", bannerText: "Soon", isLive: false, scheduleStart: at, createdAt: 1, updatedAt: 1 });
      const job = await ctx.scheduler.runAt(at, makeFunctionReference<"mutation">("announcements:handleScheduledStart"), { announcementId: id, expectedScheduleStart: at });
      await ctx.db.patch(id, { publishJobId: job });
      return { id, job };
    });
    await t.mutation(api.begin, confirmation);
    await runPlatform(ctx => ctx.db.insert("migrationRows", { table: "announcements", legacyId: source.id, componentId: "missing", legacyCreationTime: 0, snapshot: "bad", schedulesActivated: false }));
    await expect(t.mutation(api.copyBatch, { ...confirmation, table: "announcements", batchSize: 1 })).rejects.toThrow("MIGRATION_SOURCE_CHANGED");
    expect((await t.run(ctx => ctx.db.get(source.id)))?.publishJobId).toBe(source.job);
    expect(await t.run(ctx => ctx.db.system.get(source.job))).toMatchObject({ state: { kind: "pending" } });
    expect(await t.query(components.platform.migration.progress, { table: "announcements" })).toEqual({ cursor: null, complete: false });
    // Keep this deliberately failing legacy callback out of the fake timer queue.
    await t.run(ctx => ctx.scheduler.cancel(source.job));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
  test("due jobs wait for interrupted schedule activation and retain publication ordering", async () => {
    vi.useFakeTimers();
    const { t, runPlatform } = fixture();
    const start = Date.now() + 1000;
    await t.run(async ctx => {
      for (let i = 0; i < 3; i++) {
        const id = await ctx.db.insert("announcements", { name: "Scheduled " + i, bannerText: "Soon", isLive: false, scheduleStart: start, createdAt: i, updatedAt: i });
        const job = await ctx.scheduler.runAt(start, makeFunctionReference<"mutation">("announcements:handleScheduledStart"), { announcementId: id, expectedScheduleStart: start });
        await ctx.db.patch(id, { publishJobId: job });
      }
    });
    await t.mutation(api.begin, confirmation);
    for (const table of migrationTables) await t.mutation(api.copyBatch, { ...confirmation, table, batchSize: 50 });
    await t.mutation(components.platform.migration.markVerified, {});
    await t.mutation(components.platform.migration.activateSchedules, { paginationOpts: { cursor: null, numItems: 1 } });
    await vi.advanceTimersByTimeAsync(1000);
    await t.finishInProgressScheduledFunctions();
    expect((await runPlatform(ctx => ctx.db.query("announcements").collect())).every(row => !row.isLive)).toBe(true);
    for (let i = 0; i < 4; i++) { const result = await t.action(api.run, { ...confirmation, batchSize: 1, maxBatches: 1 }); if (!result.resume) break; }
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const live = (await runPlatform(ctx => ctx.db.query("announcements").collect())).filter(row => row.isLive);
    expect(live.map(row => row.name)).toEqual(["Scheduled 2"]);
  });

});
