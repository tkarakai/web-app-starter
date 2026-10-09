import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { filterAppOperatorEmails } from "./appOperatorDirectory";
import { projectNativeResult } from "./agentNativePolicy";
import { runCapability } from "./agentCapabilities";

const authModules = import.meta.glob("./betterAuth/**/*.*s");
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

/** Canonical trusted database fixture for data-access/security regressions; not live enrollment evidence. */
async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, authModules);
  async function user(name: string, data: Partial<Omit<Doc<"user">, "_id" | "_creationTime">> = {}) {
    return t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name, email: `${name}@example.test`, role: "admin", emailVerified: true,
      createdAt: Date.now(), updatedAt: Date.now(), ...data,
    } } });
  }
  const actor = await user("actor", { createdAt: 1 });
  const now = Date.now();
  const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
    userId: actor._id, token: "isolated-operator-directory-fixture", createdAt: now, updatedAt: now,
    expiresAt: now + 60 * 60_000, assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
  } } });
  const client = t.withIdentity({ subject: actor._id, sessionId: session._id });
  return { t, actor, session, client, user };
}

test("protected email batching preserves all 205 operators and native output defense with bounded crossings", async () => {
  const f = await fixture();
  const emails: string[] = [];
  for (let i = 0; i < 205; i++) {
    const user = await f.user(`protected-${i}`, { banned: i === 0 });
    emails.push(user.email);
    await f.t.mutation(components.platform.adminEmails.ensure, { email: user.email });
  }
  const direct = await f.client.query(api.platform.adminEmails.listProtected, {});
  expect(direct).toEqual(emails);
  const native = await f.client.run(async ctx => {
    const runQuery = vi.fn(ctx.runQuery);
    const result = await runCapability({ ...ctx, runQuery }, { user: f.actor }, "admins_listProtected", {}, false);
    const batches = runQuery.mock.calls.filter(([, args]) => Array.isArray((args as { emails?: unknown }).emails));
    expect(batches).toHaveLength(6); // Three complete batches in each independent privacy pass.
    expect(batches.map(([, args]) => (args as { emails: string[] }).emails.length)).toEqual([100, 100, 5, 100, 100, 5]);
    expect(runQuery.mock.calls.length).toBeLessThan(60);
    return result;
  });
  expect(native).toEqual(emails);
});

test("batch classifier preserves case/order/duplicates and rejects pending, customer and every mixed identity", async () => {
  const f = await fixture();
  const banned = await f.user("banned", { banned: true });
  const customer = await f.user("customer", { role: "user", customerAdmission: "public-signup" });
  const admitted = await f.user("admitted", { customerAdmission: "historical" });
  const member = await f.user("member");
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    userId: member._id, organizationId: "historical-orphan-organization", role: "member", createdAt: 1,
  } } });
  const owner = await f.user("owner");
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "organization", data: {
    name: "Historical mixed identity", slug: "historical-mixed", createdAt: 1, personalOwnerId: owner._id,
  } } });
  const candidates = [f.actor.email, "pending@example.test", customer.email, admitted.email, member.email, owner.email,
    banned.email, f.actor.email.toUpperCase(), f.actor.email];
  expect(await f.t.run(ctx => filterAppOperatorEmails(ctx, candidates))).toEqual([f.actor.email, banned.email, f.actor.email]);
  const maliciousBody = [null, ...candidates, { email: f.actor.email }];
  expect(await f.t.run(ctx => projectNativeResult(ctx, "platform/adminEmails:listProtected", maliciousBody)))
    .toEqual([f.actor.email, banned.email, f.actor.email.toUpperCase(), f.actor.email]);
  await expect(f.t.query(components.betterAuth.appOperators.filterEmails, { emails: Array(101).fill(f.actor.email) })).rejects.toThrow("OPERATOR_EMAIL_BATCH_TOO_LARGE");
  await expect(f.t.run(ctx => projectNativeResult(ctx, "platform/adminEmails:listProtected", { emails: candidates }))).rejects.toThrow("NATIVE_RESULT_DENIED");
});

