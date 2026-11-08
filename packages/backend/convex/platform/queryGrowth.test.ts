// What a write or a read costs as organizations, memberships and installs grow: member triggers
// read owners, not members; account deletion removes memberships as a durable job, one
// organization per run; the tenancy check is a stored, batched scan; admin views read members
// once; billing reads at most two plan rows. Read counts come from ctx.meta.getTransactionMetrics().
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFunctionHandle } from "convex/server";

import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { countReads, organizationFixture } from "./organizations.test-helpers";
import { CHECK_FRESH_MS } from "./tenancy";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "query-growth-test-secret-at-least-32-characters");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  /** `count` users who are members (or `role`) of the organization, in one transaction, without triggers. */
  const seedMembers = (organizationId: string, count: number, prefix: string, role = "member") => t.run(async (ctx) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const now = Date.now();
      const user = await ctx.runMutation(components.betterAuth.adapter.create, {
        input: { model: "user", data: { name: `${prefix}${i}`, email: `${prefix}${i}@example.test`, emailVerified: true, createdAt: now, updatedAt: now } },
      });
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: { model: "member", data: { organizationId, userId: user._id, role, createdAt: now + i } },
      });
      ids.push(user._id);
    }
    return ids;
  });
  /** Run `write` as one transaction and count the documents it read, component calls included. */
  const readsOf = (write: (ctx: Parameters<Parameters<typeof t.run>[0]>[0]) => Promise<unknown>) => t.run(async (ctx) => {
    const before = (await ctx.meta.getTransactionMetrics()).documentsRead.used;
    await write(ctx);
    return (await ctx.meta.getTransactionMetrics()).documentsRead.used - before;
  });
  const join = async (organizationId: string, name: string, role = "member") => {
    const user = await f.user(name);
    return await readsOf(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: { model: "member", data: { organizationId, userId: user.userId, role, createdAt: Date.now() } },
        onCreateHandle: await createFunctionHandle(internal.platform.authTriggers.onCreate),
      });
    });
  };
  const memberships = async (userId: string) => (await t.query(components.betterAuth.adapter.findMany, {
    model: "member", where: [{ field: "userId", value: userId }], paginationOpts: { numItems: 1000, cursor: null },
  })).page as { _id: string; organizationId: string; role: string }[];
  const cleanup = (userId: string) => t.query(internal.platform.userDeletion.cleanupStatus, { userId });
  return { ...f, boss, seedMembers, readsOf, join, memberships, cleanup };
}

describe("member triggers read owners, not members", () => {
  test("a join, a leave and a demotion cost the same in an organization of 5 or 400 members", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const small = await alice.provision();
    const carol = await f.user("carol");
    const large = await carol.provision();
    await f.seedMembers(small, 5, "s");
    await f.seedMembers(large, 400, "l");

    const smallJoin = await f.join(small, "joiner-small");
    const largeJoin = await f.join(large, "joiner-large");
    expect(largeJoin).toBeLessThanOrEqual(smallJoin + 5);
    expect(largeJoin).toBeLessThan(60);

    // A second owner, demoted again; and a member leaving.
    const costs = async (organizationId: string, name: string) => {
      const user = await f.user(name);
      const member = await f.addMember(organizationId, user.userId, "owner");
      const demote = await f.readsOf(async (ctx) => {
        await ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: { model: "member", where: [{ field: "_id", value: member._id }], update: { role: "member" } },
          onUpdateHandle: await createFunctionHandle(internal.platform.authTriggers.onUpdate),
        });
      });
      const leave = await f.readsOf(async (ctx) => {
        await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
          input: { model: "member", where: [{ field: "_id", value: member._id }] },
          onDeleteHandle: await createFunctionHandle(internal.platform.authTriggers.onDelete),
        });
      });
      return { demote, leave };
    };
    const smallCosts = await costs(small, "second-small");
    const largeCosts = await costs(large, "second-large");
    expect(largeCosts.demote).toBeLessThanOrEqual(smallCosts.demote + 5);
    expect(largeCosts.leave).toBeLessThanOrEqual(smallCosts.leave + 5);
  });

  test("the guard still refuses: no join where no owner can act, no removal of the last owner who can", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const acme = await alice.provision();
    await f.seedMembers(acme, 30, "m");
    const [aliceSeat] = (await f.members(acme)).filter((m) => m.userId === alice.userId);
    await expect(f.t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: { model: "member", where: [{ field: "_id", value: aliceSeat!._id }], update: { role: "member" } },
        onUpdateHandle: await createFunctionHandle(internal.platform.authTriggers.onUpdate),
      });
    })).rejects.toThrow("ORGANIZATION_OWNER_REQUIRED");
    await f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: alice.userId, successors: [{ organizationId: acme, userId: (await f.members(acme)).find((m) => m.role === "member")!.userId }] });
    // A member who can act was promoted; a ban of the last one would need another successor.
    expect((await f.members(acme)).filter((m) => m.role === "owner")).toHaveLength(2);
  });
});

