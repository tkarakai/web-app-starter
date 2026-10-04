import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestEnv } from "../test.modules";
import { components, internal } from "../_generated/api";
import schema from "./betterAuth/schema";
import { FIXTURE_HEADER } from "./localFixtures";

vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
const secret = "a1".repeat(32);
const email = "e2e-local-fixture@e2e.local";
const body = { email, password: "orchid quartz lantern telescope meadow violin glacier", isAdmin: true };
const local = { DEV_SEED_ENABLED: "true", DEV_FIXTURE_RUNTIME: "anonymous", DEV_FIXTURE_SECRET: secret, SITE_URL: "http://localhost:3000,http://localhost:3001", CONVEX_CLOUD_URL: "http://127.0.0.1:3210", CONVEX_SITE_URL: "http://127.0.0.1:3211" };
function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", schema, import.meta.glob("./betterAuth/**/*.*s"));
  return t;
}
beforeEach(() => {
  for (const [key, value] of Object.entries(local)) vi.stubEnv(key, value);
  vi.stubEnv("BETTER_AUTH_SECRET", "local-fixture-test-secret-at-least-32-characters");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("00000000000000000000000000000000000:0")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function post(t: ReturnType<typeof fixture>, capability: string | undefined = secret, data: unknown = body) {
  return t.fetch("/api/dev/e2e-user", { method: "POST", headers: { "content-type": "application/json", ...(capability ? { [FIXTURE_HEADER]: capability } : {}) }, body: JSON.stringify(data) });
}
async function noUsers(t: ReturnType<typeof fixture>) {
  expect(await t.query(components.betterAuth.adapter.findMany, { model: "user", paginationOpts: { cursor: null, numItems: 10 } })).toMatchObject({ page: [] });
  expect(await t.query(components.platform.adminEmails.list, {})).toEqual([]);
}

describe("local fixture authorization", () => {
  test.each([
    ["DEV_SEED_ENABLED", undefined], ["DEV_SEED_ENABLED", "false"],
    ["DEV_FIXTURE_RUNTIME", undefined], ["DEV_FIXTURE_RUNTIME", "production"],
    ["DEV_FIXTURE_SECRET", undefined], ["DEV_FIXTURE_SECRET", "weak"],
    ["SITE_URL", undefined], ["SITE_URL", "https://production.example.test"],
    ["SITE_URL", "http://localhost:3000,https://production.example.test"],
    ["SITE_URL", "http://localhost:3000/path"], ["SITE_URL", "http://user@localhost:3000"],
    ["SITE_URL", "invalid"], ["SITE_URL", "http://localhost.example.test"],
    ["CONVEX_CLOUD_URL", "https://hosted.convex.cloud"], ["CONVEX_SITE_URL", "https://hosted.convex.site"],
    ["CONVEX_CLOUD_URL", undefined], ["CONVEX_SITE_URL", "http://localhost:3211?x=1"],
    ["CONVEX_SITE_URL", "http://convex.localhost.floci.io:3311"],
  ])("rejects %s=%s before any side effect", async (key, value) => {
    vi.stubEnv(key!, value);
    const t = fixture();
    expect((await post(t)).status).toBe(404);
    expect((await t.fetch("/api/dev/totp-code", { headers: { [FIXTURE_HEADER]: secret } })).status).toBe(404);
    await noUsers(t);
  });

  test.each(["", "wrong", "b2".repeat(32)])("denies absent/incorrect capability %s", async capability => {
    const t = fixture();
    expect((await post(t, capability)).status).toBe(404);
    expect((await t.fetch("/api/dev/totp-code", { headers: { [FIXTURE_HEADER]: capability } })).status).toBe(404);
    await noUsers(t);
  });

  test("body and query parameters cannot substitute for the capability header", async () => {
    const t = fixture();
    expect((await t.fetch(`/api/dev/e2e-user?secret=${secret}`, { method: "POST", body: JSON.stringify({ ...body, secret }) })).status).toBe(404);
    await noUsers(t);
  });

  test.each(["anonymous", "local-aws"])("%s permits authorized local fixture creation, never account reuse", async runtime => {
    vi.stubEnv("DEV_FIXTURE_RUNTIME", runtime);
    if (runtime === "local-aws") {
      vi.stubEnv("SITE_URL", "http://web.app.localhost:8080,http://admin.app.localhost:8080");
      vi.stubEnv("CONVEX_CLOUD_URL", "http://convex.localhost.floci.io:3310");
      vi.stubEnv("CONVEX_SITE_URL", "http://convex.localhost.floci.io:3311");
    }
    const t = fixture();
    const response = await post(t);
    expect(await response.json()).toEqual({ ok: true, email });
    expect(response.status).toBe(200);
    const user = await t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] });
    expect(user).toMatchObject({ email, emailVerified: true, role: "admin" });
    expect((await post(t, secret, { ...body, isAdmin: false })).status).toBe(400);
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] })).toMatchObject({ _id: user!._id, role: "admin" });
    expect((await t.fetch("/api/dev/totp-code", { headers: { [FIXTURE_HEADER]: secret } })).status).toBe(200);
  });

  test("authorized malformed bodies are rejected without creating accounts", async () => {
    const t = fixture();
    for (const data of [null, [], { ...body, email: "real@example.test" }, { ...body, password: "short" }]) expect((await post(t, secret, data)).status).toBe(400);
    await noUsers(t);
  });

  test("internal seed and invitation mutators also fail closed on a hosted backend", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", "https://hosted.convex.cloud");
    const t = fixture();
    await expect(t.action(internal.platform.devSeed.seed, {})).rejects.toThrow("DEV_SEED_NOT_LOCAL");
    await expect(t.mutation(internal.platform.devSeed.setupDevUser, { email, isAdmin: true })).rejects.toThrow("DEV_SEED_NOT_LOCAL");
    await expect(t.mutation(internal.platform.devSeed.finalizeDevToken, { email })).rejects.toThrow("DEV_SEED_NOT_LOCAL");
    await expect(t.mutation(internal.platform.devSeed.markSeeded, {})).rejects.toThrow("DEV_SEED_NOT_LOCAL");
    await expect(t.mutation(internal.platform.adminInvitations.createForSeed, { email })).rejects.toThrow("DEV_SEED_NOT_LOCAL");
    await expect(t.mutation(internal.platform.e2eFixtures.prepareE2eInvitation, { email, isAdmin: true })).rejects.toThrow("DEV_SEED_NOT_LOCAL");
    await expect(t.mutation(internal.platform.e2eFixtures.finalizeE2eInvitation, { email })).rejects.toThrow("DEV_SEED_NOT_LOCAL");
    await noUsers(t);
  });
});
