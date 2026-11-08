// Tenancy modes, plans, billing organizations and user deletion (platform/docs/tenancy-and-billing.md).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { organizationFixture } from "./organizations.test-helpers";
import { createOrganizationWithOwner } from "./organizationAccess";
import { deleteMember, setMemberRole } from "./organizationOwnership";
import { sendAuthEmail } from "./sendAuthEmail";

vi.mock("./sendAuthEmail", async (original) => ({
  ...await original<typeof import("./sendAuthEmail")>(),
  sendAuthEmail: vi.fn(),
}));

const cleanupMock = vi.hoisted(() => ({ failures: 0, owners: [] as string[] }));
vi.mock("../userData", async () => {
  const { internalMutation } = await import("../_generated/server");
  const { v } = await import("convex/values");
  return { deleteUserData: internalMutation({
    args: { userId: v.string(), ownerId: v.string() },
    handler: async (_ctx, args) => {
      cleanupMock.owners.push(args.ownerId);
      if (args.ownerId === "legacy-cleanup-owner" && cleanupMock.failures > 0) { cleanupMock.failures--; throw new Error("App cleanup unavailable"); }
    },
  }) };
});

beforeEach(() => {
  cleanupMock.failures = 0;
  cleanupMock.owners = [];
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
  /** Run a tenancy eligibility check to its end, its batches directly (a scheduled repeat of one does nothing). */
  const checked = async () => {
    await boss.caller.mutation(api.platform.tenancy.check, {});
    for (;;) {
      const row = await t.run((ctx) => ctx.db.query("tenancyChecks").order("desc").first());
      if (!row || row.state !== "running") return row;
      await t.mutation(internal.platform.tenancy.advanceCheck, { runId: row.runId, batch: row.batches });
    }
  };
  return { ...f, boss, setMode, plans, paidPlan, current, post, checked };
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
    await alice.switchTo(now.billing!.organizationId);
    expect(await alice.caller.query(api.platform.billing.overview, {})).toMatchObject({ plan: null, billing: { id: now.billing!._id, canManage: true } });
    const created = await alice.caller.mutation(api.platform.billing.createOrganization, { billingOrganizationId: now.billing!._id, name: "Second workspace", planId: pro });
    expect(await f.current(created.organizationId)).toMatchObject({ plan: { _id: pro }, billing: { _id: now.billing!._id } });
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
    const paid = await bob.caller.query(api.platform.billing.paidOrganizations, { paginationOpts: { numItems: 1, cursor: null } });
    expect(paid.page).toHaveLength(1);
    const rest = await bob.caller.query(api.platform.billing.paidOrganizations, { paginationOpts: { numItems: 50, cursor: paid.continueCursor } });
    expect([...paid.page, ...rest.page].map((o) => o.name).sort()).toEqual(["Team", "alice"]);
    expect(rest.isDone).toBe(true);
    await expect(bob.caller.query(api.platform.billing.paidOrganizations, { paginationOpts: { numItems: 51, cursor: null } })).rejects.toThrow("INVALID_PAGE_SIZE");
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
    const rows = (await f.t.query(components.platform.billing.paidBy, { billingOrganizationId: f.billing._id, paginationOpts: { numItems: 100, cursor: null } })).page;
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
  test("a default that is not free forever still blocks setup", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const paid = await f.paidPlan();
    await f.boss.caller.mutation(api.platform.billing.setDefaultPlan, { planId: paid });
    await f.checked();
    expect((await f.boss.caller.query(api.platform.tenancy.status, {}))!.eligibility?.plans.ready).toBe(false);
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "individuals" })).rejects.toThrow("TENANCY_PLANS_REQUIRED");
  });

  test("the seeded plan is sufficient; organizations creates a billing and a shared organization", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    await alice.provision();
    await bob.provision();
    expect(await f.plans()).toHaveLength(1);
    await f.checked();
    const status = (await f.boss.caller.query(api.platform.tenancy.status, {}))!;
    expect(status.eligibility).toMatchObject({ individualsAllowed: true, sharedStep: true, appUserCount: 2, plans: { ready: true } });
    await f.checked();
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "organizations" })).rejects.toThrow("TENANCY_USER_REQUIRED");

    await f.checked();
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
    expect(await f.plans()).toHaveLength(1);
    await f.addMember(own, bob.userId, "member");
    await f.checked();
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "individuals" })).rejects.toThrow("TENANCY_INDIVIDUALS_NOT_ALLOWED");
    const [bobMembership] = (await f.members(own)).filter((m) => m.userId === bob.userId);
    await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "member", where: [{ field: "_id", value: bobMembership!._id }] } });

    await f.checked();
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
    await alice.caller.mutation(api.platform.userProfiles.upsert, { timezone: "Europe/Budapest" });
    await f.t.run(ctx => ctx.db.insert("pendingPlanChoices", { userId: alice.userId, organizationId: own, createdAt: Date.now() }));

    const { deleteAt } = await alice.caller.mutation(api.platform.userDeletion.request, {});
    // convex-test pins the mutation's clock at or after the last commit, so it can run 1ms ahead.
    expect(deleteAt - Date.now()).toBeGreaterThanOrEqual(3 * 24 * 60 * 60 * 1000);
    expect(deleteAt - Date.now()).toBeLessThan(3 * 24 * 60 * 60 * 1000 + 1000);
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "userId", value: alice.userId }] })).toBeNull();
    expect((await f.boss.caller.query(api.platform.userDeletion.list, {}))).toMatchObject({ rows: [{ userId: alice.userId, state: "scheduled" }], more: false });

    // Signing in again: the app is closed until the user cancels or lets it run.
    await f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: alice.userId });
    expect(await f.boss.caller.query(api.platform.userDeletion.list, {})).toEqual({ rows: [], more: false });

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
    expect(await f.t.run(ctx => ctx.db.query("userProfiles").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("pendingPlanChoices").collect())).toEqual([]);
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

