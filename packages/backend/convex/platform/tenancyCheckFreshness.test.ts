import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFunctionHandle } from "convex/server";
import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { organizationFixture } from "./organizations.test-helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("BETTER_AUTH_SECRET", "freshness-test-secret-at-least-32-characters");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

test.each(["running", "done"] as const)("a membership write invalidates a %s tenancy check and old batches cannot restore it", async (state) => {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  const owner = await f.user("owner");
  const org = await owner.provision();
  const joining = await f.user("joining");
  await boss.caller.mutation(api.platform.tenancy.check, {});
  if (state === "done") await t.finishAllScheduledFunctions(vi.runAllTimers);
  const row = (await t.run(ctx => ctx.db.query("tenancyChecks").first()))!;
  expect(row.state).toBe(state);
  await t.run(async ctx => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "member", data: { organizationId: org, userId: joining.userId, role: "member", createdAt: Date.now() } },
      onCreateHandle: await createFunctionHandle(internal.platform.authTriggers.onCreate),
    });
  });
  await t.mutation(internal.platform.tenancy.advanceCheck, { runId: row.runId, batch: row.batches });
  expect(await t.run(ctx => ctx.db.get(row._id))).toMatchObject({ state: "failed", error: "TENANCY_CHECK_CHANGED" });
  await expect(boss.caller.mutation(api.platform.tenancy.configure, { mode: "individuals" })).rejects.toThrow("TENANCY_CHECK_REQUIRED");
  await boss.caller.mutation(api.platform.tenancy.check, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run(ctx => ctx.db.get(row._id))).toMatchObject({ state: "done", sharedOrganizations: 1, complete: true });
});

test("organization deletion records cleanup before its after-hook", async () => {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const owner = await f.user("owner");
  const org = await owner.provision();
  await t.run(async ctx => {
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "organization", where: [{ field: "_id", value: org }] },
      onDeleteHandle: await createFunctionHandle(internal.platform.authTriggers.onDelete),
    });
    expect(await ctx.db.query("organizationCleanups").first()).toMatchObject({ organizationId: org, state: "running" });
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test("setup neither lists nor accepts an owner with pending deletion", async () => {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  const owner = await f.user("owner");
  await owner.provision();
  await boss.caller.mutation(api.platform.billing.createPlan, { name: "Pro", priceMonthlyUsdCents: 1900, isFreeForever: false });
  await owner.caller.mutation(api.platform.userDeletion.request, {});
  // Run only the preflight chain: advancing all timers would execute the future deletion.
  await boss.caller.mutation(api.platform.tenancy.check, {});
  for (let i = 0; i < 10; i++) {
    const row = (await t.run(ctx => ctx.db.query("tenancyChecks").first()))!;
    if (row.state === "done") break;
    await t.mutation(internal.platform.tenancy.advanceCheck, { runId: row.runId, batch: row.batches });
  }
  const status = await boss.caller.query(api.platform.tenancy.status, {});
  expect(status!.eligibility!.candidates.map(c => c.id)).not.toContain(owner.userId);
  await expect(boss.caller.mutation(api.platform.tenancy.configure, {
    mode: "organizations", billingUserId: owner.userId, adminUserId: owner.userId,
    billingOrganizationName: "Payer", sharedOrganizationName: "Shared",
  })).rejects.toThrow("TENANCY_USER_REQUIRED");
});

test("administrator enrollment changes invalidate the application-user preflight", async () => {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  await boss.caller.mutation(api.platform.tenancy.check, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await boss.caller.mutation(api.platform.adminInvitations.invite, { email: "future-admin@example.test" });
  expect(await t.run(ctx => ctx.db.query("tenancyChecks").first())).toMatchObject({ state: "failed", error: "TENANCY_CHECK_CHANGED" });
});
