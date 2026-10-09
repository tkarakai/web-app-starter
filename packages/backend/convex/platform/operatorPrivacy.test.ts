import { invokeNative } from "./agentNativePolicy";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "../_generated/api";
import { modules } from "../test.modules";
import { createPrivateResourceTestEnv } from "./privateResources.test-helpers";
import type { Doc } from "./betterAuth/_generated/dataModel";
import authSchema from "./betterAuth/schema";
import * as users from "./agentUsers";
import * as adminAuth from "./adminAuth";
import * as audit from "./auditTrail";
import { classifyNative, nativeDefinition } from "./nativeCapabilities";
import { captureDelegation } from "./agentProof";
import { AGENT_CONTRACT_EPOCH } from "./agentContract";
import { APP_OPERATOR_AUDIT_SOURCE } from "./auditPrivacy";

const authModules = import.meta.glob("./betterAuth/**/*.*s");
const paginationOpts = { numItems: 100, cursor: null };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function fixture() {
  const t = createPrivateResourceTestEnv(modules);
  t.registerComponent("betterAuth", authSchema, authModules);
  async function identity(name: string, role = "user", customerAdmission?: string) {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name, email: `${name}@example.test`, role, customerAdmission,
      emailVerified: true, createdAt: now, updatedAt: now,
    } } });
    const account = await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
      userId: user._id, accountId: user._id, providerId: "credential", password: `preserved-password:${name}`, createdAt: now, updatedAt: now,
    } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: user._id, token: `private-session-token:${name}`, createdAt: now, updatedAt: now, expiresAt: now + 60 * 60_000,
      assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
    } } });
    const client = t.withIdentity({ subject: user._id, sessionId: session._id });
    return { user: user as Doc<"user">, session: session as Doc<"session">, account, client };
  }
  async function organization(user: Doc<"user">) {
    if (user.role === "admin") {
      // Deliberately mixed authority: a historical operator also has a customer
      // membership. Do not fabricate a new personal org for that operator.
      const member = await t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
        userId: user._id, organizationId: customerOrg.row._id, role: "member", createdAt: Date.now(),
      } } });
      return { row: customerOrg.row, member };
    }
    const personal = await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: user._id });
    const row = await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "organization", where: [{ field: "_id", value: personal.organizationId }], update: {
      name: "Private customer organization", metadata: '{"private":"customer-metadata"}',
    } } });
    const member = await t.query(components.betterAuth.adapter.findOne, { model: "member", where: [{ field: "_id", value: personal.memberId }] });
    return { row: row!, member: member! };
  }
  const operator = await identity("operator", "admin");
  const other = await identity("other-operator", "admin");
  const customer = await identity("customer", "user", "public-signup");
  const customerOrg = await organization(customer.user);
  return { t, identity, organization, operator, other, customer, customerOrg };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Identity = Fixture["operator"];

/** Execute the actual captured body, deliberately skipping both wrapper and dispatch guards. */
function captured(f: Fixture, fn: object, actor: Identity, args: unknown, patch: Record<string, unknown> = {}) {
  return f.t.run(ctx => nativeDefinition(fn).handler({
    ...ctx, user: actor.user, session: actor.session, ownerId: actor.user._id,
    assurance: { scope: "admin", securityScope: "admin", allowed: true, recent: true }, ...patch,
  }, args));
}

async function storedIdentity(f: Fixture, identity: Identity) {
  const rows: Record<string, unknown> = {};
  for (const model of ["user", "account", "session", "twoFactor", "passkey"] as const) {
    rows[model] = (await f.t.query(components.betterAuth.adapter.findMany, {
      model, where: [{ field: model === "user" ? "_id" : "userId", value: identity.user._id }], paginationOpts,
    })).page;
  }
  return rows;
}