describe("review regressions", () => {
  test.each(["individuals", "organizations"] as const)("%s: a sole paid plan still requires payment onboarding", async mode => {
    const f = await fixture(mode);
    await f.boss.caller.mutation(api.platform.billing.ensureSeeded, {});
    const free = (await f.plans()).find(p => p.isSeeded)!;
    const pro = await f.paidPlan();
    await f.boss.caller.mutation(api.platform.billing.setDefaultPlan, { planId: pro });
    await f.boss.caller.mutation(api.platform.billing.updatePlan, { planId: free.id, status: "inactive" });
    const alice = await f.user("alice");
    await alice.provision();
    expect(await alice.caller.query(api.platform.billing.myStatus, {})).toMatchObject({ planChoice: { plans: [{ id: pro }] } });
    expect(await alice.caller.query(api.platform.organizations.active, {})).toBeNull();
    await expect(alice.caller.mutation(api.platform.billing.choosePlan, { planId: pro })).rejects.toThrow("PAYMENT_METHOD_REQUIRED");
  });

  test.each(["removed", "demoted", "payer"])("a pending choice grants no authority after being %s", async change => {
    const f = await fixture("organizations");
    const pro = await f.paidPlan();
    const alice = await f.user("alice");
    const own = await alice.provision();
    const bob = await f.user("bob");
    const bobOwn = await bob.provision();
    await f.addMember(own, bob.userId, "owner");
    const member = (await f.members(own)).find(m => m.userId === alice.userId)!;
    if (change === "removed") await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "member", where: [{ field: "_id", value: member._id }] } });
    if (change === "demoted") await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "member", where: [{ field: "_id", value: member._id }], update: { role: "member" } } });
    if (change === "payer") {
      const payerOrg = bobOwn;
      const billingOrganizationId = await f.t.mutation(components.platform.billing.createBilling, { organizationId: payerOrg, organizationName: "Bob", paymentMethod: "cash", actor: { email: "test" } });
      await f.t.mutation(components.platform.billing.startPlan, { organizationId: own, organizationName: "Alice", planId: pro, billingOrganizationId, actor: { email: "test" } });
    }
    const before = await f.current(own);
    expect(await alice.caller.query(api.platform.billing.myStatus, {})).toMatchObject({ planChoice: null });
    await expect(alice.caller.mutation(api.platform.billing.choosePlan, { planId: pro, paymentMethod: "cash", billingOrganizationName: "Unauthorized" })).rejects.toThrow("NO_PLAN_CHOICE");
    expect(await f.current(own)).toEqual(before);
  });

  test("a fresh session during deletion cannot write billing or use organization HTTP routes", async () => {
    vi.useFakeTimers();
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    const own = await alice.provision();
    const free = (await f.plans())[0]!;
    await alice.caller.mutation(api.platform.userDeletion.request, {});
    const session = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: Date.now(), primaryVerifiedAt: Date.now(), userId: alice.userId, token: "fresh-session", createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 3600000 } } });
    const back = f.t.withIdentity({ subject: alice.userId, sessionId: session._id });
    await expect(back.mutation(api.platform.billing.changePlan, { organizationId: own, planId: free.id })).rejects.toThrow("USER_DELETION_SCHEDULED");
    const response = await f.post("/organization/set-active", { organizationId: own }, "fresh");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "USER_DELETION_SCHEDULED" });
  });

  test("cleanup removes migrated profiles and pending choices even without a deletion request", async () => {
    const f = await fixture("organizations");
    await f.paidPlan();
    const alice = await f.user("alice", { userId: "legacy-owner" });
    await alice.provision();
    await alice.caller.mutation(api.platform.userProfiles.upsert, { timezone: "Europe/Budapest" });
    await f.t.mutation(internal.platform.userDeletion.forget, { userId: alice.userId, ownerId: "legacy-owner" });
    await f.t.mutation(internal.platform.userDeletion.forget, { userId: alice.userId, ownerId: "legacy-owner" });
    expect(await f.t.run(ctx => ctx.db.query("userProfiles").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("pendingPlanChoices").collect())).toEqual([]);
  });
});

