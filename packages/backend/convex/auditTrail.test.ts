import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";

import schema from "./schema";
import { buildAuditEvent } from "./auditTrail";

const modules = import.meta.glob("./**/*.*s");

function createTestEnv() {
  return convexTest(schema, modules);
}

function makeEvent(overrides: Partial<Parameters<typeof buildAuditEvent>[0]> = {}) {
  return buildAuditEvent({
    actor: "user-123",
    actorType: "user",
    action: "auth.sign_in",
    resource: "session-abc",
    status: "succeeded",
    ...overrides,
  });
}

describe("auditTrail", () => {
  describe("schema", () => {
    test("inserts event with all required fields", async () => {
      const t = createTestEnv();

      const id = await t.run(async (ctx) => {
        return ctx.db.insert("auditTrail", makeEvent());
      });

      const result = await t.run(async (ctx) => {
        return ctx.db.get(id);
      });

      expect(result).toBeDefined();
      expect(result?.actor).toBe("user-123");
      expect(result?.actorType).toBe("user");
      expect(result?.action).toBe("auth.sign_in");
      expect(result?.resource).toBe("session-abc");
      expect(result?.status).toBe("succeeded");
      expect(result?.eventId).toBeDefined();
      expect(result?.happenedAt).toBeTypeOf("number");
      expect(result?.receivedAt).toBeTypeOf("number");
    });

    test("inserts event with optional fields", async () => {
      const t = createTestEnv();

      const id = await t.run(async (ctx) => {
        return ctx.db.insert(
          "auditTrail",
          makeEvent({
            oldValue: JSON.stringify({ name: "Alice" }),
            newValue: JSON.stringify({ name: "Bob" }),
            reason: "User requested name change",
            meta: JSON.stringify({ ip: "127.0.0.1" }),
          }),
        );
      });

      const result = await t.run(async (ctx) => {
        return ctx.db.get(id);
      });

      expect(result?.oldValue).toBe(JSON.stringify({ name: "Alice" }));
      expect(result?.newValue).toBe(JSON.stringify({ name: "Bob" }));
      expect(result?.reason).toBe("User requested name change");
      expect(result?.meta).toBe(JSON.stringify({ ip: "127.0.0.1" }));
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
        await ctx.db.insert("auditTrail", makeEvent({ happenedAt: 1000 }));
        await ctx.db.insert("auditTrail", makeEvent({ happenedAt: 3000 }));
        await ctx.db.insert("auditTrail", makeEvent({ happenedAt: 2000 }));
      });

      const asc = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_happenedAt")
          .order("asc")
          .collect();
      });

      expect(asc.map((e) => e.happenedAt)).toEqual([1000, 2000, 3000]);

      const desc = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_happenedAt")
          .order("desc")
          .collect();
      });

      expect(desc.map((e) => e.happenedAt)).toEqual([3000, 2000, 1000]);
    });

    test("by_action_happenedAt filters by action", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert(
          "auditTrail",
          makeEvent({ action: "auth.sign_in", happenedAt: 1000 }),
        );
        await ctx.db.insert(
          "auditTrail",
          makeEvent({ action: "auth.sign_out", happenedAt: 2000 }),
        );
        await ctx.db.insert(
          "auditTrail",
          makeEvent({ action: "auth.sign_in", happenedAt: 3000 }),
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

    test("by_eventId lookup returns the correct event", async () => {
      const t = createTestEnv();

      const event = makeEvent();
      await t.run(async (ctx) => {
        await ctx.db.insert("auditTrail", event);
      });

      const result = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_eventId", (q) => q.eq("eventId", event.eventId))
          .unique();
      });

      expect(result).toBeDefined();
      expect(result?.actor).toBe("user-123");
    });

    test("by_actor_happenedAt filters by actor", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert("auditTrail", makeEvent({ actor: "alice" }));
        await ctx.db.insert("auditTrail", makeEvent({ actor: "bob" }));
        await ctx.db.insert("auditTrail", makeEvent({ actor: "alice" }));
      });

      const results = await t.run(async (ctx) => {
        return ctx.db
          .query("auditTrail")
          .withIndex("by_actor_happenedAt", (q) => q.eq("actor", "alice"))
          .collect();
      });

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.actor === "alice")).toBe(true);
    });

    test("by_action_status_happenedAt filters by action + status", async () => {
      const t = createTestEnv();

      await t.run(async (ctx) => {
        await ctx.db.insert(
          "auditTrail",
          makeEvent({ action: "auth.sign_in", status: "succeeded" }),
        );
        await ctx.db.insert(
          "auditTrail",
          makeEvent({
            action: "auth.sign_in",
            status: "failed:invalid_credentials",
          }),
        );
        await ctx.db.insert(
          "auditTrail",
          makeEvent({ action: "auth.sign_out", status: "succeeded" }),
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

  describe("buildAuditEvent", () => {
    test("generates eventId as UUID", () => {
      const event = makeEvent();
      expect(event.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    test("sets receivedAt to current time", () => {
      const before = Date.now();
      const event = makeEvent();
      const after = Date.now();

      expect(event.receivedAt).toBeGreaterThanOrEqual(before);
      expect(event.receivedAt).toBeLessThanOrEqual(after);
    });

    test("uses provided happenedAt", () => {
      const event = makeEvent({ happenedAt: 12345 });
      expect(event.happenedAt).toBe(12345);
    });

    test("defaults happenedAt to current time when omitted", () => {
      const before = Date.now();
      const event = makeEvent();
      const after = Date.now();

      expect(event.happenedAt).toBeGreaterThanOrEqual(before);
      expect(event.happenedAt).toBeLessThanOrEqual(after);
    });

    test("includes optional fields only when provided", () => {
      const minimal = makeEvent();
      expect(minimal).not.toHaveProperty("oldValue");
      expect(minimal).not.toHaveProperty("newValue");
      expect(minimal).not.toHaveProperty("reason");
      expect(minimal).not.toHaveProperty("meta");

      const full = makeEvent({
        oldValue: "old",
        newValue: "new",
        reason: "test",
        meta: "{}",
      });
      expect(full.oldValue).toBe("old");
      expect(full.newValue).toBe("new");
      expect(full.reason).toBe("test");
      expect(full.meta).toBe("{}");
    });

    test("rejects fields exceeding max length", () => {
      expect(() => makeEvent({ actor: "a".repeat(501) })).toThrow(
        "actor_TOO_LONG",
      );
      expect(() => makeEvent({ action: "a".repeat(101) })).toThrow(
        "action_TOO_LONG",
      );
      expect(() => makeEvent({ resource: "a".repeat(501) })).toThrow(
        "resource_TOO_LONG",
      );
      expect(() => makeEvent({ oldValue: "a".repeat(10_001) })).toThrow(
        "oldValue_TOO_LONG",
      );
      expect(() => makeEvent({ newValue: "a".repeat(10_001) })).toThrow(
        "newValue_TOO_LONG",
      );
      expect(() => makeEvent({ reason: "a".repeat(2_001) })).toThrow(
        "reason_TOO_LONG",
      );
      expect(() => makeEvent({ meta: "a".repeat(5_001) })).toThrow(
        "meta_TOO_LONG",
      );
      expect(() => makeEvent({ status: "a".repeat(201) })).toThrow(
        "status_TOO_LONG",
      );
    });
  });
});
