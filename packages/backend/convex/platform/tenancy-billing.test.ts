// Tenancy modes, plans, billing organizations and user deletion (platform/docs/tenancy-and-billing.md).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { organizationFixture } from "./organizations.test-helpers";
import { sendAuthEmail } from "./sendAuthEmail";

vi.mock("./sendAuthEmail", async (original) => ({
  ...await original<typeof import("./sendAuthEmail")>(),
  sendAuthEmail: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "tenancy-billing-test-secret-at-least-32-characters");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.mocked(sendAuthEmail).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function fixture(mode?: "individuals" | "organizations") {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  const setMode = (value: "individuals" | "organizations") =>
    t.mutation(components.platform.appSettings.putRaw, { key: "tenancyMode", value, updatedBy: "test" });
  if (mode) await setMode(mode);
  const plans = () => boss.caller.query(api.platform.billing.listPlans, {});
  /** A paid plan beside the seeded free one; active unless told otherwise. */
  const paidPlan = async (name = "Pro", priceMonthlyUsdCents = 1_900) =>
    await boss.caller.mutation(api.platform.billing.createPlan, { name, priceMonthlyUsdCents, isFreeForever: false });
  const current = (organizationId: string) => t.query(components.platform.billing.currentPlan, { organizationId });
  const post = (path: string, body: unknown, who: string) => t.fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: `Bearer ${who}-session` },
    body: JSON.stringify(body),
  });
  return { ...f, boss, setMode, plans, paidPlan, current, post };
}

describe("plans", () => {
  test("the seeded free-forever plan only changes status; a plan in use keeps its price; the default stays active", async () => {
    const f = await fixture("organizations");
    await f.boss.caller.mutation(api.platform.billing.ensureSeeded, {});
    const [free] = await f.plans();
    expect(free).toMatchObject({ name: "Free", isFreeForever: true, isSeeded: true, isDefault: true, status: "active", priceMonthlyUsdCents: 0 });
    await expect(f.boss.caller.mutation(api.platform.billing.updatePlan, { planId: free!.id, name: "Gratis" })).rejects.toThrow("SEEDED_PLAN_LOCKED");
    await expect(f.boss.caller.mutation(api.platform.billing.updatePlan, { planId: free!.id, status: "inactive" })).rejects.toThrow("DEFAULT_PLAN_MUST_BE_ACTIVE");

    const pro = await f.paidPlan();
    await expect(f.boss.caller.mutation(api.platform.billing.createPlan, { name: "Odd", priceMonthlyUsdCents: 9.5, isFreeForever: false })).rejects.toThrow("INVALID_PRICE");
    await expect(f.boss.caller.mutation(api.platform.billing.createPlan, { name: "Odd", priceMonthlyUsdCents: 100, isFreeForever: true })).rejects.toThrow("FREE_FOREVER_PRICE_MUST_BE_ZERO");
    await f.boss.caller.mutation(api.platform.billing.updatePlan, { planId: pro, priceMonthlyUsdCents: 2_900 });

    // Once an organization uses the plan, its price is fixed.
    const alice = await f.user("alice");
    const acme = await alice.provision();
    await f.t.mutation(components.platform.billing.createBilling, { organizationId: acme, organizationName: "Acme", paymentMethod: "cash", actor: { email: "test" } });
    const billing = (await f.t.query(components.platform.billing.billingByOrganization, { organizationId: acme }))!;
    await f.t.mutation(components.platform.billing.startPlan, { organizationId: acme, organizationName: "Acme", planId: pro, billingOrganizationId: billing._id, actor: { email: "test" } });
    await expect(f.boss.caller.mutation(api.platform.billing.updatePlan, { planId: pro, priceMonthlyUsdCents: 3_900 })).rejects.toThrow("PLAN_IN_USE");

    await f.boss.caller.mutation(api.platform.billing.setDefaultPlan, { planId: pro });
    expect((await f.plans()).filter((plan) => plan.isDefault).map((plan) => plan.id)).toEqual([pro]);
    // Non-admins don't manage plans.
    await expect(alice.caller.mutation(api.platform.billing.createPlan, { name: "Mine", priceMonthlyUsdCents: 0, isFreeForever: true })).rejects.toThrow("NOT_ADMIN");
  });

  test("a paid plan needs a payer with a payment method", async () => {
    const f = await fixture("organizations");
    const pro = await f.paidPlan();
    const alice = await f.user("alice");
    const acme = await alice.provision();
    await expect(f.t.mutation(components.platform.billing.startPlan, { organizationId: acme, organizationName: "Acme", planId: pro, actor: { email: "test" } })).rejects.toThrow("PAYER_REQUIRED");
    const billingId = await f.t.mutation(components.platform.billing.createBilling, { organizationId: acme, organizationName: "Acme", actor: { email: "test" } });
    await expect(f.t.mutation(components.platform.billing.startPlan, { organizationId: acme, organizationName: "Acme", planId: pro, billingOrganizationId: billingId, actor: { email: "test" } })).rejects.toThrow("PAYMENT_METHOD_REQUIRED");
  });
});