test("organization creation enforces the 50-membership boundary and rolls back failed creates", async () => {
  const f = await fixture("organizations");
  const alice = await f.user("alice");
  const own = await alice.provision();
  const billingOrganizationId = await f.t.mutation(components.platform.billing.createBilling, { organizationId: own, organizationName: "Payer", actor: { email: "test" } });
  const free = (await f.plans())[0]!;
  const pro = await f.paidPlan();
  vi.useFakeTimers();
  for (let i = 1; i < 50; i++) {
    vi.setSystemTime(Date.now() + 60_000);
    await alice.caller.mutation(api.platform.billing.createOrganization, { billingOrganizationId, planId: free.id, name: `Org ${i}` });
  }
  const before = await alice.caller.query(api.platform.organizations.mine, {});
  expect(before!.organizations).toHaveLength(50);
  await expect(alice.caller.mutation(api.platform.billing.createOrganization, { billingOrganizationId, planId: free.id, name: "Too many" })).rejects.toThrow("MEMBERSHIP_LIMIT_REACHED");
  expect(await alice.caller.query(api.platform.organizations.mine, {})).toEqual(before);
  await expect(alice.caller.mutation(api.platform.billing.upgrade, { organizationId: own, planId: pro, newBillingOrganizationName: "Another payer", paymentMethod: "cash" })).rejects.toThrow("MEMBERSHIP_LIMIT_REACHED");
  expect(await alice.caller.query(api.platform.organizations.mine, {})).toEqual(before);
});

test("admin deletion removes a migrated user's profile and pending picker", async () => {
  vi.useFakeTimers();
  const f = await fixture("organizations");
  await f.paidPlan();
  const alice = await f.user("alice", { userId: "legacy-alice" });
  await alice.provision();
  await alice.caller.mutation(api.platform.userProfiles.upsert, { timezone: "Europe/Budapest" });
  const response = await f.post("/admin/remove-user", { userId: alice.userId }, "boss");
  expect(response.status).toBe(200);
  // Memberships go first, one organization per run of the cleanup job; then the user data.
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await f.t.run(ctx => ctx.db.query("userProfiles").collect())).toEqual([]);
  expect(await f.t.run(ctx => ctx.db.query("pendingPlanChoices").collect())).toEqual([]);
});

