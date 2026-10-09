import { invokeNative } from "./agentNativePolicy";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { createTestEnv, modules } from "../test.modules";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import authSchema from "./betterAuth/schema";
import { AGENT_CONTRACT_EPOCH } from "./agentContract";
import { authOperationExposure, exposureInventory, httpOperationExposure, operationExposure } from "./agentExposure";
import { catalogueRows, registeredExposures } from "./agentRegistry";
import { classifyNative, rememberNative } from "./nativeCapabilities";
import * as announcements from "./announcements";
import * as users from "./agentUsers";
import * as organizations from "./organizations";
import { authorizedSession } from "./sessionPolicy";
import { requireGrant } from "./agentAccess";
import { sha256Hex } from "./tokenHash";

const resource = "http://localhost:3001/api/mcp";
const verifier = "v".repeat(64);
const page = { numItems: 10, cursor: null };
async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const now = Date.now();
  async function identity(name: string, role: "admin" | "user") {
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name, email: `${name}@example.test`, emailVerified: true, role, createdAt: now, updatedAt: now } } });
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: { userId: user._id, accountId: user._id, providerId: "credential", password: "fixture-credential-hash", createdAt: now, updatedAt: now } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { userId: user._id, token: name, assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now, createdAt: now, updatedAt: now, expiresAt: now + 3600_000 } } });
    return { user, session, client: t.withIdentity({ subject: user._id, sessionId: session._id }) };
  }
  const operator = await identity("operator", "admin");
  const customer = await identity("customer", "user");
  const otherOperator = await identity("other-operator", "admin");
  await operator.client.mutation(api.platform.agentSurfaces.setEnabled, { surface: "mcp", enabled: true });
  await operator.client.mutation(api.platform.agentSurfaces.setEnabled, { surface: "a2a", enabled: true });
  async function mint(target = resource) {
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { userId: operator.user._id, token: crypto.randomUUID(), authPurpose: "mcp-authorization", assuranceVersion: 1, authMethod: "password", authenticatedAt: Date.now(), primaryVerifiedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 3600_000 } } });
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(verifier))).toString("base64url");
    const request = { clientId: "pi-announcements", redirectUri: "http://127.0.0.1:45991/callback", resource: target, challenge, scope: "admin:manage" };
    const consent = t.withIdentity({ subject: operator.user._id, sessionId: session._id });
    const { code } = await consent.mutation(api.platform.agentAccess.authorize, request);
    const exchange = { code, verifier, clientId: request.clientId, redirectUri: request.redirectUri, resource: target };
    const grant = await t.mutation(api.platform.agentAccess.exchange, exchange);
    return { token: grant.access_token, resource: target };
  }
  async function membershipManagedOrganization() {
    const organization = await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: customer.user._id });
    const bound = { organizationId: organization.organizationId, userId: customer.user._id };
    await t.mutation(components.betterAuth.organizations.beginMembershipManagement, { ...bound, name: "Customer organization", slug: "customer-organization" });
    const factor = await t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: { userId: customer.user._id, secret: "SECRET_CUSTOMER_FACTOR", backupCodes: "SECRET_CUSTOMER_RECOVERY", verified: true } } });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: customer.user._id }], update: { twoFactorEnabled: true } } });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: customer.session._id }], update: { strongVerifiedAt: now, strongFactorId: factor._id, strongFactorType: "totp" } } });
    await t.mutation(components.betterAuth.organizations.recordPasswordProof, { ...bound, credentialProof: sha256Hex("fixture-credential-hash") });
    await t.mutation(components.betterAuth.organizations.acknowledgeRecovery, { ...bound, factorId: factor._id, backupCodesProof: sha256Hex("SECRET_CUSTOMER_RECOVERY") });
    await t.mutation(components.betterAuth.organizations.completeEnrollment, { ...bound, requirePasskey: false });
    return organization;
  }
  return { t, operator, customer, otherOperator, mint, identity, membershipManagedOrganization };
}

