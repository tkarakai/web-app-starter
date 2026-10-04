/**
 * App-level tests: the wrappers in `convex/platform/` with the platform
 * component registered in convex-test. Component internals (validation,
 * truncation, pagination, indexes) are tested in `@web-app-starter/convex-platform`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createTestEnv } from "./test.modules";
import { api, components, internal } from "./_generated/api";
import { scheduleAuditEvent } from "./platform/auditTrailHelpers";
import authSchema from "./platform/betterAuth/schema";

async function allComponentRows(t: ReturnType<typeof createTestEnv>) {
  const result = await t.run((ctx) =>
    ctx.runQuery(components.platform.auditTrail.list, {
      paginationOpts: { numItems: 1000, cursor: null },
    }),
  );
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
  test("identity and rate limits stay in the wrapper; only admins can read component rows", async () => {
    const t = createTestEnv();
    t.registerComponent("betterAuth", authSchema, import.meta.glob("./platform/betterAuth/**/*.*s"));
    async function caller(name: string, role: string) {
      const now = Date.now();
      const user = await t.mutation(components.betterAuth.adapter.create, {
        input: { model: "user", data: {
          name, email: `${name}@example.test`, emailVerified: true, role,
          createdAt: now, updatedAt: now,
        } },
      });
      const session = await t.mutation(components.betterAuth.adapter.create, {
        input: { model: "session", data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
          userId: user._id, token: name, expiresAt: now + 60_000, createdAt: now, updatedAt: now,
        } },
      });
      return { client: t.withIdentity({ subject: user._id, sessionId: session._id }), user };
    }
    const member = await caller("member", "user");
    await member.client.mutation(api.platform.auditTrail.postEvent, {
      happenedAt: 123, action: "auth.sign_in", sourceDetail: "settings", resource: "session",
    });
    const [row] = await allComponentRows(t);
    expect(row).toMatchObject({ actor: "member@example.test", authenticatedUserId: member.user._id, source: "web:settings" });
    const limits = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(limits.some((r) => r.key === member.user._id)).toBe(true);
    const args = { paginationOpts: { numItems: 10, cursor: null } };
    expect((await member.client.query(api.platform.auditTrail.list, args)).page).toEqual([]);
    const admin = await caller("admin", "admin");
    expect((await admin.client.query(api.platform.auditTrail.list, args)).page).toEqual([row]);
  });

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