describe("account deletion removes memberships as a job", () => {
  test("one organization per run; a dead run is stale, retried, and a late run of it does nothing", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const own = await alice.provision();
    const bob = await f.user("bob");
    const team = await bob.provision();
    await f.addMember(team, alice.userId, "admin");
    const carol = await f.user("carol");
    const big = await carol.provision();
    await f.addMember(big, alice.userId, "owner");
    // Carol, big's other owner, can't act: alice's removal passes ownership to the oldest admin, else member.
    await f.seedMembers(big, 300, "b");
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: carol.userId }], update: { banned: true } } });

    await f.boss.caller.mutation(api.platform.agentUsers.remove, { userId: alice.userId });
    expect(await f.t.query(internal.platform.userDeletion.userRow, { userId: alice.userId })).toBeNull();
    // Recorded in the deleting transaction, with its job: nothing points at a deleted user unowed.
    const owed = (await f.cleanup(alice.userId))!;
    expect(owed).toMatchObject({ state: "running", removedMemberships: 0, runId: expect.any(String), jobId: expect.any(String) });
    expect(await f.memberships(alice.userId)).toHaveLength(3);
    await expect(f.boss.caller.mutation(api.platform.userDeletion.adminRetryCleanup, { userId: alice.userId })).rejects.toThrow("USER_CLEANUP_RUNNING");

    // The first run removes one membership, at a cost that doesn't grow with the 300 members.
    const reads = await f.readsOf((ctx) => ctx.runMutation(internal.platform.userDeletion.advanceCleanup, { userId: alice.userId, runId: owed.runId }));
    expect(reads).toBeLessThan(150);
    const progressed = (await f.cleanup(alice.userId))!;
    expect(progressed).toMatchObject({ state: "running", removedMemberships: 1 });
    expect(await f.memberships(alice.userId)).toHaveLength(2);

    // Its continuation is lost: the cleanup is stale, and the admin list says so.
    await f.t.run(async (ctx) => { await ctx.scheduler.cancel(progressed.jobId!); });
    const listed = async () => (await f.boss.caller.query(api.platform.userDeletion.list, {})).rows.find((row) => row.userId === alice.userId);
    expect(await listed()).toMatchObject({ state: "cleanup_pending", stale: true, retryable: true, removedMemberships: 1 });
    await f.boss.caller.mutation(api.platform.userDeletion.adminRetryCleanup, { userId: alice.userId });
    const retried = (await f.cleanup(alice.userId))!;
    expect(retried.runId).not.toBe(owed.runId);
    // A late run of the dead chain does nothing.
    await f.t.mutation(internal.platform.userDeletion.advanceCleanup, { userId: alice.userId, runId: owed.runId });
    expect(await f.memberships(alice.userId)).toHaveLength(2);

    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.memberships(alice.userId)).toEqual([]);
    expect(await f.cleanup(alice.userId)).toBeNull();
    // Her personal organization went with her; the others kept an owner who can act.
    expect(await f.organization(own)).toBeNull();
    expect((await f.members(team)).map((m) => m.role)).toEqual(["owner"]);
    const bigOwners = (await f.t.query(components.betterAuth.adapter.findMany, {
      model: "member", where: [{ field: "organizationId", value: big }, { field: "role", value: "owner" }], paginationOpts: { numItems: 10, cursor: null },
    })).page as { userId: string }[];
    expect(bigOwners.map((m) => m.userId)).toContain(carol.userId);
    expect(bigOwners).toHaveLength(2);
  });

  test("Better Auth's delete starts the same job", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    await alice.provision();
    const response = await f.t.fetch("/api/auth/admin/remove-user", {
      method: "POST",
      headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: "Bearer boss-session" },
      body: JSON.stringify({ userId: alice.userId }),
    });
    expect(response.status).toBe(200);
    expect(await f.cleanup(alice.userId)).toMatchObject({ state: "running" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.memberships(alice.userId)).toEqual([]);
    expect(await f.cleanup(alice.userId)).toBeNull();
  });
});

