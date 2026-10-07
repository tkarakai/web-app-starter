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
  const request = { clientId: "pi-announcements", redirectUri: "http://127.0.0.1:45991/callback", resource, challenge: await challenge(verifier), scope: "admin:manage" };
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

describe("full native capability adapter and independent surfaces", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("AGENT_MCP_RESOURCE", resource); vi.stubEnv("AGENT_MCP_AUTH_ORIGIN", "http://mcp-auth.localhost:3001"); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  test("catalogue schemas come from native validators; executions preserve native policy and bounds", async () => {
    const f = await fixture(); const auth = await f.mint();
    const catalogue = await f.t.query(api.platform.agentCapabilities.catalogue, { token: auth.token, resource });
    expect(catalogue.length).toBeGreaterThan(60);
    expect(catalogue.map(row => row.name)).toEqual(expect.arrayContaining(["users_ban", "settings_set", "announcements_publishNow", "waitlist_inviteMany", "invitations_invite", "audit_list", "surfaces_setEnabled"]));
    for (const row of catalogue) expect(row.inputSchema.type).toBe("object");
    const read = (name: string, input = {}) => f.t.query(api.platform.agentCapabilities.read, { token: auth.token, resource, name, input });
    const write = (name: string, input = {}) => f.t.mutation(api.platform.agentCapabilities.write, { token: auth.token, resource, name, input });
    expect(await read("account_currentUser")).toMatchObject({ id: f.user._id, role: "admin" });
    expect(await read("account_changePassword")).toMatchObject({ executed: false, status: "requires_user_action" });
    await expect(write("announcements_create", { name: "Draft", bannerText: "Hi", token: "injected" })).rejects.toThrow();
    await expect(read("users_list", { paginationOpts: { numItems: 1000, cursor: null } })).rejects.toThrow("INVALID_PAGE_SIZE");
    await expect(write("waitlist_inviteMany", { emails: Array(101).fill("a@example.test") })).rejects.toThrow("BATCH_TOO_LARGE");
    await expect(read("announcements_create", { name: "Draft", bannerText: "Hi" })).rejects.toThrow("WRONG_EXECUTION_KIND");
    await expect(write("unregistered_admin_backdoor")).rejects.toThrow("UNKNOWN_CAPABILITY");
    const { id } = await write("announcements_create", { name: "Full adapter draft", bannerText: "Full" }) as { id: string };
    await write("announcements_publishNow", { announcementId: id });
    expect(await read("announcements_get", { announcementId: id })).toMatchObject({ isLive: true });
    await write("announcements_archive", { announcementId: id });
    await write("announcements_delete", { announcementId: id });
    await write("settings_set", { key: "userMagicLinkEnabled", value: "true" });
    expect(await read("settings_get", { key: "userMagicLinkEnabled" })).toBe(true);
    await expect(write("settings_set", { key: "agentMcpConfiguration", value: '{"enabled":false}' })).rejects.toThrow();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(write("profile_setLocale", { locale: "en" })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    expect(await read("account_currentUser")).not.toBeNull();
  });
  test("user administration uses safe IDs, protects admins, revokes sessions and cleans authentication records", async () => {
    const f = await fixture(); const auth = await f.mint();
    const now = Date.now();
    const other = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { email: "other@example.test", name: "Other", emailVerified: true, role: "user", createdAt: now, updatedAt: now } } });
    const session = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { userId: other._id, token: "NEVER_EXPOSE_THIS_TOKEN", createdAt: now, updatedAt: now, expiresAt: now + 3600_000 } } });
    const read = (name: string, input = {}) => f.t.query(api.platform.agentCapabilities.read, { token: auth.token, resource, name, input });
    const write = (name: string, input = {}) => f.t.mutation(api.platform.agentCapabilities.write, { token: auth.token, resource, name, input });
    expect(await read("users_list", { paginationOpts: { numItems: 10, cursor: null } })).toMatchObject({ page: expect.arrayContaining([expect.objectContaining({ id: other._id })]) });
    const sessions = await read("users_sessions", { userId: other._id, paginationOpts: { numItems: 10, cursor: null } });
    expect(JSON.stringify(sessions)).not.toContain("NEVER_EXPOSE");
    await expect(write("users_revokeSession", { userId: f.user._id, sessionId: session._id })).rejects.toThrow("SESSION_NOT_FOUND");
    await write("users_update", { userId: other._id, name: "Updated" });
    await write("users_setRole", { userId: other._id, role: "admin" });
    expect(await read("users_get", { userId: other._id })).toMatchObject({ name: "Updated", role: "admin" });
    await write("users_ban", { userId: other._id, reason: "Test", expiresInSeconds: 60 });
    expect(await read("users_sessions", { userId: other._id, paginationOpts: { numItems: 10, cursor: null } })).toMatchObject({ page: [] });
    await write("users_unban", { userId: other._id });
    const protectedId = await f.t.mutation(components.platform.adminEmails.ensure, { email: other.email });
    for (const name of ["users_ban", "users_remove", "users_setRole"]) await expect(write(name, { userId: other._id, ...(name === "users_setRole" ? { role: "user" } : {}) })).rejects.toThrow("PROTECTED_ADMIN");
    await f.t.mutation(components.platform.adminEmails.replace, { id: protectedId, email: "different.test" });
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: { userId: other._id, accountId: other._id, providerId: "credential", password: "SECRET_HASH", createdAt: now, updatedAt: now } } });
    await write("users_remove", { userId: other._id });
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "userId", value: other._id }] })).toBeNull();
    await expect(read("users_get", { userId: other._id })).rejects.toThrow("USER_NOT_FOUND");
  });
  test("CLI grants are audience-bound and independently revoked; WebMCP uses the normal human session", async () => {
    const f = await fixture(); const mcp = await f.mint();
    const cliResource = resource.replace("/api/mcp", "/api/agent/cli");
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "cli", enabled: true });
    const fresh = await f.login();
    const request = { ...f.request, resource: cliResource };
    const { code } = await fresh.client.mutation(api.platform.agentAccess.authorize, request);
    const cli = await f.t.mutation(api.platform.agentAccess.exchange, { code, verifier, clientId: request.clientId, redirectUri: request.redirectUri, resource: cliResource });
    await expect(f.t.query(api.platform.agentCapabilities.catalogue, { token: cli.access_token, resource })).rejects.toThrow("INVALID_AGENT_TOKEN");
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "mcp", enabled: false });
    expect(await f.t.query(api.platform.agentCapabilities.catalogue, { token: cli.access_token, resource: cliResource })).not.toHaveLength(0);
    await expect(f.t.query(api.platform.agentCapabilities.catalogue, { token: mcp.token, resource })).rejects.toThrow("INVALID_AGENT_TOKEN");
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "cli", enabled: false });
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "cli", enabled: true });
    await expect(f.t.query(api.platform.agentCapabilities.catalogue, { token: cli.access_token, resource: cliResource })).rejects.toThrow("INVALID_AGENT_TOKEN");
    await expect(f.application.query(api.platform.agentCapabilities.browserCatalogue, {})).rejects.toThrow("SURFACE_DISABLED");
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "webmcp", enabled: true });
    expect(await f.application.query(api.platform.agentCapabilities.browserRead, { name: "account_currentUser", input: {} })).toMatchObject({ id: f.user._id });
    await expect(f.admin.query(api.platform.agentCapabilities.browserCatalogue, {})).rejects.toThrow("NOT_ADMIN");
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "webmcp", enabled: false });
    await expect(f.application.query(api.platform.agentCapabilities.browserRead, { name: "account_currentUser", input: {} })).rejects.toThrow("SURFACE_DISABLED");
  });
});

