// Background jobs tracked by their scheduler record (backgroundJobs.ts): a run that dies after its
// first step leaves its row stale, an administrator's retry completes it, and a late run of the
// dead chain, or a duplicate delivery, does nothing.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { organizationFixture } from "./organizations.test-helpers";
import { sendAuthEmail } from "./sendAuthEmail";

vi.mock("./sendAuthEmail", async (original) => ({
  ...await original<typeof import("./sendAuthEmail")>(),
  sendAuthEmail: vi.fn(),
}));

/** Lets an organization past Better Auth's before-delete check, to reach the after-delete hook's own billing check. */
const ownership = vi.hoisted(() => ({ skipMarkDeleting: false }));
vi.mock("./organizationOwnership", async (original) => {
  const actual = await original<typeof import("./organizationOwnership")>();
  const { internalMutation } = await import("../_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    markDeleting: internalMutation({
      args: { organizationId: v.string() },
      handler: async (ctx, args) => { if (!ownership.skipMarkDeleting) await actual.markOrganizationDeleting(ctx, args.organizationId); },
    }),
  };
});

beforeEach(() => {
  ownership.skipMarkDeleting = false;
  vi.stubEnv("BETTER_AUTH_SECRET", "background-jobs-test-secret-at-least-32-characters");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.mocked(sendAuthEmail).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function fixture(mode?: "organizations") {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  if (mode) await t.mutation(components.platform.appSettings.putRaw, { key: "tenancyMode", value: mode, updatedBy: "test" });
  const paidPlan = async () => await boss.caller.mutation(api.platform.billing.createPlan, { name: "Pro", priceMonthlyUsdCents: 1_900, isFreeForever: false });
  /** Drop a scheduled run before it starts: its job record is then `canceled`, as a lost run's would be `failed`. */
  const drop = (jobId: Id<"_scheduled_functions">) => t.run(async (ctx) => { await ctx.scheduler.cancel(jobId); });
  const job = (jobId: Id<"_scheduled_functions">) => t.run(async (ctx) => (await ctx.db.system.get(jobId))?.state.kind);
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
  return { ...f, boss, paidPlan, drop, job, post, checked };
}

describe("organization cleanup", () => {
  test("is recorded when the organization is deleted; a dead run is stale, retried, and its late run does nothing", async () => {
    vi.useFakeTimers();
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    const acme = await alice.provision();
    await alice.caller.mutation(api.projects.create, { name: "Doomed", description: "" });
    const row = () => f.t.run((ctx) => ctx.db.query("organizationCleanups").withIndex("by_organization", (q) => q.eq("organizationId", acme)).unique());

    await f.boss.caller.mutation(api.platform.adminOrganizations.remove, { organizationId: acme });
    // Owed cleanup is recorded with its job in the deleting transaction, before any run starts.
    const owed = (await row())!;
    expect(owed).toMatchObject({ state: "running", batches: 0, runId: expect.any(String), jobId: expect.any(String) });
    expect(await f.job(owed.jobId!)).toBe("pending");
    expect(await f.boss.caller.query(api.platform.adminOrganizations.cleanups, {})).toMatchObject([{ organizationId: acme, state: "running", stale: false }]);
    await expect(f.boss.caller.mutation(api.platform.adminOrganizations.retryCleanup, { organizationId: acme })).rejects.toThrow("CLEANUP_NOT_FAILED");

    // The run commits its first step, then dies: nothing records an outcome or schedules more.
    expect(await f.t.mutation(internal.platform.organizations.beginCleanup, { organizationId: acme, runId: owed.runId })).toBe(true);
    await f.drop(owed.jobId!);
    expect(await f.boss.caller.query(api.platform.adminOrganizations.cleanups, {})).toMatchObject([{ organizationId: acme, state: "running", stale: true }]);

    await f.boss.caller.mutation(api.platform.adminOrganizations.retryCleanup, { organizationId: acme });
    const retried = (await row())!;
    expect(retried.runId).not.toBe(owed.runId);
    expect(retried.jobId).not.toBe(owed.jobId);
    // A late run of the dead chain does nothing.
    await f.t.action(internal.platform.organizations.deleteOrganizationAppData, { organizationId: acme, runId: owed.runId });
    expect(await row()).toMatchObject({ state: "running", batches: 0, runId: retried.runId });
    expect(await f.t.run((ctx) => ctx.db.query("projects").collect())).toHaveLength(1);

    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await row()).toMatchObject({ state: "done" });
    expect(await f.t.run((ctx) => ctx.db.query("projects").collect())).toEqual([]);
    expect(await f.boss.caller.query(api.platform.adminOrganizations.cleanups, {})).toEqual([]);
    // A duplicate delivery of the retry's run does nothing.
    await f.t.action(internal.platform.organizations.deleteOrganizationAppData, { organizationId: acme, runId: retried.runId });
    expect(await row()).toMatchObject({ state: "done", batches: (await row())!.batches });
  });

  test("Better Auth's delete hook records the cleanup and audits before ending the plan, so a failure there orphans nothing", async () => {
    const f = await fixture("organizations");
    const pro = await f.paidPlan();
    const alice = await f.user("alice");
    const personal = await alice.provision();
    await alice.caller.mutation(api.platform.billing.choosePlan, { planId: pro, paymentMethod: "cash", billingOrganizationName: "Acme billing" });
    const payer = (await f.t.query(components.platform.billing.currentPlan, { organizationId: personal }))!.billing!.organizationId;
    await alice.switchTo(payer);

    // The billing organization still pays for `personal`, so ending its plan throws (BILLING_ORGANIZATION_IN_USE).
    ownership.skipMarkDeleting = true;
    const deleted = await f.post("/organization/delete", { organizationId: payer }, "alice");
    expect(deleted.ok).toBe(false);
    expect(await f.organization(payer)).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.query("organizationCleanups").collect())).toMatchObject([{ organizationId: payer, state: "running" }]);
    const events = (await f.t.query(components.platform.auditTrail.list, { paginationOpts: { numItems: 100, cursor: null } })).page as { action: string; resource: string }[];
    expect(events).toContainEqual(expect.objectContaining({ action: "organization.deleted", resource: `organization:${payer}` }));
  });
});