describe("signing up", () => {
  test("nobody signs up before a tenancy mode is chosen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const f = await fixture();
    await f.t.mutation(components.platform.appSettings.putRaw, { key: "onboardingType", value: JSON.stringify("publicSignup"), updatedBy: "test" });
    const signUp = () => f.t.fetch("/api/auth/sign-up/email", {
      method: "POST", headers: { origin: "http://localhost:3001", "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.test", password: "a-Long-and-Unusual-passphrase-42", name: "New" }),
    });
    const refused = await signUp();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "TENANCY_NOT_CONFIGURED" });

    await f.setMode("organizations");
    const ok = await signUp();
    expect(ok.status, await ok.clone().text()).toBe(200);
    const user = await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: "new@example.test" }] });
    const [membership] = (await f.t.query(components.betterAuth.adapter.findMany, { model: "member", where: [{ field: "userId", value: user!._id }], paginationOpts: { numItems: 10, cursor: null } })).page as { organizationId: string }[];
    expect((await f.current(membership!.organizationId))?.plan).toMatchObject({ isSeeded: true });
  });

  test("with plans to choose, the app waits for the picker; a paid plan creates the user's billing organization", async () => {
    const f = await fixture("organizations");
    const pro = await f.paidPlan();
    const alice = await f.user("alice");
    const acme = await alice.provision();
    expect(await alice.caller.query(api.platform.billing.myStatus, {})).toMatchObject({ mode: "organizations", planChoice: { organizationId: acme } });
    // Organization-scoped functions stay closed until a plan is picked.
    expect(await alice.caller.query(api.platform.organizations.active, {})).toBeNull();
    await expect(alice.caller.mutation(api.platform.organizations.deleteInvitation, { invitationId: "x" })).rejects.toThrow("PLAN_CHOICE_REQUIRED");

    await expect(alice.caller.mutation(api.platform.billing.choosePlan, { planId: pro })).rejects.toThrow("PAYMENT_METHOD_REQUIRED");
    await expect(alice.caller.mutation(api.platform.billing.choosePlan, { planId: pro, paymentMethod: "check" })).rejects.toThrow("ORGANIZATION_NAME_REQUIRED");
    await alice.caller.mutation(api.platform.billing.choosePlan, { planId: pro, paymentMethod: "check", billingOrganizationName: "Alice billing" });

    const now = (await f.current(acme))!;
    expect(now.plan._id).toBe(pro);
    expect(now.billing).toMatchObject({ organizationName: "Alice billing", paymentMethod: "check" });
    expect(now.billing!.organizationId).not.toBe(acme);
    expect((await alice.caller.query(api.platform.organizations.mine, {}))!.organizations.map((o) => [o.name, o.role]).sort())
      .toEqual([["Alice billing", "owner"], ["alice", "owner"]]);
    expect(await alice.caller.query(api.platform.billing.myStatus, {})).toMatchObject({ planChoice: null });
    expect(await alice.caller.query(api.platform.organizations.active, {})).not.toBeNull();
  });

  test("individuals: the user's organization is their billing organization", async () => {
    const f = await fixture("individuals");
    const pro = await f.paidPlan();
    const alice = await f.user("alice");
    const own = await alice.provision();
    const start = (await f.current(own))!;
    expect(start.billing?.organizationId).toBe(own);
    await alice.caller.mutation(api.platform.billing.choosePlan, { planId: pro, paymentMethod: "cash" });
    expect((await f.current(own))!).toMatchObject({ plan: { _id: pro }, billing: { organizationId: own, paymentMethod: "cash" } });
    expect((await alice.caller.query(api.platform.organizations.mine, {}))!.organizations).toHaveLength(1);

    // A downgrade keeps the individual's own billing organization as payer.
    const free = (await f.plans()).find((plan) => plan.isSeeded)!;
    await alice.caller.mutation(api.platform.billing.changePlan, { organizationId: own, planId: free.id });
    expect((await f.current(own))!).toMatchObject({ plan: { _id: free.id }, billing: { organizationId: own } });

    // No membership changes for individuals.
    const invite = await f.post("/organization/invite-member", { organizationId: own, email: "bob@example.test", role: "member" }, "alice");
    expect(invite.status).toBe(403);
    expect(await invite.json()).toMatchObject({ code: "NOT_AVAILABLE_FOR_INDIVIDUALS" });
    const remove = await f.post("/organization/delete", { organizationId: own }, "alice");
    expect(await remove.json()).toMatchObject({ code: "NOT_AVAILABLE_FOR_INDIVIDUALS" });
  });

  test("organizations: someone invited into an organization gets no personal organization", async () => {
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    const acme = await alice.provision();
    await f.invite(acme, "bob@example.test", alice.userId);
    const bob = await f.user("bob");
    expect(await bob.provision()).toBeNull();
    expect((await bob.caller.query(api.platform.organizations.mine, {}))!.organizations).toEqual([]);
  });

  test("platform administrators get no organization", async () => {
    const f = await fixture("organizations");
    expect(await f.t.mutation(internal.platform.organizations.provisionPersonal, { userId: f.boss.userId })).toBeNull();
  });
});

