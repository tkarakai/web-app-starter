import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { createTestEnv } from "../test.modules";
import { api, components } from "../_generated/api";
import authSchema from "./betterAuth/schema";
const resource = "http://localhost:3001/api/mcp";
const verifier = "v".repeat(64);
async function challenge(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(value));
  return Buffer.from(digest).toString("base64url");
}
async function fixture(role = "admin") {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const now = Date.now();
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "user", data: { name: "Agent admin", email: "agent@example.test", emailVerified: true, role, createdAt: now, updatedAt: now } },
  });
  await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: { userId: user._id, accountId: user._id, providerId: "credential", password: "fixture-password-hash", createdAt: now, updatedAt: now } } });
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "session", data: { authPurpose: "mcp-authorization", assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now, userId: user._id, token: "fixture", expiresAt: now + 3600_000, createdAt: now, updatedAt: now } },
  });
  const admin = t.withIdentity({ subject: user._id, sessionId: session._id });
  const applicationSession = await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "session", data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now, userId: user._id, token: "application", expiresAt: now + 3600_000, createdAt: now, updatedAt: now } },
  });
  const application = t.withIdentity({ subject: user._id, sessionId: applicationSession._id });
  if (role === "admin") await application.mutation(api.platform.agentMcp.setEnabled, { enabled: true });
  const request = { clientId: "pi-announcements", redirectUri: "http://127.0.0.1:45991/callback", resource, challenge: await challenge(verifier), scope: "announcements:manage" };
  let loginSequence = 0;
  const login = async () => {
    const current = Date.now();
    const row = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { authPurpose: "mcp-authorization", assuranceVersion: 1, authMethod: "password", authenticatedAt: current, primaryVerifiedAt: current, userId: user._id, token: `fresh-${++loginSequence}`, expiresAt: current + 3600_000, createdAt: current, updatedAt: current } } });
    return { client: t.withIdentity({ subject: user._id, sessionId: row._id }), session: row };
  };
  const mint = async () => {
    const fresh = await login();
    const { code } = await fresh.client.mutation(api.platform.agentAccess.authorize, request);
    const exchange = { code, verifier, clientId: request.clientId, redirectUri: request.redirectUri, resource };
    const grant = await t.mutation(api.platform.agentAccess.exchange, exchange);
    return { token: grant.access_token, resource, exchange };
  };
  return { t, admin, application, user, session, request, mint, login };
}