describe("user deletion", () => {
  async function deleting() {
    const f = await fixture("organizations");
    const alice = await f.user("alice");
    await alice.provision();
    await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "account", data: { userId: alice.userId, accountId: alice.userId, providerId: "credential", createdAt: Date.now(), updatedAt: Date.now() } },
    });
    await alice.caller.mutation(api.platform.userDeletion.request, {});
    const original = (await f.t.query(internal.platform.userDeletion.pending, { userId: alice.userId }))!;
    await f.t.run((ctx) => ctx.db.patch(original._id, { deleteAt: Date.now() }));
    // `execute` claims the request, then dies before deleting anything or recording why.
    expect(await f.t.mutation(internal.platform.userDeletion.claim, { userId: alice.userId, requestId: original.requestId })).toBe(true);
    await f.drop(original.jobId);
    const pending = () => f.t.query(internal.platform.userDeletion.pending, { userId: alice.userId });
    const listed = async () => (await f.boss.caller.query(api.platform.userDeletion.list, {})).rows.find((row) => row.userId === alice.userId);
    return { ...f, alice, original, pending, listed };
  }

  test("a dead run is stale; with the user intact it can be cancelled", async () => {
    const f = await deleting();
    expect(await f.listed()).toMatchObject({ state: "deleting", stale: true, cancelable: true });
    await f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: f.alice.userId });
    expect(await f.pending()).toBeNull();
    expect(await f.t.query(internal.platform.userDeletion.userRow, { userId: f.alice.userId })).not.toBeNull();
    // A late run of the cancelled request does nothing.
    await f.t.action(internal.platform.userDeletion.execute, { userId: f.alice.userId, requestId: f.original.requestId });
    expect(await f.t.query(internal.platform.userDeletion.userRow, { userId: f.alice.userId })).not.toBeNull();
  });

  test("a partly deleted user can only be retried; the retry completes it and a late run of the dead one does nothing", async () => {
    vi.useFakeTimers();
    const f = await deleting();
    // A deletion under way that is not stale can be neither cancelled nor retried.
    await f.t.run(async (ctx) => {
      const live = await ctx.scheduler.runAfter(60_000, internal.platform.userDeletion.execute, { userId: f.alice.userId, requestId: "unrelated" });
      await ctx.db.patch(f.original._id, { jobId: live });
    });
    expect(await f.listed()).toMatchObject({ state: "deleting", stale: false, cancelable: false });
    await expect(f.boss.caller.mutation(api.platform.userDeletion.adminRetry, { userId: f.alice.userId })).rejects.toThrow("USER_DELETION_NOT_STALE");
    await expect(f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: f.alice.userId })).rejects.toThrow("USER_DELETION_IN_PROGRESS");
    await f.t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    });

    // Better Auth deleted the accounts before the run died: the user can't come back by cancelling.
    await f.t.mutation(components.betterAuth.adapter.deleteMany, {
      input: { model: "account", where: [{ field: "userId", value: f.alice.userId }] }, paginationOpts: { cursor: null, numItems: 100 },
    });
    expect(await f.listed()).toMatchObject({ state: "deleting", stale: true, cancelable: false });
    await expect(f.boss.caller.mutation(api.platform.userDeletion.adminCancel, { userId: f.alice.userId })).rejects.toThrow("USER_DELETION_INCOMPLETE");

    await f.boss.caller.mutation(api.platform.userDeletion.adminRetry, { userId: f.alice.userId });
    const retried = (await f.pending())!;
    expect(retried).toMatchObject({ state: "deleting", requestId: f.original.requestId, runId: expect.any(String) });
    expect(await f.listed()).toMatchObject({ stale: false });
    await expect(f.boss.caller.mutation(api.platform.userDeletion.adminRetry, { userId: f.alice.userId })).rejects.toThrow("USER_DELETION_NOT_STALE");
    // A late run of the dead chain does nothing.
    await f.t.action(internal.platform.userDeletion.execute, { userId: f.alice.userId, requestId: f.original.requestId });
    expect(await f.t.query(internal.platform.userDeletion.userRow, { userId: f.alice.userId })).not.toBeNull();
    expect(await f.pending()).toMatchObject({ state: "deleting", runId: retried.runId });

    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(internal.platform.userDeletion.userRow, { userId: f.alice.userId })).toBeNull();
    expect(await f.pending()).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.query("userDeletionCleanups").collect())).toEqual([]);
    expect(await f.members((await f.t.run((ctx) => ctx.db.query("organizationCleanups").first()))!.organizationId)).toEqual([]);
    // A duplicate delivery of the retry's run does nothing.
    await f.t.action(internal.platform.userDeletion.execute, { userId: f.alice.userId, requestId: f.original.requestId, runId: retried.runId });
    expect(await f.pending()).toBeNull();
  });

  test("a retry where the user row is already gone continues into the cleanup", async () => {
    vi.useFakeTimers();
    const f = await deleting();
    // The run died after Better Auth deleted the user (its before-hook recorded the cleanup).
    await f.t.run(async (ctx) => {
      await ctx.db.insert("userDeletionCleanups", { userId: f.alice.userId, ownerId: f.alice.userId, email: "alice@example.test", name: "alice", state: "pending", attempts: 0, createdAt: Date.now() });
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    });
    await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "user", where: [{ field: "_id", value: f.alice.userId }] } });
    expect(await f.listed()).toMatchObject({ state: "cleanup_pending", stale: true, cancelable: false });
    await f.boss.caller.mutation(api.platform.userDeletion.adminRetry, { userId: f.alice.userId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.pending()).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.query("userDeletionCleanups").collect())).toEqual([]);
  });
});

