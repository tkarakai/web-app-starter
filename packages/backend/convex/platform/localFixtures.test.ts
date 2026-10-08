import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestEnv } from "../test.modules";
import { components, internal } from "../_generated/api";
import schema from "./betterAuth/schema";
import { FIXTURE_HEADER } from "./localFixtures";
import { createAuthOptions } from "./auth";

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
    expect(user?.customerAdmission).toBeNull();
    expect(await t.query(components.betterAuth.adapter.findMany, { model: "organization", paginationOpts: { cursor: null, numItems: 10 } })).toMatchObject({ page: [] });
    expect((await post(t, secret, { ...body, isAdmin: false })).status).toBe(400);
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] })).toMatchObject({ _id: user!._id, role: "admin" });
    expect((await t.fetch("/api/dev/totp-code", { headers: { [FIXTURE_HEADER]: secret } })).status).toBe(200);
  });

  test("authorized malformed bodies are rejected without creating accounts", async () => {
    const t = fixture();
    for (const data of [null, [], { ...body, email: "real@example.test" }, { ...body, password: "short" }, { ...body, password: "aaaaaaaaaaaa" }]) expect((await post(t, secret, data)).status).toBe(400);
    await noUsers(t);
  });

  test("a breached-password service outage cannot prevent local fixture creation", async () => {
    const network = vi.fn(async () => new Response("Upstream unavailable", { status: 502 }));
    vi.stubGlobal("fetch", network);
    const t = fixture();
    const response = await post(t);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, email });
    expect(network).not.toHaveBeenCalled();
    const user = await t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] });
    const account = await t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "userId", value: user!._id }] });
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toBe(body.password);
  });

  test("ordinary signup still checks breached passwords, even for a fixture address", async () => {
    const requestedUrls: string[] = [];
    const network = vi.fn(async (input: string) => { requestedUrls.push(String(input)); return new Response("Upstream unavailable", { status: 502 }); });
    vi.stubGlobal("fetch", network);
    const t = fixture();
    await t.mutation(internal.platform.e2eFixtures.prepareE2eInvitation, { email, isAdmin: false });
    const response = await t.fetch("/api/auth/sign-up/email", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ email, password: body.password, name: "Ordinary signup" }),
    });
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Failed to check password");
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toMatch(/^https:\/\/api\.pwnedpasswords\.com\/range\//);
    await noUsers(t);
  });

  test("development seed separates operator signup from personal customer provisioning", async () => {
    const t = fixture();
    await t.action(internal.platform.devSeed.seed, {});
    const admin = await t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: "admin@admin.com" }] });
    const customer = await t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: "user@user.com" }] });
    expect(admin).toMatchObject({ role: "admin", customerAdmission: null });
    expect(customer).toMatchObject({ role: "user", customerAdmission: "customer-invitation" });
    const organizations = await t.query(components.betterAuth.adapter.findMany, { model: "organization", paginationOpts: { cursor: null, numItems: 10 } });
    expect(organizations.page).toMatchObject([{ personalOwnerId: customer!._id, experience: "personal" }]);
    await t.action(internal.platform.devSeed.seed, {});
    expect(await t.query(components.betterAuth.adapter.findMany, { model: "organization", paginationOpts: { cursor: null, numItems: 10 } })).toEqual(organizations);
  });

  test("local operator signup option is rejected on hosted backends", () => {
    vi.stubEnv("CONVEX_CLOUD_URL", "https://hosted.convex.cloud");
    expect(() => createAuthOptions({} as never, { localOperatorSignup: true })).toThrow("DEV_SEED_NOT_LOCAL");
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