describe("second review regressions", () => {
  test("a successful cancellation invalidates a running job's request identity", async () => {
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    await alice.provision();
    await alice.caller.mutation(api.platform.userDeletion.request, {});
    const old = (await f.t.query(internal.platform.userDeletion.pending, { userId: alice.userId }))!;
    await f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: alice.userId });
    // This is the destructive action resuming after cancellation committed.
    await f.t.action(internal.platform.userDeletion.execute, { userId: alice.userId, requestId: old.requestId });
    expect(await f.t.query(internal.platform.userDeletion.userRow, { userId: alice.userId })).not.toBeNull();
    await f.t.run(ctx => ctx.db.insert("userDeletions", { userId: alice.userId, requestId: "replacement", requestedAt: Date.now(), deleteAt: Date.now(), jobId: old.jobId, state: "scheduled" }));
    await f.t.action(internal.platform.userDeletion.execute, { userId: alice.userId, requestId: old.requestId });
    expect(await f.t.query(internal.platform.userDeletion.pending, { userId: alice.userId })).toMatchObject({ requestId: "replacement", state: "scheduled" });
  });

  test("cancellation refuses once the atomic deletion claim has committed", async () => {
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    await alice.provision();
    await alice.caller.mutation(api.platform.userDeletion.request, {});
    const row = (await f.t.query(internal.platform.userDeletion.pending, { userId: alice.userId }))!;
    await f.t.run(ctx => ctx.db.patch(row._id, { deleteAt: Date.now() }));
    expect(await f.t.mutation(internal.platform.userDeletion.claim, { userId: alice.userId, requestId: row.requestId })).toBe(true);
    await expect(f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: alice.userId })).rejects.toThrow("USER_DELETION_IN_PROGRESS");
    expect(await f.t.query(internal.platform.userDeletion.pending, { userId: alice.userId })).toMatchObject({ state: "deleting" });
  });

  test("an existing invitation cannot break individuals eligibility after configure", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const own = await alice.provision();
    await bob.provision();
    const invitation = await f.invite(own, "bob@example.test", alice.userId);
    await f.paidPlan();
    await f.checked();
    await f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "individuals" });
    const response = await f.post("/organization/accept-invitation", { invitationId: invitation._id }, "bob");
    expect(response.ok).toBe(false);
    expect(await f.members(own)).toHaveLength(1);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(api.platform.tenancy.mode, {})).toEqual({ mode: "individuals" });
  });

  test("finalization revalidates eligibility; failed batches are visible and retryable", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const own = await alice.provision();
    await bob.provision();
    await f.paidPlan();
    await f.checked();
    await f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "individuals" });
    // Simulate a legacy/admin adapter path that bypasses membership triggers.
    const bad = await f.addMember(own, bob.userId, "member");
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.boss.caller.query(api.platform.tenancy.status, {})).toMatchObject({ mode: null, running: { failed: true } });
    await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "member", where: [{ field: "_id", value: bad._id }] } });
    await f.boss.caller.mutation(api.platform.tenancy.retry, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(api.platform.tenancy.mode, {})).toEqual({ mode: "individuals" });
  });
});

test("setup preflights both memberships for a shared owner and recovers from capacity changes", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const alice = await f.user("alice");
  await alice.provision();
  await f.paidPlan();
  for (let i = 1; i < 49; i++) await f.t.run(ctx => createOrganizationWithOwner(ctx, `Solo ${i}`, alice.userId));
  const args = { mode: "organizations" as const, billingUserId: alice.userId, adminUserId: alice.userId, billingOrganizationName: "Payer", sharedOrganizationName: "Shared" };
  await f.checked();
  await expect(f.boss.caller.mutation(api.platform.tenancy.configure, args)).rejects.toThrow("MEMBERSHIP_LIMIT_REACHED");
  expect(await f.t.run(ctx => ctx.db.query("tenancySetups").collect())).toEqual([]);
  const member = (await f.members((await alice.caller.query(api.platform.organizations.mine, {}))!.organizations[1]!.id))[0]!;
  await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "member", where: [{ field: "_id", value: member._id }] } });
  await f.checked();
  await f.boss.caller.mutation(api.platform.tenancy.configure, args);
  const extra = await f.t.run(ctx => createOrganizationWithOwner(ctx, "Capacity consumed after configure", alice.userId));
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await f.boss.caller.query(api.platform.tenancy.status, {})).toMatchObject({ running: { failed: true, error: expect.stringContaining("MEMBERSHIP_LIMIT_REACHED") } });
  const [extraMember] = await f.members(extra);
  await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "member", where: [{ field: "_id", value: extraMember!._id }] } });
  await f.boss.caller.mutation(api.platform.tenancy.retry, {});
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await f.t.query(api.platform.tenancy.mode, {})).toEqual({ mode: "organizations" });
  expect((await alice.caller.query(api.platform.organizations.mine, {}))!.organizations).toHaveLength(50);
});

