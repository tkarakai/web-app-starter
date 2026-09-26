/**
 * App-level tests: the wrappers in `convex/platform/` with the platform
 * component registered in convex-test. Component internals (validation,
 * truncation, pagination, indexes) are tested in `@repo/convex-platform`.
 */
import { convexTest } from "convex-test";
import { registerPlatform } from "@repo/convex-platform/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { api, components, internal } from "./_generated/api";
import { scheduleAuditEvent } from "./platform/auditTrailHelpers";

const modules = import.meta.glob("./**/*.*s");

function createTestEnv() {
  const t = convexTest(schema, modules);
  registerPlatform(t);
  return t;
}

type Page = {
  page: Array<Record<string, unknown> & { _id: string; happenedAt: number }>;
  isDone: boolean;
  continueCursor: string;
};

async function allComponentRows(t: ReturnType<typeof createTestEnv>) {
  const result = (await t.run((ctx) =>
    ctx.runQuery(components.platform.auditTrail.list, {
      paginationOpts: { numItems: 1000, cursor: null },
    }),
  )) as Page;
  return result.page;
}

function makeInsertArgs(overrides: Record<string, unknown> = {}) {
  return {
    actor: "user@test.com",
    sourceDetail: "test",
    action: "auth.sign_in",
    resource: "session:abc123",
    status: "succeeded",
    ...overrides,
  };
}

describe("platform/auditTrail wrappers", () => {
  test("insertEvent writes to the component with the server: prefix", async () => {
    const t = createTestEnv();
    await t.mutation(
      internal.platform.auditTrail.insertEvent,
      makeInsertArgs({ sourceDetail: "auth-hook", authenticatedUserId: "u1" }),
    );
    const rows = await allComponentRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("server:auth-hook");
    expect(rows[0].authenticatedUserId).toBe("u1");
    // Nothing lands in the legacy app table any more.
    const legacy = await t.run((ctx) => ctx.db.query("auditTrail").collect());
    expect(legacy).toHaveLength(0);
  });

  test("component validation errors surface through the wrapper", async () => {
    const t = createTestEnv();
    await expect(
      t.mutation(
        internal.platform.auditTrail.insertEvent,
        makeInsertArgs({ action: "unknown.action" }),
      ),
    ).rejects.toThrow("UNKNOWN_AUDIT_ACTION");
  });

  test("postEvent without a user is a silent no-op", async () => {
    const t = createTestEnv();
    await t.mutation(api.platform.auditTrail.postEvent, {
      happenedAt: Date.now(),
      action: "auth.sign_in",
      resource: "x",
    });
    expect(await allComponentRows(t)).toHaveLength(0);
  });

  test("list returns an empty page for unauthenticated callers", async () => {
    const t = createTestEnv();
    await t.mutation(internal.platform.auditTrail.insertEvent, makeInsertArgs());
    const result = await t.query(api.platform.auditTrail.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result).toEqual({ page: [], isDone: true, continueCursor: "" });
  });

  describe("scheduleAuditEvent", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test("fire-and-forget via the scheduler reaches the component", async () => {
      const t = createTestEnv();
      await t.run((ctx) =>
        scheduleAuditEvent(ctx, {
          actor: "system",
          sourceDetail: "test-suite",
          action: "announcement.created",
          resource: "announcement:1",
          status: "succeeded",
        }),
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const rows = await allComponentRows(t);
      expect(rows.map((r) => r.action)).toEqual(["announcement.created"]);
    });
  });
});

describe("platform/migrateAuditTrail", () => {
  async function seedLegacy(t: ReturnType<typeof createTestEnv>, count: number) {
    await t.mutation(internal.platform.migrateAuditTrail.seedLegacyForSpike, {
      count,
    });
  }

  test("copies every legacy row, verifies counts and field equality", async () => {
    const t = createTestEnv();
    await seedLegacy(t, 257);
    // A row written after the component went live must not confuse the count.
    await t.mutation(internal.platform.auditTrail.insertEvent, makeInsertArgs());

    const before = await t.action(internal.platform.migrateAuditTrail.status, {});
    expect(before).toMatchObject({
      legacyRows: 257,
      componentRows: 1,
      componentRowsFromLegacy: 0,
      ok: false,
    });
    expect(before.missing).toHaveLength(257);

    const result = await t.action(internal.platform.migrateAuditTrail.run, {
      batchSize: 50,
    });
    expect(result.read).toBe(257);
    expect(result.inserted).toBe(257);
    expect(result.skipped).toBe(0);
    expect(result.status).toEqual({
      legacyRows: 257,
      componentRows: 258,
      componentRowsFromLegacy: 257,
      missing: [],
      mismatched: [],
      ok: true,
    });

    // Field-level spot check on top of the migration's own comparison.
    const legacy = await t.run((ctx) =>
      ctx.db.query("auditTrail").order("asc").first(),
    );
    const [copy] = (await t.run((ctx) =>
      ctx.runQuery(components.platform.auditTrail.getByLegacyIds, {
        legacyIds: [legacy!._id],
      }),
    )) as Array<Record<string, unknown>>;
    const { _id, _creationTime, ...legacyFields } = legacy!;
    expect(copy).toMatchObject({
      ...legacyFields,
      legacyId: _id,
      legacyCreationTime: _creationTime,
    });
  });

  test("is idempotent: a re-run copies nothing and still verifies", async () => {
    const t = createTestEnv();
    await seedLegacy(t, 120);
    await t.action(internal.platform.migrateAuditTrail.run, { batchSize: 40 });
    const rerun = await t.action(internal.platform.migrateAuditTrail.run, {
      batchSize: 40,
    });
    expect(rerun.inserted).toBe(0);
    expect(rerun.skipped).toBe(120);
    expect(rerun.status.ok).toBe(true);
    expect(rerun.status.componentRows).toBe(120);
  });

  test("detects a tampered copy", async () => {
    const t = createTestEnv();
    await seedLegacy(t, 5);
    await t.action(internal.platform.migrateAuditTrail.run, {});
    const victim = await t.run((ctx) => ctx.db.query("auditTrail").first());
    await t.run((ctx) => ctx.db.patch(victim!._id, { actor: "changed@x.com" }));
    const status = await t.action(internal.platform.migrateAuditTrail.status, {});
    expect(status.ok).toBe(false);
    expect(status.mismatched).toEqual([victim!._id]);
  });
});
