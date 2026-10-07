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
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "session", data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now, userId: user._id, token: "fixture", expiresAt: now + 3600_000, createdAt: now, updatedAt: now } },
  });
  const admin = t.withIdentity({ subject: user._id, sessionId: session._id });
  const request = { clientId: "pi-announcements", redirectUri: "http://127.0.0.1:45991/callback", resource, challenge: await challenge(verifier), scope: "announcements:manage" };
  const mint = async () => {
    const { code } = await admin.mutation(api.platform.agentAccess.authorize, request);
    const exchange = { code, verifier, clientId: request.clientId, redirectUri: request.redirectUri, resource };
    const grant = await t.mutation(api.platform.agentAccess.exchange, exchange);
    return { token: grant.access_token, resource, exchange };
  };
  return { t, admin, user, session, request, mint };
}

describe("session-bound agent access", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("AGENT_MCP_RESOURCE", resource); });
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
  test("only recent, policy-ready admins can issue codes; resource/client/redirect are constrained", async () => {
    const f = await fixture("user");
    await expect(f.admin.mutation(api.platform.agentAccess.authorize, f.request)).rejects.toThrow("NOT_ADMIN");
    const a = await fixture();
    for (const patch of [{ clientId: "other" }, { redirectUri: "https://attacker.test/callback" }, { resource: "https://other.test/api/mcp" }, { scope: "users:manage" }])
      await expect(a.admin.mutation(api.platform.agentAccess.authorize, { ...a.request, ...patch })).rejects.toThrow("INVALID_AUTHORIZATION_REQUEST");
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(a.admin.mutation(api.platform.agentAccess.authorize, a.request)).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
  });
  test("PKCE, redirect and audience binding; codes expire and cannot be replayed", async () => {
    const f = await fixture(); const { code } = await f.admin.mutation(api.platform.agentAccess.authorize, f.request);
    const args = { code, verifier, clientId: f.request.clientId, redirectUri: f.request.redirectUri, resource };
    for (const patch of [{ verifier: "x".repeat(64) }, { clientId: "wrong" }, { redirectUri: "http://127.0.0.1:1/callback" }, { resource: "other" }])
      await expect(f.t.mutation(api.platform.agentAccess.exchange, { ...args, ...patch })).rejects.toThrow("INVALID_GRANT");
    await f.t.mutation(api.platform.agentAccess.exchange, args);
    await expect(f.t.mutation(api.platform.agentAccess.exchange, args)).rejects.toThrow("INVALID_GRANT");
    const c = await f.admin.mutation(api.platform.agentAccess.authorize, f.request);
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
  test("grant revocation and sign-out immediately disable access", async () => {
    const f = await fixture(); const first = await f.mint();
    const grants = await f.admin.query(api.platform.agentAccess.listMine, {});
    await f.admin.mutation(api.platform.agentAccess.revoke, { grantId: grants[0]._id });
    await expect(f.t.query(api.platform.agentAnnouncements.list, { token: first.token, resource })).rejects.toThrow();
    const second = await f.mint();
    await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: f.session._id }] } });
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