test("directory reaches older operators past 250 ordinary customers and orders by createdAt rather than insertion", async () => {
  const f = await fixture();
  const newer = await f.user("newer", { createdAt: 30 });
  const older = await f.user("older", { createdAt: 10 });
  for (let i = 0; i < 250; i++) await f.user(`customer-${i}`, { role: "user", createdAt: 100 + i });
  const args = { paginationOpts: { numItems: 100, cursor: null } };
  const expected = [newer._id, older._id, f.actor._id];
  const direct = await f.client.query(api.platform.agentUsers.list, args);
  expect(direct?.page.map(row => row.id)).toEqual(expected);
  const native = await f.client.run(ctx => runCapability(ctx, { user: f.actor }, "users_list", args, false));
  expect(native).toEqual(direct);
  expect(JSON.stringify(direct)).not.toContain("customer-");
  const ascending = await f.client.query(api.platform.agentUsers.list, { ...args, sortDirection: "asc" });
  expect(ascending?.page.map(row => row.id)).toEqual([...expected].reverse());
});

test("directory filters stay role-indexed and page over mixed records without identity-bearing split cursors", async () => {
  const f = await fixture();
  const one = await f.user("chosen-one", { createdAt: 10, banned: null });
  const mixed = await f.user("hidden-mixed", { createdAt: 20, customerAdmission: "historical" });
  const two = await f.user("chosen-two", { createdAt: 30, banned: false });
  const banned = await f.user("chosen-banned", { createdAt: 40, banned: true });
  await f.user("chosen-unverified", { createdAt: 50, emailVerified: false });
  for (let i = 0; i < 205; i++) await f.user(`ordinary-${i}`, { role: "user", createdAt: 100 + i });
  const filters = { search: "CHOSEN", status: "active" as const, emailVerified: true, sortDirection: "asc" as const };
  const first = await f.client.query(api.platform.agentUsers.list, { ...filters, paginationOpts: { numItems: 1, cursor: null } });
  expect(first?.page.map(row => row.id)).toEqual([one._id]);
  const second = await f.client.query(api.platform.agentUsers.list, { ...filters, paginationOpts: { numItems: 1, cursor: first!.continueCursor } });
  expect(second?.page.map(row => row.id)).toEqual([two._id]);
  const last = await f.client.query(api.platform.agentUsers.list, { ...filters, paginationOpts: { numItems: 1, cursor: second!.continueCursor } });
  expect(last).toMatchObject({ page: [], isDone: true, continueCursor: "" });
  for (const page of [first, second, last]) {
    expect(JSON.stringify(page)).not.toContain(mixed._id);
    expect(page).not.toHaveProperty("splitCursor");
  }
  const bannedOnly = await f.client.query(api.platform.agentUsers.list, { status: "banned", paginationOpts: { numItems: 100, cursor: null } });
  expect(bannedOnly?.page.map(row => row.id)).toEqual([banned._id]);
  const byName = await f.client.query(api.platform.agentUsers.list, { searchField: "name", search: "chosen-two", paginationOpts: { numItems: 100, cursor: null } });
  expect(byName?.page.map(row => row.id)).toEqual([two._id]);
});

test("directory binds continuation and refresh endCursor to actor/query and rejects hidden or stale anchors", async () => {
  const f = await fixture();
  const target = await f.user("target", { createdAt: 10 });
  const args = { paginationOpts: { numItems: 1, cursor: null } };
  const first = await f.client.query(api.platform.agentUsers.list, args);
  const cursor = first!.continueCursor;
  expect(first?.page[0]?.id).toBe(target._id);
  const refreshed = await f.client.query(api.platform.agentUsers.list, { paginationOpts: { numItems: 1, cursor: null, endCursor: cursor } });
  expect(refreshed?.page.map(row => row.id)).toEqual([target._id]);
  await expect(f.t.query(components.betterAuth.appOperators.listDirectory, {
    operatorId: target._id, paginationOpts: { numItems: 1, cursor },
  })).rejects.toThrow("OPERATOR_DIRECTORY_CURSOR_INVALID");
  for (const changed of [{ search: "target" }, { status: "active" as const }, { emailVerified: true }, { sortDirection: "asc" as const }]) {
    await expect(f.client.query(api.platform.agentUsers.list, { ...changed, paginationOpts: { numItems: 1, cursor } })).rejects.toThrow("OPERATOR_DIRECTORY_CURSOR_INVALID");
  }
  const tampered = JSON.parse(cursor) as { version: number; binding: string; cursor: string };
  tampered.cursor = JSON.stringify(["admin", 10, 0, "not-a-user"]);
  await expect(f.client.query(api.platform.agentUsers.list, { paginationOpts: { numItems: 1, cursor: JSON.stringify(tampered) } })).rejects.toThrow("OPERATOR_DIRECTORY_CURSOR_INVALID");
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    userId: target._id, organizationId: "orphan", role: "member", createdAt: 1,
  } } });
  for (const paginationOpts of [{ numItems: 1, cursor }, { numItems: 1, cursor: null, endCursor: cursor }]) {
    await expect(f.client.query(api.platform.agentUsers.list, { paginationOpts })).rejects.toThrow("OPERATOR_DIRECTORY_CURSOR_INVALID");
  }
});

