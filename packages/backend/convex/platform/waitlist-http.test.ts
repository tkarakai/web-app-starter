import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestEnv } from "../test.modules";
import { components } from "../_generated/api";
import * as validation from "@web-app-starter/convex-platform/waitlist-validation";

async function fixture(mode = "publicWaitlist") {
  const t = createTestEnv();
  await t.mutation(components.platform.appSettings.set, { key: "onboardingType", value: mode, userId: "test-admin" });
  const join = (body: unknown, ip = "203.0.113.1") => t.fetch("/api/waitlist/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `${ip}, 192.0.2.1` },
    body: JSON.stringify(body),
  });
  const rows = async () => (await t.query(components.platform.waitlist.list, { paginationOpts: { cursor: null, numItems: 100 } })).page;
  return { t, join, rows };
}

describe("waitlist HTTP metadata boundary", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  test.each(["{}", '{"teamSize":3}', '{"superpowers":["coffee-to-code"],"excitement":["cant-wait"]}'])("stores the original meta string and deduplicates: %s", async (meta) => {
    const { join, rows } = await fixture();
    const first = await join({ email: " BUYER@example.test ", meta });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, alreadyJoined: false });
    expect(await (await join({ email: "buyer@example.test", meta: "{}" })).json()).toEqual({ success: true, alreadyJoined: true });
    expect(await rows()).toMatchObject([{ email: "buyer@example.test", meta }]);
    expect(await rows()).toHaveLength(1);
  });

  test("retains omitted metadata and object-payload compatibility", async () => {
    const { join, rows } = await fixture();
    expect((await join({ email: "empty@example.test" })).status).toBe(200);
    expect((await join({ email: "custom@example.test", meta: { team: "custom" } })).status).toBe(200);
    expect((await rows()).map(row => row.meta).sort()).toEqual(["{}", '{"team":"custom"}'].sort());
  });

  test("stores exactly 16 KiB unchanged and rejects one byte more", async () => {
    const { join, rows } = await fixture();
    const meta = JSON.stringify({ x: "é".repeat((16_384 - 8) / 2) });
    expect((await join({ email: "buyer@example.test", meta })).status).toBe(200);
    const oversized = await join({ email: "other@example.test", meta: meta + " " });
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "INVALID_META" });
    expect(await rows()).toMatchObject([{ meta }]);
    expect(await rows()).toHaveLength(1);
  });

  test.each(["{", "null", "[]", "42", '"text"', '{"__proto__":{}}', '{"nested":[{"constructor":{}}]}', JSON.stringify({ x: "é".repeat(8192) }), null, []])("rejects invalid metadata without storing it (case %#)", async (meta) => {
    const { join, rows } = await fixture();
    const response = await join({ email: "buyer@example.test", meta });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_META" });
    expect(await rows()).toEqual([]);
  });

  test("malformed request bodies return a fixed client error", async () => {
    const { t, join } = await fixture();
    for (const response of [await t.fetch("/api/waitlist/join", { method: "POST", body: '{"private-answer":' }), await join(null), await join([])]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
    }
  });

  test("unexpected errors never expose internal details", async () => {
    const { join } = await fixture();
    vi.spyOn(validation, "validateMeta").mockImplementationOnce(() => { throw new Error("secret-internal-value"); });
    const response = await join({ email: "buyer@example.test", meta: "{}" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "UNKNOWN_ERROR" });
  });

  test.each(["inviteOnly", "publicSignup"])("retains the %s onboarding gate", async (mode) => {
    const { join, rows } = await fixture(mode);
    const response = await join({ email: "buyer@example.test", meta: "{}" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "WAITLIST_NOT_ENABLED" });
    expect(await rows()).toEqual([]);
  });

  test("retains email validation and per-visitor rate limiting including duplicates", async () => {
    const { join, rows } = await fixture();
    expect((await join({ email: "invalid", meta: "{}" })).status).toBe(400);
    expect((await join({ email: "x".repeat(256) + "@example.test", meta: "{}" })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await join({ email: "buyer@example.test", meta: "{}" })).status).toBe(200);
    const limited = await join({ email: "next@example.test", meta: "{}" });
    expect(limited.status).toBe(400);
    expect(await limited.json()).toEqual({ error: "RATE_LIMITED" });
    expect((await join({ email: "next@example.test", meta: "{}" }, "203.0.113.2")).status).toBe(200);
    expect(await rows()).toHaveLength(2);
  });
});