describe("billing organizations", () => {
  async function paying() {
    const f = await fixture("organizations");
    const pro = await f.paidPlan();
    const alice = await f.user("alice");
    const personal = await alice.provision();
    await alice.caller.mutation(api.platform.billing.choosePlan, { planId: pro, paymentMethod: "cash", billingOrganizationName: "Acme billing" });
    const billing = (await f.current(personal))!.billing!;
    return { ...f, pro, alice, personal, billing };
  }

  test("only a billing organization's owners and admins create organizations it pays for; members view", async () => {
    const f = await paying();
    const bob = await f.user("bob");
    await bob.provision();
    await f.addMember(f.billing.organizationId, bob.userId, "member");
    await expect(bob.caller.mutation(api.platform.billing.createOrganization, { billingOrganizationId: f.billing._id, name: "Team", planId: f.pro })).rejects.toThrow("NOT_ALLOWED");
    await expect(bob.caller.mutation(api.platform.billing.setPaymentMethod, { billingOrganizationId: f.billing._id, paymentMethod: "check" })).rejects.toThrow("NOT_ALLOWED");

    const { organizationId } = await f.alice.caller.mutation(api.platform.billing.createOrganization, { billingOrganizationId: f.billing._id, name: "Team", planId: f.pro });
    expect((await f.current(organizationId))!).toMatchObject({ plan: { _id: f.pro }, billing: { _id: f.billing._id } });
    expect((await f.members(organizationId)).map((m) => [m.userId, m.role])).toEqual([[f.alice.userId, "owner"]]);

    // Members of the billing organization see what it pays for.
    await bob.switchTo(f.billing.organizationId);
    const view = (await bob.caller.query(api.platform.billing.overview, {}))!;
    expect(view.billing).toMatchObject({ canManage: false, paymentMethod: "cash" });
    expect(view.billing!.organizations.map((o) => o.name).sort()).toEqual(["Team", "alice"]);
  });

  test("the payer's owners and admins change plans; a downgrade clears the payer; an upgrade picks or creates one", async () => {
    const f = await paying();
    const free = (await f.plans()).find((plan) => plan.isSeeded)!;
    const bob = await f.user("bob");
    await f.addMember(f.personal, bob.userId, "admin");
    // Bob administers the organization but not its payer.
    await expect(bob.caller.mutation(api.platform.billing.changePlan, { organizationId: f.personal, planId: free.id })).rejects.toThrow("BILLING_ORGANIZATION_NOT_FOUND");

    await f.alice.caller.mutation(api.platform.billing.changePlan, { organizationId: f.personal, planId: free.id });
    expect((await f.current(f.personal))!).toMatchObject({ plan: { _id: free.id }, billing: null });
    // History: every change starts a new row and ends the previous one.
    const rows = await f.t.query(components.platform.billing.paidBy, { billingOrganizationId: f.billing._id });
    expect(rows).toEqual([]);

    // Without a payer, the organization's owners and admins upgrade with a billing organization they manage.
    await expect(bob.caller.mutation(api.platform.billing.upgrade, { organizationId: f.personal, planId: f.pro, billingOrganizationId: f.billing._id })).rejects.toThrow("BILLING_ORGANIZATION_NOT_FOUND");
    await bob.caller.mutation(api.platform.billing.upgrade, { organizationId: f.personal, planId: f.pro, newBillingOrganizationName: "Bob pays", paymentMethod: "check" });
    expect((await f.current(f.personal))!.billing).toMatchObject({ organizationName: "Bob pays", paymentMethod: "check" });
    await expect(f.alice.caller.mutation(api.platform.billing.upgrade, { organizationId: f.personal, planId: f.pro, billingOrganizationId: f.billing._id })).rejects.toThrow("ORGANIZATION_HAS_PAYER");
  });

  test("a billing organization paying for others can't be deleted, nor its last member or owner", async () => {
    const f = await paying();
    await f.alice.switchTo(f.billing.organizationId);
    const deleted = await f.post("/organization/delete", { organizationId: f.billing.organizationId }, "alice");
    expect(deleted.status).toBe(409);
    expect(await deleted.json()).toMatchObject({ code: "BILLING_ORGANIZATION_IN_USE" });

    expect(await f.t.query(internal.platform.userDeletion.blockerFor, { userId: f.alice.userId })).toMatchObject({ code: "BILLING_ORGANIZATION_IN_USE" });
    await expect(f.alice.caller.mutation(api.platform.userDeletion.request, {})).rejects.toThrow("BILLING_ORGANIZATION_IN_USE");
    const bob = await f.user("bob");
    await f.addMember(f.billing.organizationId, bob.userId, "member");
    expect(await f.t.query(internal.platform.userDeletion.blockerFor, { userId: f.alice.userId })).toMatchObject({ code: "BILLING_OWNER_REQUIRED" });
  });
});