describe("tenancy setup", () => {
  test("a lost batch is stale and retried; a late run of the stopped chain and a duplicate delivery do nothing", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    await alice.provision();
    await f.paidPlan();
    await f.checked();
    await f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "organizations", billingUserId: alice.userId, adminUserId: alice.userId, billingOrganizationName: "Payer", sharedOrganizationName: "Everyone" });
    const setup = () => f.t.run((ctx) => ctx.db.query("tenancySetups").first());
    const first = (await setup())!;
    expect(first).toMatchObject({ state: "running", step: "plans", runId: expect.any(String), jobId: expect.any(String) });
    expect((await f.boss.caller.query(api.platform.tenancy.status, {}))!.running).toMatchObject({ failed: false, stale: false });
    await expect(f.boss.caller.mutation(api.platform.tenancy.retry, {})).rejects.toThrow("TENANCY_SETUP_NOT_FAILED");

    // The batch's job is lost (failed outright, or canceled): nothing will move the setup on.
    await f.drop(first.jobId!);
    expect((await f.boss.caller.query(api.platform.tenancy.status, {}))!.running).toMatchObject({ failed: false, stale: true });
    await f.boss.caller.mutation(api.platform.tenancy.retry, {});
    const retried = (await setup())!;
    expect(retried.runId).not.toBe(first.runId);

    // A late run of the stopped chain does nothing.
    await f.t.mutation(internal.platform.tenancy.advanceSetup, { runId: first.runId });
    expect(await setup()).toMatchObject({ step: "plans", jobId: retried.jobId });

    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(api.platform.tenancy.mode, {})).toEqual({ mode: "organizations" });
    const done = (await setup())!;
    expect(done).toMatchObject({ state: "done" });
    // A duplicate delivery does nothing.
    await f.t.mutation(internal.platform.tenancy.advanceSetup, { runId: retried.runId });
    expect(await setup()).toEqual(done);
  });

  test("a failing batch is recorded as failed by the same scheduled mutation, with none of its writes", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    await alice.provision();
    await f.paidPlan();
    await f.checked();
    await f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "organizations", billingUserId: alice.userId, adminUserId: alice.userId, billingOrganizationName: "Payer", sharedOrganizationName: "Everyone" });
    // The shared step fails once the plans are done: its owner can no longer act.
    await f.t.run(async (ctx) => { for (const job of await ctx.db.system.query("_scheduled_functions").collect()) if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id); });
    const { runId } = (await f.t.run((ctx) => ctx.db.query("tenancySetups").first()))!;
    await f.t.mutation(internal.platform.tenancy.advanceSetup, { runId });
    await f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: alice.userId });
    const organizationsBefore = await f.t.query(components.betterAuth.adapter.findMany, { model: "organization", paginationOpts: { numItems: 100, cursor: null } });
    await f.t.mutation(internal.platform.tenancy.advanceSetup, { runId });
    expect(await f.t.run((ctx) => ctx.db.query("tenancySetups").first())).toMatchObject({ state: "failed", step: "shared", error: expect.stringContaining("TENANCY_USER_REQUIRED") });
    expect((await f.t.query(components.betterAuth.adapter.findMany, { model: "organization", paginationOpts: { numItems: 100, cursor: null } })).page).toHaveLength(organizationsBefore.page.length);
    expect((await f.boss.caller.query(api.platform.tenancy.status, {}))!.running).toMatchObject({ failed: true, stale: false });
  });
});