test("captured-range replay preserves newly inserted operators beyond numItems and still enforces work limits", async () => {
  const f = await fixture();
  const anchor = await f.user("range-anchor", { createdAt: 10 });
  const first = await f.client.query(api.platform.agentUsers.list, { paginationOpts: { numItems: 1, cursor: null } });
  const inserted: string[] = [];
  for (let i = 0; i < 148; i++) inserted.push((await f.user(`range-${i}`, { createdAt: 20 + i }))._id);
  const result = await f.client.query(api.platform.agentUsers.list, {
    paginationOpts: { numItems: 1, cursor: null, endCursor: first!.continueCursor },
  });
  expect(result?.page.map(row => row.id)).toEqual([...inserted].reverse().concat(anchor._id));
  expect(result?.page).toHaveLength(149);
  expect(result).not.toHaveProperty("splitCursor");
  await expect(f.client.query(api.platform.agentUsers.list, {
    paginationOpts: { numItems: 1, cursor: null, maximumBytesRead: 1 },
  })).rejects.toThrow("OPERATOR_DIRECTORY_SCAN_LIMIT");
});

test("bounded role scan fails closed over 200 mixed records; actor removal denies direct and native reads", async () => {
  const f = await fixture();
  for (let i = 0; i < 200; i++) await f.user(`mixed-${i}`, { createdAt: 10 + i, customerAdmission: "quarantined" });
  const args = { paginationOpts: { numItems: 1, cursor: null } };
  await expect(f.client.query(api.platform.agentUsers.list, args)).rejects.toThrow("OPERATOR_DIRECTORY_SCAN_LIMIT");
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    userId: f.actor._id, organizationId: "orphan", role: "member", createdAt: 1,
  } } });
  await expect(f.client.query(api.platform.agentUsers.list, args)).rejects.toThrow("NOT_ADMIN");
  await expect(f.client.run(ctx => runCapability(ctx, { user: f.actor }, "admins_listProtected", {}, false))).rejects.toThrow("NOT_ADMIN");
});

test("100 distinct passkey targets keep complete ordered results and both native privacy passes bounded", async () => {
  const f = await fixture();
  const userIds: string[] = [], expected: string[] = [];
  for (let i = 0; i < 100; i++) {
    const user = await f.user(`passkey-target-${i}`, { banned: i === 0 });
    userIds.push(user._id);
    if (i % 3 === 0) {
      expected.push(user._id);
      await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
        userId: user._id, publicKey: "must-not-leave-component", credentialID: `private-${i}`,
        name: "Private factor", counter: 0, deviceType: "singleDevice", backedUp: false,
      } } });
    }
  }
  const args = { userIds };
  expect(await f.client.query(api.platform.adminAuth.listAdminPasskeyUserIds, args)).toEqual(expected);
  const native = await f.client.run(async ctx => {
    const runQuery = vi.fn(ctx.runQuery);
    const result = await runCapability({ ...ctx, runQuery }, { user: f.actor }, "security_listAdminPasskeyUserIds", args, false);
    const targetCalls = runQuery.mock.calls.filter(([, input]) => Array.isArray((input as { userIds?: unknown }).userIds));
    expect(targetCalls).toHaveLength(2); // Independent native policy and guarded body.
    expect(runQuery.mock.calls.length).toBeLessThan(60);
    return result;
  });
  expect(native).toEqual(expected);
  expect(JSON.stringify(native)).not.toContain("private-");
});