describe("turning on a tenancy mode", () => {
  test("needs another plan and a free-forever default; organizations creates a billing and a shared organization", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    await alice.provision();
    await bob.provision();
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "organizations" })).rejects.toThrow("TENANCY_PLANS_REQUIRED");
    await f.paidPlan();
    const status = (await f.boss.caller.query(api.platform.tenancy.status, {}))!;
    expect(status.eligibility).toMatchObject({ individualsAllowed: true, sharedStep: true, appUserCount: 2, plans: { ready: true } });
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "organizations" })).rejects.toThrow("TENANCY_USER_REQUIRED");

    await f.boss.caller.mutation(api.platform.tenancy.configure, {
      mode: "organizations", billingUserId: alice.userId, adminUserId: bob.userId, billingOrganizationName: "Payer", sharedOrganizationName: "Everyone",
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(api.platform.tenancy.mode, {})).toEqual({ mode: "organizations" });
    const names = (await alice.caller.query(api.platform.organizations.mine, {}))!.organizations.map((o) => [o.name, o.role]).sort();
    expect(names).toEqual([["Everyone", "member"], ["Payer", "owner"], ["alice", "owner"]]);
    expect((await bob.caller.query(api.platform.organizations.mine, {}))!.organizations.map((o) => [o.name, o.role]).sort())
      .toEqual([["Everyone", "owner"], ["bob", "owner"]]);
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "individuals" })).rejects.toThrow("TENANCY_ALREADY_CONFIGURED");
  });

  test("individuals needs one member per organization; turning it on makes every organization its own payer", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const own = await alice.provision();
    await bob.provision();
    await f.paidPlan();
    await f.addMember(own, bob.userId, "member");
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "individuals" })).rejects.toThrow("TENANCY_INDIVIDUALS_NOT_ALLOWED");
    const [bobMembership] = (await f.members(own)).filter((m) => m.userId === bob.userId);
    await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "member", where: [{ field: "_id", value: bobMembership!._id }] } });

    await f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "individuals" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await f.current(own))!.billing?.organizationId).toBe(own);
  });
});

describe("deleting your user", () => {
  test("a request signs you out, waits the grace period and can be cancelled; then the user goes", async () => {
    vi.useFakeTimers();
    const f = await fixture("organizations");
    await f.t.mutation(components.platform.appSettings.putRaw, { key: "userDeletionGraceDays", value: "3", updatedBy: "test" });
    const alice = await f.user("alice");
    const own = await alice.provision();

    const { deleteAt } = await alice.caller.mutation(api.platform.userDeletion.request, {});
    expect(deleteAt - Date.now()).toBe(3 * 24 * 60 * 60 * 1000);
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "userId", value: alice.userId }] })).toBeNull();
    expect((await f.boss.caller.query(api.platform.userDeletion.list, {}))).toMatchObject([{ userId: alice.userId, state: "scheduled" }]);

    // Signing in again: the app is closed until the user cancels or lets it run.
    await f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: alice.userId });
    expect(await f.boss.caller.query(api.platform.userDeletion.list, {})).toEqual([]);

    // Schedule again (a new session is recent) and let the grace period pass.
    const session = await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "session", data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: Date.now(), primaryVerifiedAt: Date.now(), userId: alice.userId, token: "alice-again", createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 3600_000 } },
    });
    const back = f.t.withIdentity({ subject: alice.userId, sessionId: session._id });
    await back.mutation(api.platform.userDeletion.request, {});
    expect(await back.query(api.platform.billing.myStatus, {})).toBeNull(); // signed out
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: alice.userId }] })).toBeNull();
    expect(await f.organization(own)).toBeNull();
    // Billing history stays: the organization's plan row is ended, not deleted.
    expect(await f.current(own)).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.query("userDeletions").collect())).toEqual([]);
  });

  test("a stale session must sign in again first", async () => {
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    await alice.provision();
    const earlier = Date.now() - 60 * 60_000;
    await f.t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "session", where: [{ field: "_id", value: alice.sessionId }], update: { authenticatedAt: earlier, primaryVerifiedAt: earlier } },
    });
    await expect(alice.caller.mutation(api.platform.userDeletion.request, {})).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
  });
});
