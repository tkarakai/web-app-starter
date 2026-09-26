import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";

import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

function createTestEnv() {
  return convexTest(schema, modules);
}

// Helper: build a minimal valid event doc for direct DB insertion
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

// Helper: args for insertEvent mutation
function makeInsertArgs(overrides: Record<string, unknown> = {}) {
  return {
    actor: "user@test.com",
    source: "server:test",
    action: "auth.sign_in",
    resource: "session:abc123",
    status: "succeeded",
    ...overrides,
  };
}

describe("auditTrail", () => {
  describe("schema", () => {
    test("inserts event with all required fields", async () => {
      const t = createTestEnv();

      const id = await t.run(async (ctx) => {
        return ctx.db.insert("auditTrail", makeDoc());
      });

      const result = await t.run(async (ctx) => {
        return ctx.db.get(id);
      });

      expect(result).toBeDefined();
      expect(result?.actor).toBe("user@test.com");
      expect(result?.source).toBe("server:test");
      expect(result?.action).toBe("auth.sign_in");
      expect(result?.resource).toBe("session:abc123");
      expect(result?.status).toBe("succeeded");
      expect(result?.happenedAt).toBeTypeOf("number");
    });

    test("inserts event with optional fields", async () => {
      const t = createTestEnv();

      const id = await t.run(async (ctx) => {
        return ctx.db.insert(
          "auditTrail",
          makeDoc({
            authenticatedUserId: "user-xyz",
            oldValue: JSON.stringify({ name: "Alice" }),
            newValue: JSON.stringify({ name: "Bob" }),
            reason: "User requested name change",
            meta: JSON.stringify({ ip: "127.0.0.1" }),
            truncatedFields: "meta",
          }),
        );
      });

      const result = await t.run(async (ctx) => {
        return ctx.db.get(id);
      });

      expect(result?.authenticatedUserId).toBe("user-xyz");
      expect(result?.oldValue).toBe(JSON.stringify({ name: "Alice" }));
      expect(result?.newValue).toBe(JSON.stringify({ name: "Bob" }));
      expect(result?.reason).toBe("User requested name change");
      expect(result?.meta).toBe(JSON.stringify({ ip: "127.0.0.1" }));
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

      const asc = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_happenedAt")
          .order("asc")
          .collect();
      });

      expect(asc.map((e) => e.happenedAt)).toEqual([1000, 2000, 3000]);
    });

    test("by_action_happenedAt filters by action", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert(
          "auditTrail",
          makeDoc({ action: "auth.sign_in", happenedAt: 1000 }),
        );
        await ctx.db.insert(
          "auditTrail",
          makeDoc({ action: "auth.sign_out", happenedAt: 2000 }),
        );
        await ctx.db.insert(
          "auditTrail",
          makeDoc({ action: "auth.sign_in", happenedAt: 3000 }),
        );
      });

      const results = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_action_happenedAt", (q) =>
            q.eq("action", "auth.sign_in"),
          )
          .order("desc")
          .collect();
      });

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.action === "auth.sign_in")).toBe(true);
      expect(results[0].happenedAt).toBe(3000);
    });

    test("by_actor_happenedAt filters by actor", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("auditTrail", makeDoc({ actor: "alice@test.com" }));
        await ctx.db.insert("auditTrail", makeDoc({ actor: "bob@test.com" }));
        await ctx.db.insert("auditTrail", makeDoc({ actor: "alice@test.com" }));
      });

      const results = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_actor_happenedAt", (q) => q.eq("actor", "alice@test.com"))
          .collect();
      });

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.actor === "alice@test.com")).toBe(true);
    });

    test("by_source_happenedAt filters by source", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("auditTrail", makeDoc({ source: "server:auth-hook" }));
        await ctx.db.insert("auditTrail", makeDoc({ source: "web:dashboard" }));
        await ctx.db.insert("auditTrail", makeDoc({ source: "server:auth-hook" }));
      });

      const results = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_source_happenedAt", (q) => q.eq("source", "server:auth-hook"))
          .collect();
      });

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.source === "server:auth-hook")).toBe(true);
    });

    test("by_authenticatedUserId_happenedAt filters by authenticated user", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("auditTrail", makeDoc({ authenticatedUserId: "user-1" }));
        await ctx.db.insert("auditTrail", makeDoc({ authenticatedUserId: "user-2" }));
        await ctx.db.insert("auditTrail", makeDoc({ authenticatedUserId: "user-1" }));
      });

      const results = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_authenticatedUserId_happenedAt", (q) =>
            q.eq("authenticatedUserId", "user-1"),
          )
          .collect();
      });

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.authenticatedUserId === "user-1")).toBe(true);
    });

    test("by_action_status_happenedAt filters by action + status", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert(
          "auditTrail",
          makeDoc({ action: "auth.sign_in", status: "succeeded" }),
        );
        await ctx.db.insert(
          "auditTrail",
          makeDoc({ action: "auth.sign_in", status: "failed.wrong_password" }),
        );
        await ctx.db.insert(
          "auditTrail",
          makeDoc({ action: "auth.sign_out", status: "succeeded" }),
        );
      });

      const results = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_action_status_happenedAt", (q) =>
            q.eq("action", "auth.sign_in").eq("status", "succeeded"),
          )
          .collect();
      });

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("auth.sign_in");
      expect(results[0].status).toBe("succeeded");
    });
  });

  describe("insertEvent", () => {
    test("creates event with server: source prefix", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
        source: "server:auth-hook",
      }));

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("server:auth-hook");
    });

    test("uses provided happenedAt", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
        happenedAt: 12345,
      }));

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].happenedAt).toBe(12345);
    });

    test("defaults happenedAt to current time when omitted", async () => {
      const t = createTestEnv();
      const before = Date.now();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs());

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].happenedAt).toBeGreaterThanOrEqual(before);
    });

    test("stores authenticatedUserId when provided", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
        authenticatedUserId: "user-abc",
      }));

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].authenticatedUserId).toBe("user-abc");
    });

    test("authenticatedUserId is undefined when not provided", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs());

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].authenticatedUserId).toBeUndefined();
    });

    test("includes optional fields only when provided", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs());

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].oldValue).toBeUndefined();
      expect(results[0].newValue).toBeUndefined();
      expect(results[0].reason).toBeUndefined();
      expect(results[0].meta).toBeUndefined();
    });

    test("stores optional fields when provided", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
        oldValue: "old",
        newValue: "new",
        reason: "test",
        meta: "{}",
      }));

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].oldValue).toBe("old");
      expect(results[0].newValue).toBe("new");
      expect(results[0].reason).toBe("test");
      expect(results[0].meta).toBe("{}");
    });

    test("rejects unknown action", async () => {
      const t = createTestEnv();

      await expect(
        t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
          action: "unknown.action",
        })),
      ).rejects.toThrow("UNKNOWN_AUDIT_ACTION");
    });

    test("rejects unknown status", async () => {
      const t = createTestEnv();

      await expect(
        t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
          status: "unknown_status",
        })),
      ).rejects.toThrow("UNKNOWN_AUDIT_STATUS");
    });

    test("stores an explicit server source", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
        source: "server:test-detail",
      }));

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].source).toBe("server:test-detail");
    });

    test("truncates fields exceeding max length", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
        oldValue: "x".repeat(15_000),
        reason: "y".repeat(3_000),
      }));

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].oldValue?.length).toBe(10_000);
      expect(results[0].reason?.length).toBe(2_000);
      expect(results[0].truncatedFields).toBe("oldValue,reason");
    });

    test("does not set truncatedFields when no fields are truncated", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
        oldValue: "short value",
      }));

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].truncatedFields).toBeUndefined();
    });
  });

  describe("unauthenticated events", () => {
    test("creates event without authenticatedUserId (unauthenticated)", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
        actor: "visitor@example.com",
        source: "server:waitlist",
        action: "waitlist.joined",
        resource: "waitlist-entry:abc123",
        status: "succeeded",
      }));

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results).toHaveLength(1);
      expect(results[0].authenticatedUserId).toBeUndefined();
      expect(results[0].actor).toBe("visitor@example.com");
      expect(results[0].source).toBe("server:waitlist");
      expect(results[0].action).toBe("waitlist.joined");
    });

    test("accepts waitlist action enums", async () => {
      const t = createTestEnv();
      const waitlistActions = [
        "waitlist.joined",
        "waitlist.invitation.sent",
        "waitlist.invitation.revoked",
        "waitlist.entry.deleted",
        "waitlist.token.claimed",
        "waitlist.token.released",
      ];

      for (const action of waitlistActions) {
        await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
          action,
        }));
      }

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results).toHaveLength(waitlistActions.length);
    });

    test("accepts new failure status enums", async () => {
      const t = createTestEnv();
      const failureStatuses = [
        "failed.expired",
        "failed.already_used",
        "failed.blocked",
      ];

      for (const status of failureStatuses) {
        await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
          status,
        }));
      }

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results).toHaveLength(failureStatuses.length);
    });

    test("unauthenticated event with failure status and reason", async () => {
      const t = createTestEnv();

      await t.mutation(api.auditTrail.insertEvent, makeInsertArgs({
        actor: "visitor@example.com",
        source: "server:waitlist-token",
        action: "waitlist.token.claimed",
        resource: "invitation-token:xyz",
        status: "failed.expired",
        reason: "TOKEN_EXPIRED",
      }));

      const results = await t.run(async (ctx) => {
        return ctx.db.query("auditTrail").collect();
      });

      expect(results[0].authenticatedUserId).toBeUndefined();
      expect(results[0].status).toBe("failed.expired");
      expect(results[0].reason).toBe("TOKEN_EXPIRED");
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