describe("durable A2A task lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("AGENT_MCP_RESOURCE", resource); vi.stubEnv("AGENT_MCP_AUTH_ORIGIN", "http://mcp-auth.localhost:3001"); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  async function setup() {
    const f = await fixture(); const a2aResource = resource.replace("/api/mcp", "/api/a2a");
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "a2a", enabled: true });
    const fresh = await f.login(); const request = { ...f.request, resource: a2aResource };
    const { code } = await fresh.client.mutation(api.platform.agentAccess.authorize, request);
    const grant = await f.t.mutation(api.platform.agentAccess.exchange, { code, verifier, clientId: request.clientId, redirectUri: request.redirectUri, resource: a2aResource });
    const auth = { token: grant.access_token, resource: a2aResource };
    const send = (command: unknown, messageId = crypto.randomUUID(), extra = {}) => f.t.mutation(api.platform.agentTasks.send, { ...auth, params: { message: { messageId, role: "ROLE_USER", parts: [{ data: command }], ...extra }, configuration: { returnImmediately: true } } });
    const work = async (id: string) => { const { internal } = await import("../_generated/api"); await f.t.action(internal.platform.agentTasks.work, { taskId: id as import("../_generated/dataModel").Id<"agentTasks"> }); return f.t.query(api.platform.agentTasks.get, { ...auth, id }); };
    return { ...f, auth, send, work };
  }
  test("durable task creation is replay-safe; writes and result commit once and task data excludes tokens", async () => {
    const f = await setup(); const messageId = crypto.randomUUID();
    const command = { operation: "execute", input: { name: "announcements_create", input: { name: "A2A draft", bannerText: "Durable" } } };
    const first = await f.send(command, messageId); expect(first.status.state).toBe("TASK_STATE_SUBMITTED");
    const duplicate = await f.send(command, messageId); expect(duplicate.id).toBe(first.id);
    await expect(f.send({ ...command, input: { ...command.input, input: { name: "Different", bannerText: "X" } } }, messageId)).rejects.toThrow("MESSAGE_ID_REUSED");
    const completed = await f.work(first.id); expect(completed.status.state).toBe("TASK_STATE_COMPLETED");
    await f.work(first.id);
    const rows = await f.t.query(api.platform.agentCapabilities.read, { ...f.auth, name: "announcements_list", input: {} });
    expect(rows).toHaveLength(1);
    const tasks = await f.t.run(ctx => ctx.db.query("agentTasks").collect());
    expect(JSON.stringify(tasks)).not.toContain(f.auth.token);
    const messages = await f.t.run(ctx => ctx.db.query("agentTaskMessages").collect()); expect(messages).toHaveLength(1);
    await expect(f.t.mutation(api.platform.agentTasks.cancel, { ...f.auth, id: first.id })).rejects.toThrow("TASK_NOT_CANCELABLE");
    const list = await f.t.query(api.platform.agentTasks.list, { ...f.auth, pageSize: 10 }); expect(list).toMatchObject({ totalSize: 1, tasks: [expect.not.objectContaining({ artifacts: expect.anything() })] });
  });
  test("cancellation and disable/expiry stop queued writes; invalid input never enters durable storage", async () => {
    const f = await setup();
    const command = { operation: "execute", input: { name: "announcements_create", input: { name: "Canceled", bannerText: "No" } } };
    const task = await f.send(command);
    await f.t.mutation(api.platform.agentTasks.cancel, { ...f.auth, id: task.id });
    expect((await f.work(task.id)).status.state).toBe("TASK_STATE_CANCELED");
    expect(await f.t.query(api.platform.agentCapabilities.read, { ...f.auth, name: "announcements_list", input: {} })).toHaveLength(0);
    await expect(f.send({ operation: "execute", input: { name: "account_changePassword", input: { password: "NEVER_STORE_SECRET" } } })).rejects.toThrow();
    expect(JSON.stringify(await f.t.run(ctx => ctx.db.query("agentTasks").collect()))).not.toContain("NEVER_STORE");
    const pending = await f.send(command); vi.advanceTimersByTime(5 * 60_000 + 1);
    const failed = await f.work(pending.id); expect(failed.status.state).toBe("TASK_STATE_FAILED");
    expect(JSON.stringify(failed)).toContain("RECENT_AUTHENTICATION_REQUIRED");
    expect(await f.t.query(api.platform.agentCapabilities.read, { ...f.auth, name: "announcements_list", input: {} })).toHaveLength(0);
  });
  test("text-only input asks for structured data; continuation preserves context; task ownership cannot be bypassed", async () => {
    const f = await setup();
    const pending = await f.t.mutation(api.platform.agentTasks.send, { ...f.auth, params: { message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text: "Please do something" }] } } });
    expect(pending.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    await expect(f.send({ operation: "search", input: {} }, crypto.randomUUID(), { taskId: pending.id, contextId: "wrong-context" })).rejects.toThrow("CONTEXT_MISMATCH");
    const continued = await f.send({ operation: "search", input: { query: "users" } }, crypto.randomUUID(), { taskId: pending.id });
    expect(continued.contextId).toBe(pending.contextId); expect(continued.id).toBe(pending.id);
    expect((await f.work(continued.id)).status.state).toBe("TASK_STATE_COMPLETED");
    await expect(f.t.query(api.platform.agentTasks.get, { ...f.auth, id: "unknown" })).rejects.toThrow("TASK_NOT_FOUND");
    const other = await fixture(); const mcp = await other.mint();
    await expect(f.t.query(api.platform.agentTasks.get, { token: mcp.token, resource, id: pending.id })).rejects.toThrow("INVALID_AGENT_TOKEN");
    const { internal } = await import("../_generated/api");
    await f.t.mutation(internal.platform.agentTasks.recover, { taskId: pending.id as import("../_generated/dataModel").Id<"agentTasks">, attempt: 1 });
    expect((await f.t.query(api.platform.agentTasks.get, { ...f.auth, id: pending.id })).status.state).toBe("TASK_STATE_COMPLETED");
  });
});