describe("Stage 1 executable exposure and independent native policy BEHAVIOR", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("AGENT_MCP_RESOURCE", resource); vi.stubEnv("AGENT_MCP_AUTH_ORIGIN", "http://mcp-auth.localhost:3001"); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  test("classifies runtime registered public APIs and reports dispatch's same inventory", async () => {
    // Inspect real registered definitions, not source text or a test-only catalogue.
    const missing: string[] = [];
    for (const [path, load] of Object.entries(modules)) {
      if (path.includes("/_generated/") || path.includes(".test.") || path.includes(".config.") || path.startsWith("./platform/betterAuth/")) continue;
      const exports = await load() as Record<string, { isPublic?: boolean; isQuery?: boolean; isMutation?: boolean; isAction?: boolean }>;
      for (const [name, fn] of Object.entries(exports)) {
        if (!fn?.isPublic || !(fn.isQuery || fn.isMutation || fn.isAction)) continue;
        const operation = `${path.slice(2).replace(/\.ts$/, "")}:${name}`;
        if (operationExposure(operation).classification === "internal-denied") missing.push(operation);
      }
    }
    expect(missing).toEqual([]);
    const f = await fixture(); const auth = await f.mint();
    const report = await f.t.query(makeFunctionReference<"query">("platform/agentCapabilities:exposure"), auth);
    expect(report).toMatchObject({ contractEpoch: AGENT_CONTRACT_EPOCH, operations: exposureInventory(), capabilities: registeredExposures(), unknown: { classification: "internal-denied", native: false } });
    expect(catalogueRows().map(row => row.name)).toEqual(expect.arrayContaining(["organizations_list", "organizations_get", "organizations_setLifecycle"]));
    expect(catalogueRows().map(row => row.name)).not.toEqual(expect.arrayContaining(["users_setPassword"]));
    for (const row of registeredExposures()) if (row.native) expect(["operator-control", "operator-identity", "self-service"]).toContain(row.classification);
    expect(authOperationExposure("/admin/list-users")).toMatchObject({ classification: "operator-identity", target: "operator-list" });
    expect(httpOperationExposure("POST", "/api/auth/admin/list-users")).toMatchObject({ direct: "denied", native: false });
    expect(httpOperationExposure("POST", "/unknown-http-operation")).toMatchObject({ classification: "internal-denied", direct: "denied", native: false });
    expect(authOperationExposure("/admin/set-user-password")).toMatchObject({ classification: "internal-denied", native: false });
    for (const name of ["projects:list", "tenantProjects:list", "tenantTasks:listByProject", "tenantFiles:uploadFile", "platform/memberInvitations:accept"]) expect(operationExposure(name).native).toBe(false);
    expect(operationExposure("component/betterAuth/organizations:setLifecycle")).toMatchObject({ classification: "internal-denied", native: false });
  });

  test("capturing an unknown body grants no execution; forged role/assurance cannot authorize a customer", async () => {
    const f = await fixture(); const spy = vi.fn();
    const captured = rememberNative({}, { args: {}, handler: spy }, "query");
    await expect(f.operator.client.run(async ctx => invokeNative(captured, ctx, await authorizedSession(ctx), {}))).rejects.toThrow("NATIVE_OPERATION_DENIED");
    expect(spy).not.toHaveBeenCalled();
    await expect(f.customer.client.run(async ctx => {
      const auth = await authorizedSession(ctx);
      return invokeNative(announcements.list, ctx, { ...auth, user: { ...auth!.user, role: "admin" }, assurance: { allowed: true, recent: true, scope: "admin" } }, {});
    })).rejects.toThrow("NOT_ADMIN");
    await expect(f.customer.client.run(ctx => invokeNative(announcements.create, ctx, { user: f.operator.user, session: f.operator.session, assurance: { allowed: true, recent: true }, ownerId: f.operator.user._id }, { name: "Forged", bannerText: "Denied" }))).rejects.toThrow("NOT_ADMIN");
    expect(await f.operator.client.query(api.platform.announcements.list, {})).toHaveLength(0);
  });

  test("native queries re-read live authority and writes recheck recent proof", async () => {
    const f = await fixture(); const auth = await f.mint();
    const snapshot = await f.t.run(ctx => requireGrant(ctx, auth.token, auth.resource));
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(f.t.run(ctx => invokeNative(announcements.create, ctx, { ...snapshot, assurance: { ...snapshot.assurance, recent: true } }, { name: "Stale", bannerText: "Denied" }))).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    expect(await f.t.run(ctx => invokeNative(announcements.list, ctx, snapshot, {}))).toHaveLength(0);
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: f.operator.user._id }], update: { role: "user" } } });
    await expect(f.t.run(ctx => invokeNative(announcements.list, ctx, snapshot, {}))).rejects.toThrow("INVALID_AGENT_TOKEN");
  });

  test("app-operator identity targets obey direct/native parity, including known organization-user IDs", async () => {
    const f = await fixture(); const auth = await f.mint();
    const input = { userId: f.customer.user._id };
    await expect(f.operator.client.query(api.platform.agentUsers.get, input)).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    await expect(f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "users_get", input })).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    await expect(f.operator.client.run(async ctx => invokeNative(users.get, ctx, await authorizedSession(ctx), input))).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    const list = await f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "users_list", input: { paginationOpts: page } });
    expect(list.page.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining([f.operator.user._id, f.otherOperator.user._id]));
    expect(JSON.stringify(list)).not.toContain(f.customer.user.email);
    await f.t.mutation(components.platform.adminEmails.ensure, { email: f.customer.user.email });
    await f.t.mutation(components.platform.adminEmails.ensure, { email: f.operator.user.email });
    expect(await f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "admins_listProtected", input: {} })).toEqual([f.operator.user.email]);
    await expect(f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "security_listAdminPasskeyUserIds", input: { userIds: [f.customer.user._id] } })).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    const target = { userId: f.otherOperator.user._id };
    expect(await f.operator.client.query(api.platform.agentUsers.get, target)).toEqual(await f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "users_get", input: target }));
  });

  test("target policy executes before a captured body even when that body has no authorization", async () => {
    const f = await fixture(); const body = vi.fn(() => ({ executed: true }));
    const captured = rememberNative({}, { args: { userId: v.string() }, handler: body }, "query");
    classifyNative(captured, "platform/agentUsers:get");
    await expect(f.operator.client.run(async ctx => invokeNative(captured, ctx, await authorizedSession(ctx), { userId: f.customer.user._id }))).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    expect(body).not.toHaveBeenCalled();
    expect(await f.operator.client.run(async ctx => invokeNative(captured, ctx, await authorizedSession(ctx), { userId: f.otherOperator.user._id }))).toEqual({ executed: true });
    expect(body).toHaveBeenCalledOnce();
  });

  test("organization wrappers capture one immutable ID and reject organization-user dispatch", async () => {
    const f = await fixture(); const auth = await f.mint();
    const input = { organizationId: "unknown-org" };
    // Direct and captured paths use the same guarded canonical projection and errors.
    const direct = f.operator.client.query(makeFunctionReference<"query">("platform/organizations:get"), input);
    const native = f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "organizations_get", input });
    const [a, b] = await Promise.allSettled([direct, native]);
    expect(a.status).toBe(b.status);
    if (a.status === "fulfilled" && b.status === "fulfilled") expect(a.value).toEqual(b.value);
    if (a.status === "rejected" && b.status === "rejected") expect(a.reason.message).toBe(b.reason.message);
    await expect(f.customer.client.run(async ctx => invokeNative(organizations.get, ctx, await authorizedSession(ctx), input))).rejects.toThrow("NOT_ADMIN");
    await expect(f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "organizations_get", input: { organizationId: "unknown-org", activeOrganizationId: "redirect" } })).rejects.toThrow();
  });

  test("an enrolled org-admin with real recent strong proof remains an organization user; organization dispatch preserves target and DTO parity", async () => {
    const f = await fixture(); const auth = await f.mint(); const org = await f.membershipManagedOrganization();
    const member = await f.identity("private-member", "user");
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: { organizationId: org.organizationId, userId: member.user._id, role: "member", createdAt: Date.now() } } });
    const other = await f.identity("other-customer", "user");
    const otherOrg = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: other.user._id });
    expect(await f.t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: f.customer.user._id })).toMatchObject({ role: "org-admin", canManageMembers: true });
    const proof = await f.customer.client.run(ctx => authorizedSession(ctx));
    expect(proof).toMatchObject({ user: { role: "user" }, assurance: { allowed: true, recent: true, strong: true } });
    const input = { organizationId: org.organizationId };
    await expect(f.customer.client.query(makeFunctionReference<"query">("platform/organizations:get"), input)).rejects.toThrow("NOT_ADMIN");
    await expect(f.customer.client.run(ctx => invokeNative(organizations.get, ctx, { ...proof, user: { ...proof!.user, role: "admin" } }, input))).rejects.toThrow("NOT_ADMIN");
    const consentSession = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { userId: f.customer.user._id, token: "customer-authorization", authPurpose: "mcp-authorization", assuranceVersion: 1, authMethod: "password", authenticatedAt: Date.now(), primaryVerifiedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 3600_000, strongVerifiedAt: Date.now(), strongFactorId: proof!.session.strongFactorId, strongFactorType: "totp" } } });
    await expect(f.t.withIdentity({ subject: f.customer.user._id, sessionId: consentSession._id }).mutation(api.platform.agentAccess.authorize, { clientId: "pi-announcements", redirectUri: "http://127.0.0.1:45991/callback", resource, challenge: "c".repeat(43), scope: "admin:manage" })).rejects.toThrow("NOT_ADMIN");
    const direct = await f.operator.client.query(makeFunctionReference<"query">("platform/organizations:get"), input);
    const native = await f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "organizations_get", input });
    expect(native).toEqual(direct);
    expect(native).toMatchObject({ contacts: [{ name: f.customer.user.name, email: f.customer.user.email }] });
    expect(JSON.stringify(native)).not.toContain(member.user.email);
    expect(JSON.stringify(native)).not.toContain("SECRET_CUSTOMER");
    await f.t.mutation(api.platform.agentCapabilities.write, { ...auth, name: "organizations_setLifecycle", input: { ...input, lifecycle: "disabled" } });
    expect(await f.operator.client.query(makeFunctionReference<"query">("platform/organizations:get"), input)).toMatchObject({ organizationId: org.organizationId, lifecycle: "disabled" });
    expect(await f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "organizations_get", input: { organizationId: otherOrg.organizationId } })).toMatchObject({ lifecycle: "active" });
    await f.operator.client.mutation(makeFunctionReference<"mutation">("platform/organizations:setLifecycle"), { ...input, lifecycle: "active" });
    expect(await f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "organizations_get", input })).toEqual(direct);
  });

  test("mixed organization-user/app-operator records cannot retain app-operator execution or target disclosure", async () => {
    const f = await fixture(); const auth = await f.mint();
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: f.otherOperator.user._id }], update: { customerAdmission: "public-signup" } } });
    await expect(f.t.query(api.platform.agentCapabilities.read, { ...auth, name: "users_get", input: { userId: f.otherOperator.user._id } })).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: f.operator.user._id }], update: { customerAdmission: "public-signup" } } });
    await expect(f.t.query(api.platform.agentCapabilities.catalogue, auth)).rejects.toThrow("INVALID_AGENT_TOKEN");
    await expect(f.operator.client.run(async ctx => invokeNative(announcements.list, ctx, await authorizedSession(ctx), {}))).rejects.toThrow("NOT_ADMIN");
  });

  test("missing epochs invalidate broad codes/grants and delegation proof", async () => {
    const f = await fixture(); const auth = await f.mint();
    const row = await f.t.run(async ctx => ctx.db.query("agentGrants").withIndex("by_user", q => q.eq("userId", f.operator.user._id)).unique());
    await f.t.run(ctx => ctx.db.patch(row!._id, { contractEpoch: undefined }));
    await expect(f.t.query(api.platform.agentCapabilities.catalogue, auth)).rejects.toThrow("INVALID_AGENT_TOKEN");
    expect(await f.operator.client.query(api.platform.agentAccess.listMine, {})).toMatchObject([{ active: false }]);
    await f.t.run(async ctx => {
      await ctx.db.patch(row!._id, { contractEpoch: AGENT_CONTRACT_EPOCH });
      await ctx.db.patch(row!.delegationId!, { contractEpoch: undefined });
    });
    await expect(f.t.query(api.platform.agentCapabilities.catalogue, auth)).rejects.toThrow("INVALID_AGENT_TOKEN");
    const { credentialHash } = await import("./agentAccess");
    const legacyCode = "legacy-code";
    const codeHash = await credentialHash(legacyCode);
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(verifier))).toString("base64url");
    const code = await f.t.run(ctx => ctx.db.insert("agentAuthorizationCodes", { codeHash, generation: row!.generation, userId: row!.userId, delegationId: row!.delegationId, clientId: "pi-announcements", redirectUri: "http://127.0.0.1:45991/callback", resource, challenge, scope: "admin:manage", expiresAt: Date.now() + 60_000 }));
    await expect(f.t.mutation(api.platform.agentAccess.exchange, { code: legacyCode, verifier, clientId: "pi-announcements", redirectUri: "http://127.0.0.1:45991/callback", resource })).rejects.toThrow("INVALID_GRANT");
    expect(await f.t.run(ctx => ctx.db.get(code))).not.toBeNull();
  });

  test("fresh narrow grants cannot recover, count, replay, cancel or execute historical organization-user artifacts", async () => {
    const f = await fixture(); const a2a = resource.replace("/api/mcp", "/api/a2a"); const auth = await f.mint(a2a);
    const current = await f.t.run(ctx => requireGrant(ctx, auth.token, auth.resource));
    const legacy = await f.t.run(async ctx => {
      const fields = { userId: f.operator.user._id, grantId: current.grantId, resource: a2a, generation: current.generation!, contextId: "legacy-customer-context", messageId: "legacy-message", requestHash: "hash", state: "TASK_STATE_COMPLETED", createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86_400_000, result: '{"customerEmail":"SECRET_CUSTOMER_RESULT"}', error: "SECRET_CUSTOMER_SECURITY_ERROR" };
      const taskId = await ctx.db.insert("agentTasks", fields);
      await ctx.db.insert("agentTaskMessages", { userId: fields.userId, messageId: fields.messageId, taskId, requestHash: fields.requestHash, expiresAt: fields.expiresAt });
      const queuedId = await ctx.db.insert("agentTasks", { ...fields, messageId: "old-queue", state: "TASK_STATE_WORKING", command: JSON.stringify({ operation: "execute", input: { name: "announcements_create", input: { name: "Old write", bannerText: "Never committed" } } }) });
      return { taskId, queuedId };
    });
    const taskArgs = { ...auth, id: legacy.taskId };
    await expect(f.t.query(api.platform.agentTasks.get, taskArgs)).rejects.toThrow("TASK_NOT_FOUND");
    await expect(f.operator.client.query(api.platform.agentTaskAdmin.get, { taskId: legacy.taskId })).rejects.toThrow("TASK_NOT_FOUND");
    const remote = await f.mint();
    await expect(f.t.query(api.platform.agentCapabilities.read, { ...remote, name: "tasks_get", input: { taskId: legacy.taskId } })).rejects.toThrow("TASK_NOT_FOUND");
    expect((await f.t.query(api.platform.agentCapabilities.read, { ...remote, name: "tasks_list", input: { paginationOpts: page } })).page).toEqual([]);
    await expect(f.t.mutation(api.platform.agentTasks.cancel, taskArgs)).rejects.toThrow("TASK_NOT_FOUND");
    await expect(f.operator.client.mutation(api.platform.agentTaskAdmin.cancel, { taskId: legacy.taskId })).rejects.toThrow("TASK_NOT_FOUND");
    const listed = await f.t.query(api.platform.agentTasks.list, { ...auth, includeArtifacts: true });
    expect(listed).toMatchObject({ tasks: [], totalSize: 0 });
    expect((await f.operator.client.query(api.platform.agentTaskAdmin.list, { paginationOpts: page })).page).toEqual([]);
    await expect(f.t.mutation(api.platform.agentTasks.send, { ...auth, params: { message: { messageId: "new-message", taskId: legacy.taskId, role: "ROLE_USER", parts: [{ text: "continue" }] } } })).rejects.toThrow("TASK_NOT_FOUND");
    await expect(f.t.mutation(api.platform.agentTasks.send, { ...auth, params: { message: { messageId: "legacy-message", role: "ROLE_USER", parts: [{ text: "retry" }] } } })).rejects.toThrow("TASK_NOT_FOUND");
    expect(await f.t.mutation(internal.platform.agentTasks.begin, { taskId: legacy.queuedId })).toBe(false);
    await f.t.mutation(internal.platform.agentTasks.perform, { taskId: legacy.queuedId });
    await f.t.mutation(internal.platform.agentTasks.recover, { taskId: legacy.queuedId, attempt: 1 });
    expect(await f.operator.client.query(api.platform.announcements.list, {})).toEqual([]);
    vi.advanceTimersByTime(86_400_001);
    await f.t.mutation(internal.platform.agentTasks.expire, { taskId: legacy.taskId });
    expect(await f.t.run(ctx => ctx.db.get(legacy.taskId))).toMatchObject({ result: '{"customerEmail":"SECRET_CUSTOMER_RESULT"}' });
  });

  test("current epoch results remain readable after original grant expiry using renewed current authority", async () => {
    const f = await fixture(); const a2a = resource.replace("/api/mcp", "/api/a2a"); const auth = await f.mint(a2a);
    const sent = await f.t.mutation(api.platform.agentTasks.send, { ...auth, params: { message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ data: { operation: "search", input: { query: "organizations" } } }] } } });
    const taskId = sent.id as Id<"agentTasks">;
    await f.t.mutation(internal.platform.agentTasks.begin, { taskId });
    await f.t.mutation(internal.platform.agentTasks.perform, { taskId });
    vi.advanceTimersByTime(16 * 60_000 + 1);
    await expect(f.t.query(api.platform.agentTasks.get, { ...auth, id: taskId })).rejects.toThrow("INVALID_AGENT_TOKEN");
    const renewed = await f.mint(a2a);
    const result = await f.t.query(api.platform.agentTasks.get, { ...renewed, id: taskId });
    expect(result.status.state).toBe("TASK_STATE_COMPLETED");
    expect(result.artifacts).toHaveLength(1);
  });
});