test("passkey batches preserve first-occurrence order, empty results and original input-size bounds", async () => {
  const f = await fixture();
  const target = await f.user("passkey-duplicate");
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
    userId: target._id, publicKey: "private", credentialID: "private-duplicate", counter: 0,
    deviceType: "singleDevice", backedUp: false,
  } } });
  for (const userIds of [[], Array<string>(100).fill(target._id), [f.actor._id, target._id, f.actor._id, target._id]]) {
    const expected = userIds.length ? [target._id] : [];
    expect(await f.client.query(api.platform.adminAuth.listAdminPasskeyUserIds, { userIds })).toEqual(expected);
    expect(await f.client.run(ctx => runCapability(ctx, { user: f.actor }, "security_listAdminPasskeyUserIds", { userIds }, false))).toEqual(expected);
  }
  const userIds = Array<string>(101).fill(target._id);
  await expect(f.client.query(api.platform.adminAuth.listAdminPasskeyUserIds, { userIds })).rejects.toThrow("INVALID_PAGE_SIZE");
  await expect(f.client.run(ctx => runCapability(ctx, { user: f.actor }, "security_listAdminPasskeyUserIds", { userIds }, false))).rejects.toThrow("BATCH_TOO_LARGE");
  await expect(f.t.query(components.betterAuth.appOperators.validateTargets, { userIds })).rejects.toThrow("INVALID_PAGE_SIZE");
  await expect(f.t.query(components.betterAuth.appOperators.listPasskeyUserIds, { operatorId: f.actor._id, userIds })).rejects.toThrow("INVALID_PAGE_SIZE");
});

test("passkey status denies every mixed or missing target even at the end of a full request", async () => {
  const f = await fixture();
  const customer = await f.user("passkey-customer", { role: "user" });
  const admitted = await f.user("passkey-admitted", { customerAdmission: "historical" });
  const member = await f.user("passkey-member");
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    userId: member._id, organizationId: "historical-orphan", role: "member", createdAt: 1,
  } } });
  const owner = await f.user("passkey-owner");
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "organization", data: {
    name: "Historical owner", slug: "passkey-owner", createdAt: 1, personalOwnerId: owner._id,
  } } });
  const removed = await f.user("passkey-deleted");
  await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "user", where: [{ field: "_id", value: removed._id }] } });
  for (const target of [customer._id, admitted._id, member._id, owner._id, removed._id, "not-a-user-id"]) {
    const userIds = [...Array<string>(99).fill(f.actor._id), target];
    await expect(f.client.query(api.platform.adminAuth.listAdminPasskeyUserIds, { userIds })).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    await expect(f.client.run(ctx => runCapability(ctx, { user: f.actor }, "security_listAdminPasskeyUserIds", { userIds }, false))).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
  }
});

test("passkey presence component rechecks actor identity and native execution rejects revoked authority", async () => {
  const f = await fixture();
  const target = await f.user("passkey-actor-target");
  const banned = await f.user("passkey-banned-actor", { banned: true });
  const customer = await f.user("passkey-customer-actor", { role: "user" });
  for (const operatorId of [banned._id, customer._id, "missing-actor"]) {
    await expect(f.t.query(components.betterAuth.appOperators.listPasskeyUserIds, { operatorId, userIds: [target._id] })).rejects.toThrow("NOT_ADMIN");
  }
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    userId: f.actor._id, organizationId: "orphan", role: "admin", createdAt: 1,
  } } });
  await expect(f.client.query(api.platform.adminAuth.listAdminPasskeyUserIds, { userIds: [target._id] })).rejects.toThrow("NOT_ADMIN");
  await expect(f.client.run(ctx => runCapability(ctx, { user: f.actor }, "security_listAdminPasskeyUserIds", { userIds: [target._id] }, false))).rejects.toThrow("NOT_ADMIN");
});