describe("one-use browser authorization and delegated access", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("AGENT_MCP_RESOURCE", resource); vi.stubEnv("AGENT_MCP_AUTH_ORIGIN", "http://mcp-auth.localhost:3001"); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  test("CRUD uses native storage, validation and audit attribution; credentials stay hashed", async () => {
    const { t, mint, user } = await fixture(); const { token } = await mint(); const auth = { token, resource };
    const { id } = await t.mutation(api.platform.agentAnnouncements.create, { ...auth, name: "Agent draft", bannerText: "First" });
    expect(await t.query(api.platform.agentAnnouncements.get, { ...auth, announcementId: id })).toMatchObject({ name: "Agent draft", bannerText: "First", isLive: false });
    await t.mutation(api.platform.agentAnnouncements.update, { ...auth, announcementId: id, patch: { bannerText: "Second" } });
    expect(await t.query(api.platform.agentAnnouncements.list, auth)).toEqual([expect.objectContaining({ _id: id, bannerText: "Second" })]);
    await t.mutation(api.platform.agentAnnouncements.remove, { ...auth, announcementId: id });
    expect(await t.query(api.platform.agentAnnouncements.get, { ...auth, announcementId: id })).toBeNull();
    const stored = await t.run(ctx => ctx.db.query("agentGrants").collect());
    expect(JSON.stringify(stored)).not.toContain(token);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const events = await t.query(components.platform.auditTrail.list, { paginationOpts: { numItems: 100, cursor: null } });
    expect(events.page.filter(row => row.action.startsWith("announcement.")).every(row => row.authenticatedUserId === user._id)).toBe(true);
  });
  test("approval deletes the browser session, rejects its cached JWT, and preserves only delegated access", async () => {
    const f = await fixture();
    const { code } = await f.admin.mutation(api.platform.agentAccess.authorize, f.request);
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "_id", value: f.session._id }] })).toBeNull();
    expect(await f.admin.query(api.platform.auth.getCurrentUser, {})).toBeNull();
    await expect(f.admin.mutation(api.platform.agentAccess.authorize, f.request)).rejects.toThrow("NOT_AUTHENTICATED");
    const grant = await f.t.mutation(api.platform.agentAccess.exchange, { code, verifier, clientId: f.request.clientId, redirectUri: f.request.redirectUri, resource });
    expect(await f.t.query(api.platform.agentAnnouncements.list, { token: grant.access_token, resource })).toEqual([]);
    expect(await f.application.query(api.platform.auth.getCurrentUser, {})).not.toBeNull();
  });
  test("denial deletes even a stale browser login and creates no delegation, code or grant", async () => {
    const f = await fixture();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await f.admin.mutation(api.platform.agentAccess.deny, {});
    expect(await f.admin.query(api.platform.auth.getCurrentUser, {})).toBeNull();
    expect(await f.t.run(ctx => ctx.db.query("agentDelegations").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("agentAuthorizationCodes").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("agentGrants").collect())).toEqual([]);
    await expect(f.admin.mutation(api.platform.agentAccess.authorize, f.request)).rejects.toThrow("NOT_AUTHENTICATED");
    await expect(f.application.mutation(api.platform.agentAccess.deny, {})).rejects.toThrow("FORBIDDEN");
  });
  test("only recent, policy-ready admins can issue codes; resource/client/redirect are constrained", async () => {
    const f = await fixture("user");
    await expect(f.admin.mutation(api.platform.agentAccess.authorize, f.request)).rejects.toThrow("NOT_ADMIN");
    const a = await fixture();
    for (const patch of [{ clientId: "other" }, { redirectUri: "https://attacker.test/callback" }, { resource: "https://other.test/api/mcp" }, { scope: "users:manage" }])
      await expect(a.admin.mutation(api.platform.agentAccess.authorize, { ...a.request, ...patch })).rejects.toThrow("INVALID_AUTHORIZATION_REQUEST");
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(a.admin.mutation(api.platform.agentAccess.authorize, a.request)).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
  });
  test("an MCP authorization session cannot use native admin APIs, while grants can perform CRUD", async () => {
    const f = await fixture();
    expect(await f.admin.query(api.platform.announcements.list, {})).toBeNull();
    await expect(f.admin.mutation(api.platform.announcements.create, { name: "No", bannerText: "No" })).rejects.toThrow("NOT_AUTHENTICATED");
    expect(await f.application.query(api.platform.announcements.list, {})).toEqual([]);
    await expect(f.application.mutation(api.platform.agentAccess.authorize, f.request)).rejects.toThrow("MCP_AUTHORIZATION_ONLY");
  });
  test("disabling blocks issued codes and grants, and re-enabling requires fresh consent", async () => {
    const f = await fixture(); const { token } = await f.mint();
    const pending = await f.login();
    const code = await pending.client.mutation(api.platform.agentAccess.authorize, f.request);
    await f.application.mutation(api.platform.agentMcp.setEnabled, { enabled: false });
    await expect(f.t.query(api.platform.agentAnnouncements.list, { token, resource })).rejects.toThrow("INVALID_AGENT_TOKEN");
    const blocked = await f.login();
    await expect(blocked.client.mutation(api.platform.agentAccess.authorize, f.request)).rejects.toThrow("MCP_DISABLED");
    await f.application.mutation(api.platform.agentMcp.setEnabled, { enabled: true });
    await expect(f.t.query(api.platform.agentAnnouncements.list, { token, resource })).rejects.toThrow("INVALID_AGENT_TOKEN");
    await expect(f.t.mutation(api.platform.agentAccess.exchange, { code: code.code, verifier, clientId: f.request.clientId, redirectUri: f.request.redirectUri, resource })).rejects.toThrow("INVALID_GRANT");
    const fresh = await f.mint();
    expect(await f.t.query(api.platform.agentAnnouncements.list, { token: fresh.token, resource })).toEqual([]);
  });
  test("PKCE, redirect and audience binding; codes expire and cannot be replayed", async () => {
    const f = await fixture(); const { code } = await f.admin.mutation(api.platform.agentAccess.authorize, f.request);
    const args = { code, verifier, clientId: f.request.clientId, redirectUri: f.request.redirectUri, resource };
    for (const patch of [{ verifier: "x".repeat(64) }, { clientId: "wrong" }, { redirectUri: "http://127.0.0.1:1/callback" }, { resource: "other" }])
      await expect(f.t.mutation(api.platform.agentAccess.exchange, { ...args, ...patch })).rejects.toThrow("INVALID_GRANT");
    await f.t.mutation(api.platform.agentAccess.exchange, args);
    await expect(f.t.mutation(api.platform.agentAccess.exchange, args)).rejects.toThrow("INVALID_GRANT");
    const newLogin = await f.login();
    const c = await newLogin.client.mutation(api.platform.agentAccess.authorize, f.request);
    vi.advanceTimersByTime(60_001);
    await expect(f.t.mutation(api.platform.agentAccess.exchange, { ...args, code: c.code })).rejects.toThrow("INVALID_GRANT");
  });
  test("anonymous, forged, wrong-audience and expired tokens fail; stale writes fail while reads remain valid", async () => {
    const f = await fixture(); const { token } = await f.mint();
    for (const auth of [{ token: "forged", resource }, { token, resource: "wrong" }])
      await expect(f.t.query(api.platform.agentAnnouncements.list, auth)).rejects.toThrow("INVALID_AGENT_TOKEN");
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(await f.t.query(api.platform.agentAnnouncements.list, { token, resource })).toEqual([]);
    await expect(f.t.mutation(api.platform.agentAnnouncements.create, { token, resource, name: "No", bannerText: "No" })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    vi.advanceTimersByTime(10 * 60_000);
    await expect(f.t.query(api.platform.agentAnnouncements.list, { token, resource })).rejects.toThrow("INVALID_AGENT_TOKEN");
  });
  test("grant revocation and credential changes disable access", async () => {
    const f = await fixture(); const first = await f.mint();
    const grants = await f.application.query(api.platform.agentAccess.listMine, {});
    await f.application.mutation(api.platform.agentAccess.revoke, { grantId: grants[0]._id });
    await expect(f.t.query(api.platform.agentAnnouncements.list, { token: first.token, resource })).rejects.toThrow();
    const second = await f.mint();
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "account", where: [{ field: "userId", value: f.user._id }, { field: "providerId", value: "credential" }], update: { password: "changed-password-hash" } } });
    await expect(f.t.query(api.platform.agentAnnouncements.list, { token: second.token, resource })).rejects.toThrow("INVALID_AGENT_TOKEN");
  });
  test("live role, ban and security policy changes disable existing grants", async () => {
    for (const data of [{ role: "user" }, { banned: true }]) {
      const f = await fixture(); const { token } = await f.mint();
      await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: f.user._id }], update: data } });
      await expect(f.t.query(api.platform.agentAnnouncements.list, { token, resource })).rejects.toThrow("INVALID_AGENT_TOKEN");
    }
    const f = await fixture(); const { token } = await f.mint();
    await f.t.mutation(components.platform.appSettings.set, { key: "adminMfaRequired", value: "true", userId: f.user._id });
    await expect(f.t.query(api.platform.agentAnnouncements.list, { token, resource })).rejects.toThrow("INVALID_AGENT_TOKEN");
  });
});
