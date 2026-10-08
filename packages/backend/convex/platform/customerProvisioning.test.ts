import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import schema from "./betterAuth/schema";

vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
const password = "orchid quartz lantern telescope meadow violin glacier";
const organizations = components.betterAuth.organizations;

beforeEach(() => {
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.stubEnv("BETTER_AUTH_SECRET", "customer-provisioning-test-secret-at-least-32-characters");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("00000000000000000000000000000000000:0")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", schema, import.meta.glob("./betterAuth/**/*.*s"));
  async function post(path: string, body: Record<string, unknown>) {
    return t.fetch(`/api/auth/${path}`, { method: "POST", headers: { "content-type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify(body) });
  }
  async function user(email: string, customerAdmission?: string, role = "user") {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      email, name: "Customer", role, emailVerified: true, createdAt: now, updatedAt: now, ...(customerAdmission ? { customerAdmission } : {}),
    } } });
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
      userId: user._id, accountId: user._id, providerId: "credential", password: await hashPassword(password), createdAt: now, updatedAt: now,
    } } });
    return user;
  }
  async function rows(model: "organization" | "member") {
    return (await t.query(components.betterAuth.adapter.findMany, { model, paginationOpts: { cursor: null, numItems: 100 } })).page;
  }
  return { t, post, user, rows };
}

describe("durable new-customer admission and personal provisioning", () => {
  test("public signup creates one invisible organization; session recreation cannot duplicate it or select client intent", async () => {
    const f = fixture();
    await f.t.mutation(components.platform.appSettings.putRaw, { key: "onboardingType", value: JSON.stringify("publicSignup"), updatedBy: "fixture" });
    const email = "public@example.test";
    const forged = await f.post("sign-up/email", { email, name: "Customer", password, customerAdmission: "member-invitation" });
    expect(forged.status).toBe(400);
    expect(await f.rows("organization")).toEqual([]);
    const response = await f.post("sign-up/email", { email, name: "Customer", password });
    expect(response.status, await response.clone().text()).toBe(200);
    const output = await response.json();
    expect(output.user).not.toHaveProperty("customerAdmission");
    const user = await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] });
    expect(user).toMatchObject({ role: "user", customerAdmission: "public-signup" });
    const first = await f.rows("organization");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ personalOwnerId: user!._id, experience: "personal", lifecycle: "active" });
    expect(await f.rows("member")).toMatchObject([{ userId: user!._id, organizationId: first[0]._id, role: "org-admin" }]);
    expect((await f.post("sign-in/email", { email, password })).status).toBe(200);
    expect(await f.rows("organization")).toEqual(first);
    expect(await f.rows("member")).toHaveLength(1);
  });

  test("customer invitation authorizes personal provisioning in invite-only mode, not organization membership", async () => {
    const f = fixture();
    const email = "invited@example.test";
    await f.t.mutation(components.platform.appSettings.putRaw, { key: "onboardingType", value: JSON.stringify("inviteOnly"), updatedBy: "fixture" });
    const { deliveries: [invited] } = await f.t.mutation(components.platform.waitlist.inviteMany, { emails: [email], identity: { userId: "fixture", actor: "fixture" } });
    await f.t.mutation(components.platform.waitlistTokens.create, { email, waitlistEntryId: invited.entryId, tokenHash: "fixture-token-hash", expiresAt: Date.now() + 60_000 });
    expect((await f.post("sign-up/email", { email, name: "Customer", password })).status).toBe(200);
    const user = await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] });
    expect(user?.customerAdmission).toBe("customer-invitation");
    expect(await f.rows("organization")).toHaveLength(1);
    expect(await f.rows("member")).toHaveLength(1);
  });

  test("client intent cannot authorize signup when admission is closed", async () => {
    const f = fixture();
    await f.t.mutation(components.platform.appSettings.putRaw, { key: "onboardingType", value: JSON.stringify("inviteOnly"), updatedBy: "fixture" });
    expect((await f.post("sign-up/email", { email: "denied@example.test", name: "Customer", password, customerAdmission: "public-signup" })).status).not.toBe(200);
    expect(await f.rows("organization")).toEqual([]);
    expect(await f.rows("member")).toEqual([]);
  });

  test("a session retries persisted admission after interrupted account creation, even if admission has since closed", async () => {
    const f = fixture();
    // Models an account committed before its provisioning after-hook ran. No migration guess.
    const user = await f.user("interrupted@example.test", "public-signup");
    await f.t.mutation(components.platform.appSettings.putRaw, { key: "onboardingType", value: JSON.stringify("inviteOnly"), updatedBy: "fixture" });
    expect(await f.rows("organization")).toEqual([]);
    expect((await f.post("sign-in/email", { email: user.email, password })).status).toBe(200);
    const first = await f.rows("organization");
    expect(first).toHaveLength(1);
    await Promise.all([
      f.t.mutation(organizations.resumeCustomerProvisioning, { userId: user._id }),
      f.t.mutation(organizations.resumeCustomerProvisioning, { userId: user._id }),
    ]);
    expect(await f.rows("organization")).toEqual(first);
    expect(await f.rows("member")).toHaveLength(1);
  });

  test.each(["legacy", "member", "operator"])("%s identity without customer admission never provisions at sign-in", async kind => {
    const f = fixture();
    const user = await f.user(`${kind}@example.test`, undefined, kind === "operator" ? "admin" : "user");
    if (kind === "member") {
      const owner = await f.user("owner@example.test", "public-signup");
      const org = await f.t.mutation(organizations.resumeCustomerProvisioning, { userId: owner._id });
      await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: { organizationId: org!.organizationId, userId: user._id, role: "member", createdAt: Date.now() } } });
    }
    const before = await f.rows("organization");
    expect((await f.post("sign-in/email", { email: user.email, password, customerAdmission: "public-signup" })).status).toBe(200);
    expect(await f.rows("organization")).toEqual(before);
    expect(await f.t.mutation(organizations.resumeCustomerProvisioning, { userId: user._id })).toBeNull();
  });

  test("unknown intent fails closed and stale operator intent never provisions", async () => {
    const f = fixture();
    const unknown = await f.user("unknown@example.test", "unknown-intent");
    const operator = await f.user("operator@example.test", "public-signup", "admin");
    await expect(f.t.mutation(organizations.resumeCustomerProvisioning, { userId: unknown._id })).rejects.toThrow("INVALID_CUSTOMER_ADMISSION");
    expect(await f.t.mutation(organizations.resumeCustomerProvisioning, { userId: operator._id })).toBeNull();
    expect((await f.post("sign-in/email", { email: operator.email, password })).status).toBe(200);
    expect(await f.rows("organization")).toEqual([]);
  });
});