describe("app-operator identity and organization-user privacy in direct and captured handlers", () => {
  test("directory returns canonical operators only; reserved email and mixed identities confer no authority", async () => {
    const f = await fixture();
    await f.t.mutation(components.platform.adminEmails.ensure, { email: f.customer.user.email });
    await f.identity("mixed-admission", "admin", "public-signup");
    const mixed = await f.identity("mixed-membership", "admin");
    await f.organization(mixed.user);
    const args = { paginationOpts };
    const direct = await f.operator.client.query(api.platform.agentUsers.list, args);
    const native = await captured(f, users.list, f.operator, args);
    for (const result of [direct, native]) {
      expect(result).toMatchObject({ page: expect.any(Array) });
      expect((result as NonNullable<typeof direct>).page.map(row => row.id).sort()).toEqual([f.operator.user._id, f.other.user._id].sort());
      expect(JSON.stringify(result)).not.toContain(f.customer.user.email);
      expect(JSON.stringify(result)).not.toContain("mixed-");
    }
    expect(await f.operator.client.query(api.platform.agentUsers.list, { ...args, role: "user" })).toMatchObject({ page: [], isDone: true });
    expect(await captured(f, users.list, f.operator, { ...args, role: "user" })).toMatchObject({ page: [], isDone: true });
    await expect(f.operator.client.query(api.platform.agentUsers.list, { ...args, sortBy: "email" })).rejects.toThrow("UNSUPPORTED_OPERATOR_SORT");
  });

  test.each(["direct", "captured"] as const)("%s cannot read or mutate any organization-user identity/session target", async mode => {
    const f = await fixture();
    await f.t.mutation(components.platform.adminEmails.ensure, { email: f.customer.user.email });
    const before = await storedIdentity(f, f.customer);
    const userId = f.customer.user._id;
    const operations = [
      [users.get, api.platform.agentUsers.get, { userId }, "query"],
      [users.sessions, api.platform.agentUsers.sessions, { userId, paginationOpts }, "query"],
      [users.ban, api.platform.agentUsers.ban, { userId, reason: "no" }, "mutation"],
      [users.unban, api.platform.agentUsers.unban, { userId }, "mutation"],
      [users.setRole, api.platform.agentUsers.setRole, { userId, role: "admin" }, "mutation"],
      [users.update, api.platform.agentUsers.update, { userId, name: "Do not change", image: null }, "mutation"],
      [users.remove, api.platform.agentUsers.remove, { userId }, "mutation"],
      [users.revokeSession, api.platform.agentUsers.revokeSession, { userId, sessionId: f.customer.session._id }, "mutation"],
      [users.revokeSessions, api.platform.agentUsers.revokeSessions, { userId }, "mutation"],
    ] as const;
    for (const [fn, ref, args, kind] of operations) {
      const result = mode === "captured" ? captured(f, fn, f.operator, args)
        : kind === "query" ? f.operator.client.query(ref, args) : f.operator.client.mutation(ref, args);
      await expect(result).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    }
    expect(await storedIdentity(f, f.customer)).toEqual(before);
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "member", where: [{ field: "_id", value: f.customerOrg.member._id }] })).toEqual(f.customerOrg.member);
  });

  test("operator-directory pagination hides mixed organization-user IDs in rows, continuation and split cursors", async () => {
    const f = await fixture();
    const mixed = await f.identity("mixed-directory", "admin", "public-signup");
    const seen: string[] = [];
    let cursor: string | null = null;
    let done = false;
    for (let i = 0; i < 6 && !done; i++) {
      const result = await f.operator.client.query(api.platform.agentUsers.list, { paginationOpts: { numItems: 1, cursor } });
      expect(result).not.toBeNull();
      expect(JSON.stringify(result)).not.toContain(mixed.user._id);
      expect(JSON.stringify(result)).not.toContain(f.customer.user._id);
      seen.push(...result!.page.map(row => row.id));
      cursor = result!.continueCursor;
      done = result!.isDone;
    }
    expect(done).toBe(true);
    expect(seen.sort()).toEqual([f.operator.user._id, f.other.user._id].sort());
  });

  test.each(["direct", "captured"] as const)("%s retained operator APIs still update, ban/unban and revoke operator sessions", async mode => {
    const f = await fixture();
    const userId = f.other.user._id;
    const call = async (operation: "update" | "ban" | "unban" | "revokeSession" | "revokeSessions", args: unknown) => {
      if (mode === "captured") return captured(f, users[operation], f.operator, args);
      if (operation === "update") return f.operator.client.mutation(api.platform.agentUsers.update, args as { userId: string; name: string });
      if (operation === "ban") return f.operator.client.mutation(api.platform.agentUsers.ban, args as { userId: string });
      if (operation === "unban") return f.operator.client.mutation(api.platform.agentUsers.unban, args as { userId: string });
      if (operation === "revokeSession") return f.operator.client.mutation(api.platform.agentUsers.revokeSession, args as { userId: string; sessionId: string });
      return f.operator.client.mutation(api.platform.agentUsers.revokeSessions, args as { userId: string });
    };
    await call("update", { userId, name: "Updated operator" });
    expect(await f.operator.client.query(api.platform.agentUsers.get, { userId })).toMatchObject({ id: userId, name: "Updated operator", role: "admin" });
    const sessions = await f.operator.client.query(api.platform.agentUsers.sessions, { userId, paginationOpts });
    expect(sessions?.page.map(row => row.id)).toEqual([f.other.session._id]);
    expect(JSON.stringify(sessions)).not.toContain(f.other.session.token);
    await call("revokeSession", { userId, sessionId: f.other.session._id });
    expect(await f.operator.client.query(api.platform.agentUsers.sessions, { userId, paginationOpts })).toMatchObject({ page: [] });
    await call("ban", { userId, reason: "operator containment" });
    expect(await f.operator.client.query(api.platform.agentUsers.get, { userId })).toMatchObject({ banned: true });
    await call("unban", { userId });
    expect(await f.operator.client.query(api.platform.agentUsers.get, { userId })).toMatchObject({ banned: false });
    await call("revokeSessions", { userId });
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "_id", value: f.other.account._id }] })).toEqual(f.other.account);
    expect(await storedIdentity(f, f.customer)).toMatchObject({ user: [f.customer.user], session: [f.customer.session] });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("promotion/demotion is unsupported and the already-admin role is a state-preserving no-op", async () => {
    const f = await fixture();
    const before = await storedIdentity(f, f.other);
    await expect(f.operator.client.mutation(api.platform.agentUsers.setRole, { userId: f.other.user._id, role: "user" })).rejects.toThrow("OPERATOR_ROLE_TRANSITION_UNSUPPORTED");
    await expect(captured(f, users.setRole, f.operator, { userId: f.other.user._id, role: "user" })).rejects.toThrow("OPERATOR_ROLE_TRANSITION_UNSUPPORTED");
    await f.operator.client.mutation(api.platform.agentUsers.setRole, { userId: f.other.user._id, role: "admin" });
    await captured(f, users.setRole, f.operator, { userId: f.other.user._id, role: "admin" });
    expect(await storedIdentity(f, f.other)).toEqual(before);
  });

  test("deletion preserves legacy private ownership, credentials, factors and sessions pending a reviewed mapping", async () => {
    const f = await fixture();
    const project = await f.t.run(ctx => ctx.db.insert("securityTestPrivateResources", {
      name: "Legacy operator private data", description: "Preserve", ownerId: f.other.user._id, createdAt: Date.now(),
    }));
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: { userId: f.other.user._id, secret: "private-secret", backupCodes: "private-recovery", verified: true } } });
    const before = await storedIdentity(f, f.other);
    await expect(f.operator.client.mutation(api.platform.agentUsers.remove, { userId: f.other.user._id })).rejects.toThrow("OPERATOR_DELETION_REQUIRES_REVIEWED_MAPPING");
    await expect(captured(f, users.remove, f.operator, { userId: f.other.user._id })).rejects.toThrow("OPERATOR_DELETION_REQUIRES_REVIEWED_MAPPING");
    expect(await storedIdentity(f, f.other)).toEqual(before);
    expect(await f.t.run(ctx => ctx.db.get(project))).toMatchObject({ ownerId: f.other.user._id, name: "Legacy operator private data" });
  });

  test("parent org-admin security scope, a forged global role and reserved email cannot authorize a captured body", async () => {
    const f = await fixture();
    await f.t.mutation(components.platform.adminEmails.ensure, { email: f.customer.user.email });
    const forged = { user: { ...f.customer.user, role: "admin" }, assurance: { allowed: true, scope: "admin", securityScope: "admin", recent: true } };
    await expect(captured(f, users.get, f.customer, { userId: f.other.user._id }, forged)).rejects.toThrow("NOT_ADMIN");
    await expect(captured(f, users.update, f.customer, { userId: f.other.user._id, name: "Forbidden" }, forged)).rejects.toThrow("NOT_ADMIN");
    await expect(captured(f, adminAuth.setMfaPolicy, f.customer, { required: true }, forged)).rejects.toThrow("NOT_ADMIN");
    await expect(f.customer.client.query(api.platform.agentUsers.get, { userId: f.other.user._id })).rejects.toThrow("NOT_ADMIN");
  });

  test.each(["demote", "ban", "revoke-session", "customer-membership"] as const)("captured handlers recheck a live %s change after discovery", async change => {
    const f = await fixture();
    if (change === "demote") await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: f.operator.user._id }], update: { role: "user" } } });
    if (change === "ban") await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: f.operator.user._id }], update: { banned: true } } });
    if (change === "revoke-session") await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: f.operator.session._id }] } });
    if (change === "customer-membership") await f.organization(f.operator.user);
    await expect(captured(f, users.get, f.operator, { userId: f.other.user._id })).rejects.toThrow(/NOT_ADMIN|NOT_AUTHENTICATED/);
    await expect(captured(f, users.update, f.operator, { userId: f.other.user._id, name: "Forbidden" })).rejects.toThrow(/NOT_ADMIN|NOT_AUTHENTICATED/);
    expect(await f.other.client.query(api.platform.auth.getCurrentUser, {})).toMatchObject({ name: "other-operator" });
  });

  test("captured writes ignore injected recent flags and reread persisted proof; stale reads still work", async () => {
    const f = await fixture();
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await expect(captured(f, users.update, f.operator, { userId: f.other.user._id, name: "Forbidden" })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    await expect(captured(f, adminAuth.setEmailVerificationPolicy, f.operator, { required: false })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    await expect(f.operator.client.mutation(api.platform.agentUsers.update, { userId: f.other.user._id, name: "Forbidden" })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    expect(await captured(f, users.get, f.operator, { userId: f.other.user._id })).toMatchObject({ name: "other-operator" });
  });

  test("native dispatch agrees with direct APIs while captured bodies remain independently guarded", async () => {
    const f = await fixture();
    classifyNative(users.get, "platform/agentUsers:get");
    classifyNative(users.update, "platform/agentUsers:update");
    const auth = { user: f.operator.user, session: f.operator.session, ownerId: f.operator.user._id, assurance: { recent: true } };
    expect(await f.operator.client.run(ctx => invokeNative(users.get, ctx, auth, { userId: f.other.user._id }))).toEqual(await f.operator.client.query(api.platform.agentUsers.get, { userId: f.other.user._id }));
    await expect(f.operator.client.run(ctx => invokeNative(users.get, ctx, auth, { userId: f.customer.user._id }))).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await expect(f.operator.client.run(ctx => invokeNative(users.update, ctx, auth, { userId: f.other.user._id, name: "Forbidden" }))).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
  });

  test("stored delegation proof supports captured writes and rejects revoked grants, fingerprint changes and stale injected proof", async () => {
    const f = await fixture();
    const grantId = await f.t.run(async ctx => {
      const delegationId = await captureDelegation(ctx, { user: f.operator.user, session: f.operator.session });
      return ctx.db.insert("agentGrants", { contractEpoch: AGENT_CONTRACT_EPOCH, userId: f.operator.user._id, delegationId,
        tokenHash: "never-a-raw-token", clientId: "test", resource: "http://localhost:3001/api/mcp", scope: "admin:manage",
        expiresAt: Date.now() + 15 * 60_000, createdAt: Date.now(),
      });
    });
    await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: f.operator.session._id }] } });
    const patch = { grantId, session: { ...f.operator.session, _id: undefined } };
    await captured(f, users.update, f.operator, { userId: f.other.user._id, name: "Delegated update" }, patch);
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await expect(captured(f, users.update, f.operator, { userId: f.other.user._id, name: "Forbidden" }, patch)).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    vi.setSystemTime(f.operator.session.createdAt + 1);
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "account", where: [{ field: "_id", value: f.operator.account._id }], update: { password: "changed-fingerprint" } } });
    await expect(captured(f, users.get, f.operator, { userId: f.other.user._id }, patch)).rejects.toThrow("NOT_AUTHENTICATED");
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "account", where: [{ field: "_id", value: f.operator.account._id }], update: { password: f.operator.account.password } } });
    await f.t.run(ctx => ctx.db.patch(grantId, { revokedAt: Date.now() }));
    await expect(captured(f, users.get, f.operator, { userId: f.other.user._id }, patch)).rejects.toThrow("NOT_AUTHENTICATED");
  });
});