describe("the tenancy check", () => {
  test("is a batched scan with stored progress; status reads the result; configure needs it fresh", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const acme = await alice.provision();
    await f.seedMembers(acme, 250, "u");
    await f.boss.caller.mutation(api.platform.billing.createPlan, { name: "Pro", priceMonthlyUsdCents: 1_900, isFreeForever: false });
    const status = async () => (await f.boss.caller.query(api.platform.tenancy.status, {}))!;
    const row = () => f.t.run((ctx) => ctx.db.query("tenancyChecks").order("desc").first());

    expect(await status()).toMatchObject({ mode: null, eligibility: null, check: null });
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "organizations" })).rejects.toThrow("TENANCY_CHECK_REQUIRED");

    await f.boss.caller.mutation(api.platform.tenancy.check, {});
    const first = (await row())!;
    expect(first).toMatchObject({ state: "running", phase: "users", batches: 0 });
    await f.t.mutation(internal.platform.tenancy.advanceCheck, { runId: first.runId, batch: 0 });
    expect(await row()).toMatchObject({ state: "running", phase: "users", batches: 1, users: 100 });
    expect((await status()).check).toMatchObject({ state: "running", users: 100 });
    // A repeated delivery of the batch just run does nothing.
    await f.t.mutation(internal.platform.tenancy.advanceCheck, { runId: first.runId, batch: 0 });
    expect(await row()).toMatchObject({ batches: 1, users: 100 });

    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const done = (await row())!;
    // 252 users (alice, boss and 250 seeded): boss is an administrator.
    expect(done).toMatchObject({ state: "done", phase: "done", users: 252, appUserCount: 251, sharedOrganizations: 1, complete: true });
    const read = await countReads(f.boss.caller, (ctx) => ctx.runQuery(api.platform.tenancy.status, {}));
    expect(read.result!.eligibility).toMatchObject({ appUserCount: 251, sharedOrganizations: 1, individualsAllowed: false, sharedStep: false, plans: { ready: true } });
    expect(read.documentsRead).toBeLessThan(30);
    await expect(f.boss.caller.mutation(api.platform.tenancy.configure, { mode: "individuals" })).rejects.toThrow("TENANCY_INDIVIDUALS_NOT_ALLOWED");

    // An old result no longer stands.
    vi.setSystemTime(Date.now() + CHECK_FRESH_MS + 1000);
    const later = await f.user("boss2", { role: "admin" });
    await expect(later.caller.mutation(api.platform.tenancy.configure, { mode: "organizations" })).rejects.toThrow("TENANCY_CHECK_EXPIRED");
    await later.caller.mutation(api.platform.tenancy.check, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    await later.caller.mutation(api.platform.tenancy.configure, { mode: "organizations" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.query(api.platform.tenancy.mode, {})).toEqual({ mode: "organizations" });
  });

  test("a lost batch leaves the check stale; checking again starts over", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    await alice.provision();
    await f.boss.caller.mutation(api.platform.tenancy.check, {});
    const first = (await f.t.run((ctx) => ctx.db.query("tenancyChecks").first()))!;
    // A check already running is left alone.
    await f.boss.caller.mutation(api.platform.tenancy.check, {});
    expect((await f.t.run((ctx) => ctx.db.query("tenancyChecks").first()))!.runId).toBe(first.runId);
    await f.t.run(async (ctx) => { await ctx.scheduler.cancel(first.jobId!); });
    expect((await f.boss.caller.query(api.platform.tenancy.status, {}))!.check).toMatchObject({ state: "running", stale: true });
    await f.boss.caller.mutation(api.platform.tenancy.check, {});
    const again = (await f.t.run((ctx) => ctx.db.query("tenancyChecks").first()))!;
    expect(again.runId).not.toBe(first.runId);
    await f.t.mutation(internal.platform.tenancy.advanceCheck, { runId: first.runId, batch: 0 });
    expect((await f.t.run((ctx) => ctx.db.query("tenancyChecks").first()))!.batches).toBe(0);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.run((ctx) => ctx.db.query("tenancyChecks").collect())).toMatchObject([{ state: "done", appUserCount: 1 }]);
  });
});