describe("third review regressions", () => {
  test.each(["sponsorship-first", "deletion-first"])("payer deletion serializes with sponsorship: %s", async order => {
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    const own = await alice.provision();
    const payer = await f.t.mutation(components.platform.billing.createBilling, { organizationId: own, organizationName: "Payer", paymentMethod: "cash", actor: { email: "test" } });
    const free = (await f.plans())[0]!;
    const sponsor = () => alice.caller.mutation(api.platform.billing.createOrganization, { billingOrganizationId: payer, name: "Child", planId: free.id });
    const mark = () => f.t.mutation(internal.platform.organizationOwnership.markDeleting, { organizationId: own });
    if (order === "sponsorship-first") {
      await sponsor();
      await expect(mark()).rejects.toThrow("BILLING_ORGANIZATION_IN_USE");
      expect((await f.organization(own))!.deletingAt).toBeUndefined();
    } else {
      await mark();
      await expect(sponsor()).rejects.toThrow("BILLING_ORGANIZATION_NOT_FOUND");
      await expect(alice.caller.mutation(api.platform.billing.setPaymentMethod, { billingOrganizationId: payer, paymentMethod: "check" })).rejects.toThrow("BILLING_ORGANIZATION_NOT_FOUND");
      expect((await f.t.query(components.platform.billing.paidBy, { billingOrganizationId: payer, paginationOpts: { numItems: 100, cursor: null } })).page).toEqual([]);
    }
    expect(await f.organization(own)).not.toBeNull();
  });

  test.each([false, true])("post-auth deletion cleanup retains migrated inputs and recovers (admin retry: %s)", async manual => {
    vi.useFakeTimers();
    const f = await fixture("organizations");
    await f.paidPlan();
    const alice = await f.user("alice", { userId: "legacy-cleanup-owner" });
    await alice.provision();
    await alice.caller.mutation(api.platform.userProfiles.upsert, { timezone: "Europe/Budapest" });
    await alice.caller.mutation(api.platform.userDeletion.request, {});
    const row = (await f.t.query(internal.platform.userDeletion.pending, { userId: alice.userId }))!;
    await f.t.run(async ctx => { await ctx.db.patch(row._id, { deleteAt: Date.now() }); await ctx.scheduler.cancel(row.jobId); });
    cleanupMock.failures = manual ? 10 : 1;
    await f.t.action(internal.platform.userDeletion.execute, { userId: alice.userId, requestId: row.requestId });
    expect(await f.t.query(internal.platform.userDeletion.userRow, { userId: alice.userId })).toBeNull();
    // The cleanup job removes the membership, then fails on the app's user data, retrying with backoff.
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    if (manual) {
      expect(await f.t.query(internal.platform.userDeletion.cleanupStatus, { userId: alice.userId })).toMatchObject({ ownerId: "legacy-cleanup-owner", state: "failed", attempts: 5, removedMemberships: 1 });
      // The backoff outlasted the first admin's session.
      const recoveryAdmin = await f.user("recovery-admin", { role: "admin" });
      expect((await recoveryAdmin.caller.query(api.platform.userDeletion.list, {})).rows).toMatchObject([{ email: "alice@example.test", state: "cleanup_pending", retryable: true }]);
      await expect(recoveryAdmin.caller.mutation(api.platform.userDeletion.adminCancel, { userId: alice.userId })).rejects.toThrow("USER_CLEANUP_PENDING");
      cleanupMock.failures = 0;
      await recoveryAdmin.caller.mutation(api.platform.userDeletion.adminRetryCleanup, { userId: alice.userId });
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(await f.t.query(internal.platform.userDeletion.cleanupStatus, { userId: alice.userId })).toBeNull();
    expect(await f.t.run(ctx => ctx.db.query("userProfiles").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("pendingPlanChoices").collect())).toEqual([]);
    expect(cleanupMock.owners.every(owner => owner === "legacy-cleanup-owner")).toBe(true);
  });
});

describe("one deletion path (agentUsers.remove and Better Auth's delete)", () => {
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const remove = async (f: Fixture, path: "agent" | "better-auth", userId: string) => {
    if (path === "agent") return await f.boss.caller.mutation(api.platform.agentUsers.remove, { userId });
    const response = await f.post("/admin/remove-user", { userId }, "boss");
    if (!response.ok) throw new Error(((await response.json()) as { code?: string }).code ?? `HTTP ${response.status}`);
  };

  test.each(["agent", "better-auth"] as const)("%s: the same structured blockers, with nothing deleted", async path => {
    const f = await fixture("organizations");
    const pro = await f.paidPlan();
    const alice = await f.user("alice");
    const personal = await alice.provision();
    await alice.caller.mutation(api.platform.billing.choosePlan, { planId: pro, paymentMethod: "cash", billingOrganizationName: "Acme billing" });
    const billing = (await f.current(personal))!.billing!;
    await expect(remove(f, path, alice.userId)).rejects.toThrow("BILLING_ORGANIZATION_IN_USE");
    const bob = await f.user("bob");
    await f.addMember(billing.organizationId, bob.userId, "member");
    await expect(remove(f, path, alice.userId)).rejects.toThrow("BILLING_OWNER_REQUIRED");
    expect(await f.t.query(internal.platform.userDeletion.userRow, { userId: alice.userId })).not.toBeNull();
    expect((await f.members(billing.organizationId)).map((m) => [m.userId, m.role])).toEqual([[alice.userId, "owner"], [bob.userId, "member"]]);
    expect(await f.t.run(ctx => ctx.db.query("userDeletionCleanups").collect())).toEqual([]);
  });

  test.each(["agent", "better-auth"] as const)("%s: the same cleanup", async path => {
    vi.useFakeTimers();
    const f = await fixture("organizations");
    await f.paidPlan();
    const alice = await f.user("alice", { userId: "legacy-alice" });
    const own = await alice.provision();
    const bob = await f.user("bob");
    await f.addMember(own, bob.userId, "member");
    await alice.caller.mutation(api.platform.userProfiles.upsert, { timezone: "Europe/Budapest" });
    await alice.caller.mutation(api.platform.userDeletion.request, {});
    await remove(f, path, alice.userId);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(internal.platform.userDeletion.userRow, { userId: alice.userId })).toBeNull();
    expect((await f.members(own)).map((m) => [m.userId, m.role])).toEqual([[bob.userId, "owner"]]);
    for (const table of ["userProfiles", "pendingPlanChoices", "userDeletions", "userDeletionCleanups"] as const) {
      expect(await f.t.run(ctx => ctx.db.query(table).collect()), table).toEqual([]);
    }
    expect(cleanupMock.owners).toContain("legacy-alice");
  });
});