describe("capability maintenance edge cases", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("AGENT_MCP_RESOURCE", resource); vi.stubEnv("AGENT_MCP_AUTH_ORIGIN", "http://mcp-auth.localhost:3001"); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  test("grant and own-session operations preserve ownership and the current browser session", async () => {
    const f = await fixture(); const auth = await f.mint();
    const grants = await f.t.query(api.platform.agentCapabilities.read, { token: auth.token, resource, name: "grants_listMine", input: {} });
    expect(grants).toHaveLength(1); expect(JSON.stringify(grants)).not.toContain(auth.token);
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "webmcp", enabled: true });
    const current = await f.application.query(api.platform.auth.getCurrentUser, {}); expect(current).not.toBeNull();
    const result = await f.application.mutation(api.platform.agentCapabilities.browserWrite, { name: "account_revokeOtherSessions", input: {} });
    expect(result).toMatchObject({ currentBrowserSessionPreserved: true });
    expect(await f.application.query(api.platform.auth.getCurrentUser, {})).not.toBeNull();
    const grantId = (grants as { _id: import("../_generated/dataModel").Id<"agentGrants"> }[])[0]!._id;
    await f.t.mutation(api.platform.agentCapabilities.write, { token: auth.token, resource, name: "grants_revoke", input: { grantId } });
    await expect(f.t.query(api.platform.agentCapabilities.catalogue, { token: auth.token, resource })).rejects.toThrow("INVALID_AGENT_TOKEN");
  });
  test("passkey metadata and mutation omit credentials and never cross ownership", async () => {
    const f = await fixture(); const auth = await f.mint(); const now = Date.now();
    const key = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: { userId: f.user._id, publicKey: "PRIVATE_KEY_MATERIAL_NOT_FOR_THE_MODEL", credentialID: "credential-id", counter: 0, deviceType: "singleDevice", backedUp: false, name: "Test key", createdAt: now } } });
    await expect(f.t.mutation(api.platform.agentCapabilities.write, { token: auth.token, resource, name: "account_renamePasskey", input: { passkeyId: key._id, name: "Rejected without strong proof" } })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    const fresh = await f.login();
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: fresh.session._id }], update: { authMethod: "passkey", strongVerifiedAt: now, strongFactorId: key._id, strongFactorType: "passkey" } } });
    const { code } = await fresh.client.mutation(api.platform.agentAccess.authorize, f.request);
    const grant = await f.t.mutation(api.platform.agentAccess.exchange, { code, verifier, clientId: f.request.clientId, redirectUri: f.request.redirectUri, resource });
    const query = (name: string, input = {}) => f.t.query(api.platform.agentCapabilities.read, { token: grant.access_token, resource, name, input });
    const write = (name: string, input = {}) => f.t.mutation(api.platform.agentCapabilities.write, { token: grant.access_token, resource, name, input });
    const keys = await query("account_ownPasskeys"); expect(JSON.stringify(keys)).not.toContain("PRIVATE_KEY");
    await write("account_renamePasskey", { passkeyId: key._id, name: "Renamed" });
    expect(await query("account_ownPasskeys")).toMatchObject({ page: [expect.objectContaining({ name: "Renamed" })] });
    await expect(write("account_removePasskey", { passkeyId: "another-key" })).rejects.toThrow("PASSKEY_NOT_FOUND");
    await write("account_removePasskey", { passkeyId: key._id });
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "passkey", where: [{ field: "_id", value: key._id }] })).toBeNull();
    await expect(query("account_ownPasskeys")).rejects.toThrow("INVALID_AGENT_TOKEN");
  });
});