describe("admin views and billing reads stay bounded", () => {
  test("get reads the members once; forUser reads each organization's member rows once and users only where it names them", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const organizations: string[] = [];
    for (const name of ["one", "two", "three"]) {
      const owner = await f.user(`${name}-owner`);
      const organizationId = await owner.provision();
      await f.addMember(organizationId, alice.userId, "member");
      await f.seedMembers(organizationId, 150, `${name}-`);
      organizations.push(organizationId);
    }
    const detail = await countReads(f.boss.caller, (ctx) => ctx.runQuery(api.platform.adminOrganizations.get, { organizationId: organizations[0]! }));
    expect(detail.result!.members).toHaveLength(152);
    expect(detail.result).toMatchObject({ memberCount: 152 });
    // 152 member rows and 152 users, plus a few: never the member list twice.
    expect(detail.documentsRead).toBeLessThan(2 * 152 + 30);

    const mine = await countReads(f.boss.caller, (ctx) => ctx.runQuery(api.platform.adminOrganizations.forUser, { userId: alice.userId }));
    expect(mine.result!.map((m) => m.memberCount)).toEqual([152, 152, 152]);
    expect(mine.result!.every((m) => m.onAccountDeletion === "membershipRemoved")).toBe(true);
    expect(mine.documentsRead).toBeLessThan(3 * 152 + 60);
  });

  test("forUser lists a few ban candidates; any member who can act is accepted as the successor", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const acme = await alice.provision();
    const seeded = await f.seedMembers(acme, 30, "m");
    const [row] = (await f.boss.caller.query(api.platform.adminOrganizations.forUser, { userId: alice.userId }))!;
    expect(row!.banSuccessor).toMatchObject({ moreCandidates: true, suggested: seeded[0] });
    expect(row!.banSuccessor!.candidates).toHaveLength(10);
    // The last-seeded member isn't listed, but can take over.
    await f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: alice.userId, successors: [{ organizationId: acme, userId: seeded[29]! }] });
    expect((await f.members(acme)).find((m) => m.userId === seeded[29])!.role).toBe("owner");
    const [other] = (await f.boss.caller.query(api.platform.adminOrganizations.forUser, { userId: seeded[0]! }))!;
    await expect(f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: seeded[29]!, successors: [{ organizationId: acme, userId: alice.userId }] })).rejects.toThrow("INVALID_SUCCESSOR");
    expect(other!.banSuccessor).toBeNull();
  });

  test("billingInUse and organizationDeleted read at most two plan rows; paidBy pages", async () => {
    const f = await fixture();
    const payer = await f.t.mutation(components.platform.billing.createBilling, { organizationId: "payer-org", organizationName: "Payer", actor: { email: "test" } });
    const planId = await f.t.mutation(components.platform.billing.ensureSeeded, {});
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 300; i++) {
        await ctx.runMutation(components.platform.billing.startPlan, { organizationId: `sponsored-${i}`, organizationName: `S${i}`, planId, billingOrganizationId: payer, actor: { email: "test" } });
      }
    });
    const inUse = await countReads(f.t, (ctx) => ctx.runQuery(components.platform.billing.billingInUse, { organizationId: "payer-org" }));
    expect(inUse.result).toBe(true);
    expect(inUse.documentsRead).toBeLessThan(10);
    const first = await f.t.query(components.platform.billing.paidBy, { billingOrganizationId: payer, paginationOpts: { numItems: 50, cursor: null } });
    expect(first.page).toHaveLength(50);
    expect(first.isDone).toBe(false);
  });

  test("the admin deletion list says when there are more than it shows", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const jobId = await ctx.scheduler.runAfter(86_400_000, internal.platform.userDeletion.pending, { userId: "nobody" });
      for (let i = 0; i < 201; i++) {
        await ctx.db.insert("userDeletions", { userId: `gone-${i}`, requestId: `r${i}`, requestedAt: i, deleteAt: Date.now() + i, jobId, state: "scheduled" });
      }
    });
    const list = (await f.boss.caller.query(api.platform.userDeletion.list, {}))!;
    expect(list.more).toBe(true);
    expect(list.rows).toHaveLength(200);
  });

  test("deleting an organization with more members than one transaction deletes finishes in batches", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const alice = await f.user("alice");
    const acme = await alice.provision();
    await f.seedMembers(acme, 1_050, "m");
    await f.boss.caller.mutation(api.platform.adminOrganizations.remove, { organizationId: acme });
    expect(await f.organization(acme)).toBeNull();
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.members(acme)).toEqual([]);
  });
});