describe("a pending self-deletion", () => {
  test("cancelling deletion refuses to reactivate a member without an active owner", async () => {
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    const org = await alice.provision();
    const bob = await f.user("bob");
    await f.addMember(org, bob.userId, "member");
    await alice.caller.mutation(api.platform.userDeletion.request, {});
    const aliceSeat = (await f.members(org)).find(m => m.userId === alice.userId)!;
    await f.t.run(ctx => setMemberRole(ctx, aliceSeat._id, "member"));
    await f.t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "user", where: [{ field: "_id", value: bob.userId }], update: { banned: true } },
    });
    await expect(f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: alice.userId })).rejects.toThrow("OWNER_SUCCESSOR_REQUIRED");
    expect(await f.t.run(ctx => ctx.db.query("userDeletions").first())).not.toBeNull();
    await f.t.run(ctx => setMemberRole(ctx, aliceSeat._id, "owner"));
    await f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: alice.userId });
    expect(await f.t.run(ctx => ctx.db.query("userDeletions").first())).toBeNull();
  });

  test("hands sole ownership on at request time; the requester stays an owner and a cancel loses nothing", async () => {
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    const own = await alice.provision();
    const bob = await f.user("bob");
    await f.addMember(own, bob.userId, "member");
    await alice.caller.mutation(api.platform.userDeletion.request, {});
    expect((await f.members(own)).map((m) => [m.userId, m.role])).toEqual([[alice.userId, "owner"], [bob.userId, "owner"]]);
    await f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: alice.userId });
    expect((await f.members(own)).map((m) => [m.userId, m.role])).toEqual([[alice.userId, "owner"], [bob.userId, "owner"]]);
  });

  test("doesn't count as an owner who can act: the other owner can't leave or be demoted until it is cancelled", async () => {
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    const own = await alice.provision();
    const bob = await f.user("bob");
    const carol = await f.user("carol");
    const bobSeat = await f.addMember(own, bob.userId, "owner");
    await f.addMember(own, carol.userId, "member");
    await alice.caller.mutation(api.platform.userDeletion.request, {});
    // Bob was already an owner who can act: nobody was promoted.
    expect((await f.members(own)).find((m) => m.userId === carol.userId)!.role).toBe("member");

    await expect(f.t.run(ctx => deleteMember(ctx, bobSeat._id))).rejects.toThrow("ORGANIZATION_OWNER_REQUIRED");
    await expect(f.t.run(ctx => setMemberRole(ctx, bobSeat._id, "member"))).rejects.toThrow("ORGANIZATION_OWNER_REQUIRED");
    await expect(f.boss.caller.mutation(api.platform.adminOrganizations.removeOwner, { organizationId: own, userId: bob.userId, role: "member" })).rejects.toThrow("LAST_OWNER");

    await f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: alice.userId });
    await f.t.run(ctx => setMemberRole(ctx, bobSeat._id, "member"));
    expect((await f.members(own)).map((m) => [m.userId, m.role])).toEqual([[alice.userId, "owner"], [bob.userId, "member"], [carol.userId, "member"]]);
  });
});