describe("app-operator security directory and audit projection", () => {
  test("passkey status validates all targets and exposes only operator enrollment, without factor material", async () => {
    const f = await fixture();
    for (const subject of [f.other, f.customer]) await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: subject.user._id, publicKey: "private-public-key", credentialID: `private-credential:${subject.user._id}`,
      name: "Private factor name", counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    for (const userIds of [[f.customer.user._id], [f.other.user._id, f.customer.user._id]]) {
      await expect(f.operator.client.query(api.platform.adminAuth.listAdminPasskeyUserIds, { userIds })).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
      await expect(captured(f, adminAuth.listAdminPasskeyUserIds, f.operator, { userIds })).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    }
    const args = { userIds: [f.other.user._id, f.operator.user._id, f.other.user._id] };
    expect(await f.operator.client.query(api.platform.adminAuth.listAdminPasskeyUserIds, args)).toEqual([f.other.user._id]);
    expect(await captured(f, adminAuth.listAdminPasskeyUserIds, f.operator, args)).toEqual([f.other.user._id]);
    await expect(captured(f, adminAuth.listAdminPasskeyUserIds, f.customer, args)).rejects.toThrow("NOT_ADMIN");
  });

  test("new organization-user auth, unclassified historical rows and client-forged classifications remain stored and private", async () => {
    const f = await fixture();
    const blob = JSON.stringify({ customer: f.customer.user.email, secret: "private-history" });
    const original = { authenticatedUserId: f.customer.user._id, actor: f.customer.user.email, action: "auth.sign_in", resource: `session:${f.customer.session._id}`, status: "succeeded", meta: blob, oldValue: blob, newValue: blob, reason: blob };
    await f.t.mutation(internal.platform.auditTrail.insertEvent, { ...original, sourceDetail: "auth-hook" });
    await f.t.mutation(components.platform.auditTrail.insertEvent, { ...original, source: "server:auth-hook" });
    await f.t.mutation(components.platform.auditTrail.insertEvent, { ...original, authenticatedUserId: f.operator.user._id, actor: f.operator.user.email, source: "server:auth-hook" });
    await f.customer.client.mutation(api.platform.auditTrail.postEvent, {
      action: "auth.sign_in", resource: "operator:forged", happenedAt: Date.now(), sourceDetail: "operator-audit:v1", meta: blob,
    });
    await f.operator.client.mutation(api.platform.auditTrail.postEvent, {
      action: "auth.sign_in", resource: "operator:forged", happenedAt: Date.now(), sourceDetail: "operator-audit:v1", meta: blob,
    });
    const safe = { authenticatedUserId: f.operator.user._id, actor: f.customer.user.email, sourceDetail: "auth-hook", action: "auth.sign_in", resource: `user:${f.customer.user._id}`, status: "succeeded", meta: blob, oldValue: blob, newValue: blob, reason: blob };
    await f.t.mutation(internal.platform.auditTrail.insertEvent, safe);
    const all = await f.t.query(components.platform.auditTrail.list, { paginationOpts });
    expect(all.page).toHaveLength(6);
    expect(all.page.filter(row => row.meta === blob)).toHaveLength(6);
    const args = { paginationOpts };
    const direct = await f.operator.client.query(api.platform.auditTrail.list, args);
    const native = await captured(f, audit.list, f.operator, args);
    expect(native).toEqual(direct);
    expect(direct.page).toHaveLength(1);
    expect(direct.page[0]).toMatchObject({ actor: f.operator.user.email, resource: `operator:${f.operator.user._id}`, source: APP_OPERATOR_AUDIT_SOURCE });
    expect(direct.page[0].meta).toBeUndefined();
    expect(direct.page[0].reason).toBeUndefined();
    expect(direct.page[0].oldValue).toBeUndefined();
    expect(direct.page[0].newValue).toBeUndefined();
    expect(JSON.stringify(direct)).not.toContain(f.customer.user._id);
    expect(JSON.stringify(direct)).not.toContain(f.customer.user.email);
    expect(JSON.stringify(direct)).not.toContain("private-history");
    expect((await f.customer.client.query(api.platform.auditTrail.list, args)).page).toEqual([]);
    expect(await captured(f, audit.list, f.customer, args, { user: { ...f.customer.user, role: "admin" } })).toMatchObject({ page: [] });
  });

  test("audit filters and pagination never select organization-user indexes or recover a historical event", async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) {
      await f.t.mutation(internal.platform.auditTrail.insertEvent, {
        happenedAt: 10 + i, authenticatedUserId: f.operator.user._id, actor: f.operator.user.email, sourceDetail: "auth-hook", action: "auth.sign_in", resource: "session:operator", status: "succeeded",
      });
      await f.t.mutation(internal.platform.auditTrail.insertEvent, {
        happenedAt: 100 + i, authenticatedUserId: f.customer.user._id, actor: f.customer.user.email, sourceDetail: "auth-hook", action: "auth.sign_in", resource: "session:customer", status: "succeeded",
      });
    }
    let cursor: string | null = null;
    let done = false;
    const times: number[] = [];
    for (let i = 0; i < 5 && !done; i++) {
      const page = await f.operator.client.query(api.platform.auditTrail.list, { paginationOpts: { numItems: 1, cursor } });
      times.push(...page.page.map(row => row.happenedAt));
      expect(JSON.stringify(page)).not.toContain(f.customer.user.email);
      expect(JSON.stringify(page)).not.toContain(f.customer.user._id);
      cursor = page.continueCursor;
      done = page.isDone;
    }
    expect(done).toBe(true);
    expect(times).toEqual([12, 11, 10]);
    for (const filter of [{ filterActor: f.customer.user.email }, { filterAuthenticatedUserId: f.customer.user._id }, { filterSource: "server:auth-hook" }]) {
      expect(await f.operator.client.query(api.platform.auditTrail.list, { paginationOpts, ...filter })).toMatchObject({ page: [] });
    }
    const privatePage = await f.t.query(components.platform.auditTrail.list, {
      paginationOpts: { numItems: 1, cursor: null }, filterActor: f.customer.user.email,
    });
    // A cursor retained from the former global log cannot redirect the fixed operator source index.
    const resumed = await f.operator.client.query(api.platform.auditTrail.list, { paginationOpts: { numItems: 1, cursor: privatePage.continueCursor } });
    expect(JSON.stringify(resumed)).not.toContain(f.customer.user.email);
    expect(JSON.stringify(resumed)).not.toContain(f.customer.user._id);
  });

  test("organization control audit exposes only the validated control resource and lifecycle state", async () => {
    const f = await fixture();
    await f.operator.client.mutation(api.platform.organizations.setLifecycle, { organizationId: f.customerOrg.row._id, lifecycle: "disabled" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const result = await f.operator.client.query(api.platform.auditTrail.list, { paginationOpts });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({ action: "admin.organization.lifecycle_changed", source: APP_OPERATOR_AUDIT_SOURCE,
      resource: `organization:${f.customerOrg.row._id}`, newValue: "disabled", actor: f.operator.user.email });
    expect(result.page[0].meta).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(f.customer.user._id);
    expect(JSON.stringify(result)).not.toContain(f.customer.user.email);
    expect(JSON.stringify(result)).not.toContain("customer-metadata");
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "_id", value: f.customerOrg.row._id }] })).toMatchObject({ lifecycle: "disabled", metadata: f.customerOrg.row.metadata });
  });
});
