/**
 * Component-level tests: the platform component under convex-test on its own,
 * the way a component author tests it (no app, no auth).
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function createTestEnv() {
  return convexTest(schema, modules);
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    happenedAt: Date.now(),
    actor: "user@test.com",
    source: "server:test",
    action: "auth.sign_in",
    resource: "session:abc123",
    status: "succeeded",
    ...overrides,
  };
}

function makeInsertArgs(overrides: Record<string, unknown> = {}) {
  return {
    actor: "user@test.com",
    source: "server:test",
    action: "auth.sign_in",
    resource: "session:abc123",
    status: "succeeded",
    ...overrides,
  } as {
    actor: string;
    source: string;
    action: string;
    resource: string;
    status: string;
  };
}

describe("platform component: auditTrail", () => {
  describe("schema", () => {
    test("inserts event with all required fields", async () => {
      const t = createTestEnv();
      const id = await t.run((ctx) => ctx.db.insert("auditTrail", makeDoc()));
      const result = await t.run((ctx) => ctx.db.get(id));
      expect(result?.actor).toBe("user@test.com");
      expect(result?.source).toBe("server:test");
      expect(result?.happenedAt).toBeTypeOf("number");
    });

    test("inserts event with optional fields", async () => {
      const t = createTestEnv();
      const id = await t.run((ctx) =>
        ctx.db.insert(
          "auditTrail",
          makeDoc({
            authenticatedUserId: "user-xyz",
            oldValue: "a",
            newValue: "b",
            reason: "r",
            meta: "{}",
            truncatedFields: "meta",
          }),
        ),
      );
      const result = await t.run((ctx) => ctx.db.get(id));
      expect(result?.authenticatedUserId).toBe("user-xyz");
      expect(result?.truncatedFields).toBe("meta");
    });

    test("validates required fields", async () => {
      const t = createTestEnv();
      await expect(
        t.run(async (ctx) => {
          // @ts-expect-error — intentionally passing invalid data
          return ctx.db.insert("auditTrail", { action: "test" });
        }),
      ).rejects.toThrow();
    });
  });

  describe("indexes", () => {
    test("by_happenedAt returns time-ordered results", async () => {
      const t = createTestEnv();
      await t.run(async (ctx) => {
        await ctx.db.insert("auditTrail", makeDoc({ happenedAt: 1000 }));
        await ctx.db.insert("auditTrail", makeDoc({ happenedAt: 3000 }));
        await ctx.db.insert("auditTrail", makeDoc({ happenedAt: 2000 }));
      });
      const asc = await t.run((ctx) =>
        ctx.db.query("auditTrail").withIndex("by_happenedAt").order("asc").collect(),
      );
      expect(asc.map((e) => e.happenedAt)).toEqual([1000, 2000, 3000]);
    });

    test("by_action_status_happenedAt filters by action + status", async () => {
      const t = createTestEnv();
      await t.run(async (ctx) => {
        await ctx.db.insert("auditTrail", makeDoc({ status: "succeeded" }));
        await ctx.db.insert("auditTrail", makeDoc({ status: "failed.wrong_password" }));
        await ctx.db.insert("auditTrail", makeDoc({ action: "auth.sign_out" }));
      });
      const results = await t.run((ctx) =>
        ctx.db
          .query("auditTrail")
          .withIndex("by_action_status_happenedAt", (q) =>
            q.eq("action", "auth.sign_in").eq("status", "succeeded"),
          )
          .collect(),
      );
      expect(results).toHaveLength(1);
    });
  });

  describe("insertEvent", () => {
    test("stores the source as given", async () => {
      const t = createTestEnv();
      await t.mutation(
        api.auditTrail.insertEvent,
        makeInsertArgs({ source: "web:settings" }),
      );
      const rows = await t.run((ctx) => ctx.db.query("auditTrail").collect());
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe("web:settings");
    });

    test("returns the new id as a string", async () => {
      const t = createTestEnv();
      const id = await t.mutation(api.auditTrail.insertEvent, makeInsertArgs());
      expect(typeof id).toBe("string");
    });

    test("uses provided happenedAt, defaults to now otherwise", async () => {
      const t = createTestEnv();
      const before = Date.now();
      await t.mutation(api.auditTrail.insertEvent, {
        ...makeInsertArgs(),
        happenedAt: 12345,
      });
      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs());
      const rows = await t.run((ctx) =>
        ctx.db.query("auditTrail").withIndex("by_happenedAt").collect(),
      );
      expect(rows[0].happenedAt).toBe(12345);
      expect(rows[1].happenedAt).toBeGreaterThanOrEqual(before);
    });

    test("includes optional fields only when provided", async () => {
      const t = createTestEnv();
      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs());
      const [row] = await t.run((ctx) => ctx.db.query("auditTrail").collect());
      expect(row.authenticatedUserId).toBeUndefined();
      expect(row.oldValue).toBeUndefined();
      expect(row.meta).toBeUndefined();
      expect(row.truncatedFields).toBeUndefined();
    });

    test("rejects unknown action", async () => {
      const t = createTestEnv();
      await expect(
        t.mutation(
          api.auditTrail.insertEvent,
          makeInsertArgs({ action: "unknown.action" }),
        ),
      ).rejects.toThrow("UNKNOWN_AUDIT_ACTION");
    });

    test("rejects unknown status", async () => {
      const t = createTestEnv();
      await expect(
        t.mutation(
          api.auditTrail.insertEvent,
          makeInsertArgs({ status: "unknown_status" }),
        ),
      ).rejects.toThrow("UNKNOWN_AUDIT_STATUS");
    });

    test("rejects unknown source transport (now testable at the boundary)", async () => {
      const t = createTestEnv();
      await expect(
        t.mutation(
          api.auditTrail.insertEvent,
          makeInsertArgs({ source: "carrier-pigeon:x" }),
        ),
      ).rejects.toThrow("UNKNOWN_AUDIT_SOURCE_TRANSPORT");
    });

    test("truncates fields exceeding max length", async () => {
      const t = createTestEnv();
      await t.mutation(api.auditTrail.insertEvent, {
        ...makeInsertArgs(),
        oldValue: "x".repeat(15_000),
        reason: "y".repeat(3_000),
      });
      const [row] = await t.run((ctx) => ctx.db.query("auditTrail").collect());
      expect(row.oldValue?.length).toBe(10_000);
      expect(row.reason?.length).toBe(2_000);
      expect(row.truncatedFields).toBe("oldValue,reason");
    });
  });

  describe("list (convex-helpers paginator)", () => {
    async function seed(t: ReturnType<typeof createTestEnv>) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 25; i++) {
          await ctx.db.insert(
            "auditTrail",
            makeDoc({
              happenedAt: 1000 + i,
              action: i % 2 === 0 ? "auth.sign_in" : "auth.sign_out",
              status: i % 3 === 0 ? "failed.wrong_password" : "succeeded",
              actor: i % 5 === 0 ? "alice@test.com" : "bob@test.com",
              source: i % 4 === 0 ? "web:settings" : "server:auth-hook",
            }),
          );
        }
      });
    }

    test("pages through everything in reverse chronological order", async () => {
      const t = createTestEnv();
      await seed(t);
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      for (;;) {
        const result: {
          page: { happenedAt: number }[];
          isDone: boolean;
          continueCursor: string;
        } = await t.query(api.auditTrail.list, {
          paginationOpts: { numItems: 10, cursor },
        });
        pages++;
        seen.push(...result.page.map((d) => d.happenedAt));
        if (result.isDone) break;
        cursor = result.continueCursor;
      }
      expect(pages).toBe(3);
      expect(seen).toHaveLength(25);
      expect(seen).toEqual([...seen].sort((a, b) => b - a));
      expect(new Set(seen).size).toBe(25);
    });

    test("combines an indexed filter with post-filters conjunctively", async () => {
      const t = createTestEnv();
      await seed(t);
      const result = await t.query(api.auditTrail.list, {
        paginationOpts: { numItems: 50, cursor: null },
        filterAction: "auth.sign_in",
        filterActor: "alice@test.com",
        filterSource: "web:settings",
      });
      // i even, i % 5 === 0, i % 4 === 0 → i ∈ {0, 20}
      expect(result.page.map((d) => d.happenedAt)).toEqual([1020, 1000]);
      expect(result.isDone).toBe(true);
    });

    test("action + status uses the compound index", async () => {
      const t = createTestEnv();
      await seed(t);
      const result = await t.query(api.auditTrail.list, {
        paginationOpts: { numItems: 50, cursor: null },
        filterAction: "auth.sign_in",
        filterStatus: "failed.wrong_password",
      });
      // i even and i % 3 === 0 → 0, 6, 12, 18, 24
      expect(result.page.map((d) => d.happenedAt)).toEqual([
        1024, 1018, 1012, 1006, 1000,
      ]);
    });

    test("post-filtered pages still return a full page when more rows match", async () => {
      const t = createTestEnv();
      await seed(t);
      const first = await t.query(api.auditTrail.list, {
        paginationOpts: { numItems: 2, cursor: null },
        filterStatus: "succeeded",
        filterActor: "bob@test.com",
      });
      expect(first.page).toHaveLength(2);
      expect(first.isDone).toBe(false);
      const second = await t.query(api.auditTrail.list, {
        paginationOpts: { numItems: 2, cursor: first.continueCursor },
        filterStatus: "succeeded",
        filterActor: "bob@test.com",
      });
      expect(second.page[0].happenedAt).toBeLessThan(
        first.page[1].happenedAt,
      );
    });
  });

  describe("declared env", () => {
    test("reads the declared SITE_URL and optional retention", async () => {
      const t = createTestEnv();
      const probe = await t.query(api.auditTrail.envProbe, {});
      expect(probe.siteUrl).toBe("http://localhost:3001");
      expect(probe.retentionDays).toBeNull();
    });
  });

  describe("importLegacyEvents", () => {
    test("is idempotent by legacyId", async () => {
      const t = createTestEnv();
      const events = [1, 2, 3].map((i) => ({
        ...makeDoc({ happenedAt: i }),
        legacyId: `legacy-${i}`,
        legacyCreationTime: i,
      }));
      const first = await t.mutation(api.auditTrail.importLegacyEvents, { events });
      const second = await t.mutation(api.auditTrail.importLegacyEvents, { events });
      expect(first).toEqual({ inserted: 3, skipped: 0 });
      expect(second).toEqual({ inserted: 0, skipped: 3 });
      const count = await t.query(api.auditTrail.countPage, {
        cursor: null,
        numItems: 100,
      });
      expect(count).toMatchObject({ total: 3, migrated: 3, isDone: true });
    });
  });
});