describe("A2A ownership, rollback and interruption guarantees", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("AGENT_MCP_RESOURCE", resource); vi.stubEnv("AGENT_MCP_AUTH_ORIGIN", "http://mcp-auth.localhost:3001"); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  async function setup() {
    const f = await fixture(); const target = resource.replace("/api/mcp", "/api/a2a");
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "a2a", enabled: true });
    async function mint(client: typeof f.admin) {
      const request = { ...f.request, resource: target };
      const { code } = await client.mutation(api.platform.agentAccess.authorize, request);
      const grant = await f.t.mutation(api.platform.agentAccess.exchange, { code, verifier, clientId: request.clientId, redirectUri: request.redirectUri, resource: target });
      return { token: grant.access_token, resource: target };
    }
    const auth = await mint((await f.login()).client);
    const send = (name: string, input = {}) => f.t.mutation(api.platform.agentTasks.send, { ...auth, params: { message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ data: { operation: "execute", input: { name, input } } }] } } });
    return { ...f, auth, send, mint };
  }
  test("another authenticated admin cannot inspect/cancel an owned task; disabled queued work has no effects", async () => {
    const f = await setup(); const pending = await f.send("announcements_create", { name: "Disable safety", bannerText: "Never committed" });
    const now = Date.now();
    const other = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: "Other admin", email: "second@example.test", emailVerified: true, role: "admin", createdAt: now, updatedAt: now } } });
    const session = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { authPurpose: "mcp-authorization", assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now, userId: other._id, token: "other-session", createdAt: now, updatedAt: now, expiresAt: now + 3600_000 } } });
    const otherAuth = await f.mint(f.t.withIdentity({ subject: other._id, sessionId: session._id }));
    await expect(f.t.query(api.platform.agentTasks.get, { ...otherAuth, id: pending.id })).rejects.toThrow("TASK_NOT_FOUND");
    await expect(f.t.mutation(api.platform.agentTasks.cancel, { ...otherAuth, id: pending.id })).rejects.toThrow("TASK_NOT_FOUND");
    await f.application.mutation(api.platform.agentSurfaces.setEnabled, { surface: "a2a", enabled: false });
    const { internal } = await import("../_generated/api");
    await f.t.action(internal.platform.agentTasks.work, { taskId: pending.id as import("../_generated/dataModel").Id<"agentTasks"> });
    const row = await f.t.run(ctx => ctx.db.get(pending.id as import("../_generated/dataModel").Id<"agentTasks">)); expect(row?.state).toBe("TASK_STATE_FAILED");
    expect(await f.t.query(components.platform.announcements.list, {})).toHaveLength(0);
  });
  test("a failed worker rolls back native writes; a restarted working task commits only once", async () => {
    const f = await setup();
    const { mutation } = await import("../_generated/server");
    const { rememberNative } = await import("./nativeCapabilities");
    const { capabilityRegistry } = await import("./agentRegistry");
    const definition = { args: {}, handler: async (ctx: import("../_generated/server").MutationCtx) => { await ctx.db.insert("userProfiles", { ownerId: "must-roll-back", createdAt: Date.now(), updatedAt: Date.now() }); throw new Error("NATIVE_OPERATION_FAILED"); } };
    const registry = capabilityRegistry(); registry.test_rollback = { title: "Rollback test", description: "Trusted test-only native operation", effect: "write", registered: rememberNative(mutation(definition), definition, "mutation") };
    try {
      const task = await f.send("test_rollback"); const { internal } = await import("../_generated/api");
      const taskId = task.id as import("../_generated/dataModel").Id<"agentTasks">;
      await f.t.action(internal.platform.agentTasks.work, { taskId });
      expect((await f.t.query(api.platform.agentTasks.get, { ...f.auth, id: task.id })).status.state).toBe("TASK_STATE_FAILED");
      expect(await f.t.run(ctx => ctx.db.query("userProfiles").collect())).toHaveLength(0);
      const restart = await f.send("announcements_create", { name: "Restart once", bannerText: "Once" }); const restartId = restart.id as typeof taskId;
      await f.t.mutation(internal.platform.agentTasks.begin, { taskId: restartId });
      await f.t.action(internal.platform.agentTasks.work, { taskId: restartId });
      await f.t.action(internal.platform.agentTasks.work, { taskId: restartId });
      expect(await f.t.query(components.platform.announcements.list, {})).toHaveLength(1);
      const workflow = await f.send("account_changePassword");
      await f.t.action(internal.platform.agentTasks.work, { taskId: workflow.id as typeof taskId });
      expect((await f.t.query(api.platform.agentTasks.get, { ...f.auth, id: workflow.id })).status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    } finally { delete registry.test_rollback; }
  });
});