describe("tenancy setup owners", () => {
  test("a pending administrator is never a setup candidate, owner or member", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    await alice.provision();
    await bob.provision();
    // Enrollees get no personal organization.
    const eve = await f.user("eve");
    await f.t.mutation(components.platform.adminInvitations.invite, { email: "eve@example.test", identity: { userId: f.boss.userId, actor: "boss@example.test" } });
    await f.paidPlan();
    await f.checked();
    const status = (await f.boss.caller.query(api.platform.tenancy.status, {}))!;
    expect(status.eligibility).toMatchObject({ appUserCount: 2, individualsAllowed: true });
    expect(status.eligibility!.candidates.map((c) => c.id).sort()).toEqual([alice.userId, bob.userId].sort());
    const args = { mode: "organizations" as const, billingUserId: alice.userId, billingOrganizationName: "Payer", sharedOrganizationName: "Everyone" };
    await f.checked();
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { ...args, adminUserId: eve.userId })).rejects.toThrow("TENANCY_USER_REQUIRED");
    await f.checked();
    await f.boss.caller.mutation(api.platform.tenancy.configure, { ...args, adminUserId: bob.userId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(api.platform.tenancy.mode, {})).toEqual({ mode: "organizations" });
    expect((await eve.caller.query(api.platform.organizations.mine, {}))!.organizations).toEqual([]);
  });

  test.each(["banned", "made an administrator", "deleted"] as const)("retry replaces a shared organization owner who was %s between batches", async change => {
    vi.useFakeTimers();
    const f = await fixture();
    const bob = await f.user("bob");
    // A first batch of users with nobody to add, so the shared organization has only its owner.
    for (let i = 0; i < 48; i++) await f.user(`admin${i}`, { role: "admin" });
    const alice = await f.user("alice");
    const carol = await f.user("carol");
    await f.paidPlan();
    await f.checked();
    await f.boss.caller.mutation(api.platform.tenancy.configure, {
      mode: "organizations", billingUserId: alice.userId, adminUserId: bob.userId, billingOrganizationName: "Payer", sharedOrganizationName: "Everyone",
    });
    // Run the plans step and the first shared batch, and drop the scheduled continuations.
    await f.t.mutation(internal.platform.tenancy.runSetup, {});
    await f.t.mutation(internal.platform.tenancy.runSetup, {});
    await f.t.run(async ctx => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    });
    const setup = (await f.t.run(ctx => ctx.db.query("tenancySetups").first()))!;
    expect(setup).toMatchObject({ step: "shared", state: "running" });
    const shared = setup.sharedOrganizationId!;
    // Its continuation is gone, so the setup is stale; while the shared organization has an owner, the owners stay.
    expect((await f.boss.caller.query(api.platform.tenancy.status, {}))!.running).toMatchObject({ failed: false, stale: true, canReplaceAdmin: false });
    await expect(f.boss.caller.mutation(api.platform.tenancy.retry, { adminUserId: carol.userId })).rejects.toThrow("TENANCY_SETUP_OWNERS_FIXED");

    if (change === "banned") await f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: bob.userId });
    if (change === "made an administrator") await f.boss.caller.mutation(api.platform.agentUsers.setRole, { userId: bob.userId, role: "admin" });
    if (change === "deleted") {
      await f.boss.caller.mutation(api.platform.agentUsers.remove, { userId: bob.userId });
      // The cleanup job removes bob's membership, which deletes the organization he was alone in.
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    await f.t.mutation(internal.platform.tenancy.advanceSetup, { runId: setup.runId });
    const stopped = (await f.boss.caller.query(api.platform.tenancy.status, {}))!;
    expect(stopped.running).toMatchObject({ failed: true, canReplaceOwners: false, canReplaceAdmin: true });

    await expect(f.boss.caller.mutation(api.platform.tenancy.retry, { billingUserId: carol.userId })).rejects.toThrow("TENANCY_SETUP_OWNERS_FIXED");
    await f.boss.caller.mutation(api.platform.tenancy.retry, { adminUserId: carol.userId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(api.platform.tenancy.mode, {})).toEqual({ mode: "organizations" });
    const done = (await f.t.run(ctx => ctx.db.query("tenancySetups").first()))!;
    expect(done.adminUserId).toBe(carol.userId);
    if (change === "deleted") expect(done.sharedOrganizationId).not.toBe(shared);
    else expect(done.sharedOrganizationId).toBe(shared);
    const roles = Object.fromEntries((await f.members(done.sharedOrganizationId!)).map((m) => [m.userId, m.role]));
    expect(roles[carol.userId]).toBe("owner");
    expect(roles[alice.userId]).toBe("member");
    expect((await f.current(done.sharedOrganizationId!))?.billing?.organizationId).toBe(done.billingOrganizationId);
  });

  test("retry keeps the owners once the shared organization has an owner who can act", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    await f.paidPlan();
    await f.checked();
    await f.boss.caller.mutation(api.platform.tenancy.configure, {
      mode: "organizations", billingUserId: alice.userId, adminUserId: bob.userId, billingOrganizationName: "Payer", sharedOrganizationName: "Everyone",
    });
    await f.t.mutation(internal.platform.tenancy.runSetup, {});
    await f.t.mutation(internal.platform.tenancy.runSetup, {});
    await f.t.run(async ctx => {
      const setup = (await ctx.db.query("tenancySetups").first())!;
      await ctx.db.patch(setup._id, { state: "failed", error: "test" });
    });
    expect((await f.boss.caller.query(api.platform.tenancy.status, {}))!.running).toMatchObject({ failed: true, canReplaceAdmin: false });
    await expect(f.boss.caller.mutation(api.platform.tenancy.retry, { adminUserId: alice.userId })).rejects.toThrow("TENANCY_SETUP_OWNERS_FIXED");
  });
});