describe("semantic user filtering and private helper policy", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("AGENT_MCP_RESOURCE", resource); vi.stubEnv("AGENT_MCP_AUTH_ORIGIN", "http://mcp-auth.localhost:3001"); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  test("server-side user filters include active legacy rows and combine verified/role/search predicates", async () => {
    const f = await fixture(); const auth = await f.mint(); const now = Date.now();
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: "Filter Target", email: "target@example.test", emailVerified: true, role: "user", createdAt: now, updatedAt: now } } });
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: "Banned", email: "banned@example.test", emailVerified: false, role: "user", banned: true, createdAt: now, updatedAt: now } } });
    const list = (input = {}) => f.t.query(api.platform.agentCapabilities.read, { token: auth.token, resource, name: "users_list", input: { paginationOpts: { numItems: 10, cursor: null }, ...input } });
    expect(await list({ status: "active" })).toMatchObject({ page: expect.arrayContaining([expect.objectContaining({ email: "target@example.test" })]) });
    const filtered = await list({ role: "user", emailVerified: true, status: "active", search: "Target", searchField: "name" });
    expect(filtered).toMatchObject({ page: [expect.objectContaining({ name: "Filter Target" })] });
    expect(await list({ search: "TARGET", searchField: "email" })).toMatchObject({ page: [expect.objectContaining({ email: "target@example.test" })] });
    expect(await list({ status: "banned" })).toMatchObject({ page: [expect.objectContaining({ email: "banned@example.test" })] });
  });
  test("ordinary users cannot read private announcement helpers even with an existing opaque ID", async () => {
    const f = await fixture("user");
    const { id } = await f.t.mutation(components.platform.announcements.create, { name: "Private draft", bannerText: "Admin only", identity: { userId: "seed", actor: "seed" } });
    await expect(f.application.query(api.platform.agentRegistry.announcement, { announcementId: id })).rejects.toThrow("NOT_ADMIN");
  });
});
