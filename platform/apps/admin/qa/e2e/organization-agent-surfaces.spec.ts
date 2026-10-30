/** Independent adoption acceptance: real public enrollment and operator transports. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { localAppOrigin } from "@web-app-starter/app-config";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConvexHttpClient } from "convex/browser";
import { api, type Id } from "@repo/backend";
import { fillStable, signInAsAdmin } from "./helpers/auth";
import { createDisposableUser, disposableEmail, disposablePassword, localConvexUrl, type DisposableUser } from "./helpers/fixtures";
import { installWebMcpSimulator, webMcpTools, callWebMcp } from "./helpers/webmcp";
import { signIn, fillOtp, generateTotp, awaitStableTotpWindow, markConvexLogPosition } from "../../../../tooling/e2e/customer-auth";
import { addOrganizationAuthenticator, completeOrganizationEnrollment, issueOrganizationInvitation } from "../../../../tooling/e2e/organizations";

// Credentials, recovery codes and OAuth callbacks must not enter retained traces/screenshots.
test.use({ trace: "off", screenshot: "off", actionTimeout: 20_000, launchOptions: { args: ["--enable-blink-features=WebMCP"] } });
test.describe.configure({ mode: "default", timeout: 300_000 });
const pageOpts = { numItems: 10, cursor: null };
const productRoot = resolve(__dirname, "../../../../..");
function customerOrigin() {
  if (process.env.E2E_WEB_BASE_URL) return process.env.E2E_WEB_BASE_URL;
  try {
    const env = readFileSync(resolve(productRoot, "apps/web/.env.local"), "utf8");
    const value = env.match(/^APP_ORIGIN=(.*)$/m)?.[1]?.trim();
    if (value) return value.replace(/^(["'])(.*)\1$/, "$2");
  } catch { /* Optional customer app: the cross-app cases require explicit opt-in. */ }
  return localAppOrigin("web");
}
const surfaces = ["mcp", "cli", "a2a"] as const;
type Surface = typeof surfaces[number];
type Operation = "search" | "describe" | "execute";
type Gateway = (operation: Operation, input: Record<string, unknown>) => Promise<unknown>;
const paths = { mcp: "/api/mcp", cli: "/api/agent/cli", a2a: "/api/a2a" };

async function sessionClient(page: Page) {
  const response = await page.request.get(new URL("/api/auth/convex/token", page.url()).href);
  expect(response.status()).toBe(200);
  const { token } = await response.json() as { token: string };
  expect(Boolean(token)).toBe(true);
  const client = new ConvexHttpClient(localConvexUrl()); client.setAuth(token);
  return { client, token };
}
function excludes(value: unknown, secrets: string[]) {
  const text = JSON.stringify(value);
  // Boolean assertions deliberately avoid rendering a secret into failure output.
  for (const secret of secrets) expect(text.includes(secret), "private material must be absent").toBe(false);
  for (const key of ["tokenHash", "backupCodes", "credentialID", "publicKey", "memberCount", "members", "projects", "uploads"]) {
    expect(text.includes(`"${key}":`), `forbidden projection field ${key}`).toBe(false);
  }
}
async function navigatePrivateLink(page: Page, url: string) {
  try { await page.goto(url); }
  catch { throw new Error("Private invitation or authorization navigation failed"); }
}
async function authorize(page: Page, issuer: string, origin: string, surface: Surface, user: DisposableUser, totpSecret?: string) {
  const verifier = randomBytes(32).toString("base64url");
  const redirectUri = "http://127.0.0.1:45996/callback";
  const resource = origin + paths[surface];
  const state = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({ client_id: "pi-announcements", response_type: "code", redirect_uri: redirectUri, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), scope: "admin:manage", state, resource });
  await page.route(redirectUri + "**", route => route.fulfill({ status: 200, body: "Authorized" }));
  await navigatePrivateLink(page, `${issuer}/api/agent/authorize?${params}`);
  await expect(page.locator("#email")).toBeVisible();
  await fillStable(page, "#email", user.email); await page.locator('form:has(#email) button[type="submit"]').click();
  await fillStable(page, "#password", user.password); await page.locator('form:has(#password) button[type="submit"]').click();
  if (totpSecret) { await awaitStableTotpWindow(); await fillOtp(page, generateTotp(totpSecret)); }
  const dialog = page.getByRole("alertdialog", { name: "Authorize app-operator agent" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/organization.*private|private.*organization/i);
  await dialog.getByRole("button", { name: "Authorize app-operator agent" }).click();
  await expect.poll(() => /127\.0\.0\.1:45996\/callback\?/.test(page.url()), { message: "OAuth callback reached" }).toBe(true);
  const callback = new URL(page.url()); expect(callback.searchParams.get("state") === state).toBe(true);
  const form = { grant_type: "authorization_code", code: callback.searchParams.get("code")!, code_verifier: verifier, client_id: "pi-announcements", redirect_uri: redirectUri, resource };
  const response = await page.request.post(issuer + "/api/agent/token", { form });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const token = (await response.json()).access_token as string;
  expect((await page.request.post(issuer + "/api/agent/token", { form })).status()).toBe(400);
  return token;
}
async function a2aRpc(request: APIRequestContext, origin: string, token: string, method: string, params: unknown) {
  return request.post(origin + paths.a2a, { headers: { Authorization: `Bearer ${token}`, "A2A-Version": "1.0" }, data: { jsonrpc: "2.0", id: randomUUID(), method, params } });
}
async function remoteGateway(request: APIRequestContext, origin: string, surface: Surface, token: string): Promise<{ call: Gateway; close: () => Promise<void> }> {
  if (surface === "mcp") {
    const client = new Client({ name: "organization-boundary-acceptance", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + paths.mcp), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(["capabilities_describe", "capabilities_execute", "capabilities_search"]);
    return { close: () => client.close(), call: async (operation, input) => {
      const response = await client.callTool({ name: `capabilities_${operation}`, arguments: input });
      if (response.isError) throw new Error("TRANSPORT_CAPABILITY_DENIED");
      const content = response.content as { type: string; text?: string }[];
      return JSON.parse(content.find(part => part.type === "text")!.text!);
    } };
  }
  return { close: async () => {}, call: async (operation, input) => {
    if (surface === "cli") {
      const response = await request.post(origin + paths.cli, { headers: { Authorization: `Bearer ${token}` }, data: { operation, input } });
      expect(response.headers()["cache-control"]).toContain("no-store");
      if (!response.ok()) throw new Error("TRANSPORT_CAPABILITY_DENIED");
      return (await response.json()).result;
    }
    const response = await a2aRpc(request, origin, token, "SendMessage", { message: { messageId: randomUUID(), role: "ROLE_USER", parts: [{ data: { operation, input } }] } });
    expect(response.headers()["cache-control"]).toContain("no-store");
    if (!response.ok()) throw new Error("TRANSPORT_CAPABILITY_DENIED");
    const task = (await response.json()).result.task;
    if (task.status.state !== "TASK_STATE_COMPLETED") throw new Error("TRANSPORT_CAPABILITY_DENIED");
    return task.artifacts[0].parts[0].data;
  } };
}

async function denyOrganizationActor(page: Page, origin: string, secrets: string[], consent?: { issuer: string; user: DisposableUser }) {
  const { client, token } = await sessionClient(page);
  for (const operation of ["search", "describe", "prepare"] as const) {
    const input = operation === "search" ? { query: "organizations" } : operation === "describe" ? { names: ["organizations_get"] } : { name: "organizations_list", input: { paginationOpts: pageOpts } };
    await expect(client.query(api.platform.agentCapabilities.browserGateway, { operation, input, requestId: randomUUID() })).rejects.toThrow(/NOT_ADMIN|FORBIDDEN/);
  }
  await expect(client.query(api.platform.agentCapabilities.browserRead, { name: "organizations_list", input: { paginationOpts: pageOpts } })).rejects.toThrow(/NOT_ADMIN|FORBIDDEN/);
  await expect(client.mutation(api.platform.agentCapabilities.browserWrite, { name: "announcements_create", input: { name: "Forbidden", bannerText: "Forbidden" } })).rejects.toThrow(/NOT_ADMIN|FORBIDDEN/);
  for (const surface of surfaces) {
    const response = await page.request.post(origin + paths[surface], { headers: { Authorization: `Bearer ${token}` }, data: {} });
    expect(response.status()).toBe(401); excludes(await response.text(), secrets);
  }
  expect(await webMcpTools(page)).toHaveLength(0);
  if (consent) {
    const login = await page.request.post(consent.issuer + "/api/auth/sign-in/email", { headers: { Origin: consent.issuer }, data: { email: consent.user.email, password: consent.user.password } });
    expect(login.status()).toBe(403);
    expect((await login.json()).code).toBe("NOT_ADMIN");
  }
}

test("earned organization actors are denied while all four operator transports preserve privacy and revoke stale authority", async ({ browser, page, request, baseURL }) => {
  test.skip(process.env.AGENT_MCP_ENABLED !== "true" || process.env.E2E_ORGANIZATION_AGENTS !== "true", "Requires explicit cross-app operator acceptance and configured origins");
  const webOrigin = customerOrigin();
  const origin = new URL(baseURL!).origin;
  const metadataResponse = await request.get(origin + "/.well-known/oauth-protected-resource/api/mcp");
  expect(metadataResponse.status()).toBe(200);
  const issuer = (await metadataResponse.json()).authorization_servers[0] as string;
  const operator = await signInAsAdmin(page);
  const { client: operatorClient } = await sessionClient(page);
  let cleanupClient = operatorClient;
  const renewedTokens = new Map<Surface, string>();
  const original = await operatorClient.query(api.platform.agentSurfaces.configuration, {});
  expect(original).toBeTruthy();
  const ownerContext = await browser.newContext({ baseURL: webOrigin });
  const memberContext = await browser.newContext({ baseURL: webOrigin });
  const ownerPage = await ownerContext.newPage(); const memberPage = await memberContext.newPage();
  const owner = await createDisposableUser(); const member = await createDisposableUser();
  const privateName = `private-agent-probe-${randomUUID()}`;
  let organizationId = ""; let ownerId = ""; let memberId = ""; let projectId: Id<"projects">;
  let secrets = [owner.password, member.password, member.email, privateName];
  try {
    for (const surface of [...surfaces, "webmcp"] as const) await operatorClient.mutation(api.platform.agentSurfaces.setEnabled, { surface, enabled: true });
    await installWebMcpSimulator(ownerPage); await installWebMcpSimulator(memberPage);
    await test.step("ordinary personal administrator and pending enrollment cannot use injected WebMCP or remote operator endpoints", async () => {
      await addOrganizationAuthenticator(ownerPage); await signIn(ownerPage, owner.email, owner.password);
      let session = await sessionClient(ownerPage);
      const context = await session.client.query(api.platform.tenantContext.mine, {});
      organizationId = context!.personalOrganizationId!; ownerId = context!.userId;
      projectId = await session.client.mutation(api.tenantProjects.create, { organizationId, name: privateName, description: "Private data must survive control-plane availability changes" });
      await denyOrganizationActor(ownerPage, origin, secrets, { issuer, user: owner });
      await ownerPage.goto("/en/dashboard/organization");
      await ownerPage.locator("#organization-name").fill("Agent boundary organization");
      await ownerPage.locator("#organization-slug").fill(`agent-boundary-${randomUUID().slice(0, 8)}`);
      await ownerPage.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(ownerPage.getByText("Administrator security setup", { exact: true })).toBeVisible();
      await denyOrganizationActor(ownerPage, origin, secrets);
      const factors = await completeOrganizationEnrollment(ownerPage, owner.password);
      secrets = [...secrets, factors.secret, ...factors.backupCodes];
      session = await sessionClient(ownerPage);
      expect((await session.client.query(api.platform.tenantContext.mine, {}))!.contexts.find(item => item.organizationId === organizationId)).toMatchObject({ role: "org-admin", enrollmentPending: false });
      await denyOrganizationActor(ownerPage, origin, secrets, { issuer, user: owner });
    });
    await test.step("a real accepted member stays outside operator authority", async () => {
      const invitation = await issueOrganizationInvitation(ownerPage, member.email);
      await signIn(memberPage, member.email, member.password); await navigatePrivateLink(memberPage, invitation);
      await memberPage.getByRole("button", { name: "Accept invitation", exact: true }).click();
      await expect.poll(() => /\/en\/dashboard\?organizationId=/.test(memberPage.url()), { message: "Accepted invitation reaches selected organization" }).toBe(true);
      const { client } = await sessionClient(memberPage);
      const contexts = await client.query(api.platform.tenantContext.mine, {}); memberId = contexts!.userId;
      expect(contexts!.contexts.find(item => item.organizationId === organizationId)).toMatchObject({ role: "member" });
      await denyOrganizationActor(memberPage, origin, secrets, { issuer, user: member });
    });
    const verifyProjection = async (call: Gateway) => {
      const found = await call("search", { query: "organizations", limit: 15 });
      expect(found).toMatchObject({ matches: expect.arrayContaining([expect.objectContaining({ name: "organizations_get" })]) });
      expect(await call("describe", { names: ["organizations_get", "organizations_setLifecycle", "users_get"] })).toHaveLength(3);
      const detail = await call("execute", { name: "organizations_get", input: { organizationId } }) as { result: Record<string, unknown> };
      expect(detail.result).toMatchObject({ organizationId, contacts: [expect.objectContaining({ email: owner.email })] });
      expect(Object.keys(detail.result).sort()).toEqual(["contacts", "experience", "lifecycle", "name", "organizationId"]);
      excludes(detail, secrets);
      for (const userId of [ownerId, memberId]) {
        for (const name of ["users_get", "users_sessions", "users_ban"]) await expect(call("execute", { name, input: { userId, ...(name === "users_sessions" ? { paginationOpts: pageOpts } : {}) } })).rejects.toThrow();
      }
      await expect(call("describe", { names: ["organizationEnrollment_verifyCredential"] })).rejects.toThrow();
      await expect(call("execute", { name: "tenantProjects_list", input: { organizationId } })).rejects.toThrow();
      const directory = await call("execute", { name: "users_list", input: { paginationOpts: pageOpts, search: member.email, searchField: "email" } });
      expect(directory).toMatchObject({ result: { page: [] } }); excludes(directory, secrets);
      await call("execute", { name: "organizations_setLifecycle", input: { organizationId, lifecycle: "disabled" } });
      const ownerSession = await sessionClient(ownerPage);
      await expect(ownerSession.client.query(api.tenantProjects.list, { organizationId })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
      await call("execute", { name: "organizations_setLifecycle", input: { organizationId, lifecycle: "active" } });
      expect(await ownerSession.client.query(api.tenantProjects.get, { organizationId, id: projectId })).toMatchObject({ name: privateName });
    };
    for (const surface of surfaces) await test.step(`${surface}: real consent, narrow projection, same-backend cache and current-grant revocation`, async () => {
      const token = await authorize(page, issuer, origin, surface, operator);
      const gateway = await remoteGateway(request, origin, surface, token);
      try {
        await verifyProjection(gateway.call);
        if (surface === "a2a") {
          const list = await a2aRpc(request, origin, token, "ListTasks", { includeArtifacts: true });
          expect(list.status()).toBe(200); const history = await list.json(); excludes(history, secrets);
          const otherContext = await browser.newContext({ baseURL: origin }); const otherPage = await otherContext.newPage();
          try {
            const other = await signInAsAdmin(otherPage);
            cleanupClient = (await sessionClient(otherPage)).client;
            const otherToken = await authorize(otherPage, issuer, origin, "a2a", other);
            const otherHistory = await a2aRpc(request, origin, otherToken, "ListTasks", { includeArtifacts: true });
            expect(otherHistory.status()).toBe(200);
            expect((await otherHistory.json()).result).toMatchObject({ tasks: [], totalSize: 0 });
            const taskId = history.result.tasks[0]?.id; expect(taskId).toBeTruthy();
            const foreign = await a2aRpc(request, origin, otherToken, "GetTask", { id: taskId });
            expect(foreign.status()).toBe(400); expect((await foreign.json()).error.code).toBe(-32001);
          } finally { await otherContext.close(); }
        }
        const grants = await operatorClient.query(api.platform.agentAccess.listMine, {});
        const grant = grants.find(item => item.active && item.surface === surface);
        expect(grant).toBeTruthy();
        await operatorClient.mutation(api.platform.agentAccess.revoke, { grantId: grant!._id });
        // The same HTTP process has a warm 30-second structural cache. Authorization
        // must still fail for search, describe, execution and A2A history immediately.
        for (const operation of ["search", "describe", "execute"] as const) await expect(gateway.call(operation, operation === "search" ? { query: "organizations" } : operation === "describe" ? { names: ["organizations_get"] } : { name: "organizations_get", input: { organizationId } })).rejects.toThrow();
        if (surface === "a2a") expect((await a2aRpc(request, origin, token, "ListTasks", { includeArtifacts: true })).status()).toBe(401);
      } finally { await gateway.close(); }
      const renewed = await authorize(page, issuer, origin, surface, operator);
      renewedTokens.set(surface, renewed);
      const next = await remoteGateway(request, origin, surface, renewed);
      try { expect(await next.call("search", { query: "organizations" })).toMatchObject({ matches: expect.any(Array) }); }
      finally { await next.close(); }
      expect((await request.post(origin + paths[surface], { headers: { Authorization: `Bearer ${token}` }, data: {} })).status()).toBe(401);
    });
    await test.step("WebMCP provider: real session, metadata/contact DOM and confirmation portal contain no private tenant data", async () => {
      await installWebMcpSimulator(page); await page.goto(origin + `/manage/organizations/${organizationId}`);
      await expect.poll(async () => (await webMcpTools(page)).length).toBe(3);
      const call: Gateway = (operation, input) => callWebMcp(page, `capabilities_${operation}`, input);
      await verifyProjection(call);
      await page.reload(); await expect(page.getByRole("button", { name: "Disable organization", exact: true })).toBeVisible();
      excludes(await page.locator("body").innerHTML(), secrets);
      const read = await call("execute", { name: "browser_readPage", input: {} }); excludes(read, secrets);
      await page.getByRole("button", { name: "Disable organization", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      excludes(await page.locator("body").innerHTML(), secrets);
      excludes(await call("execute", { name: "browser_readPage", input: {} }), secrets);
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
      await operatorClient.mutation(api.platform.agentSurfaces.setEnabled, { surface: "webmcp", enabled: false });
      await expect.poll(async () => (await webMcpTools(page)).length).toBe(0);
    });
    await test.step("protected operator fixtures cannot be banned; their current grants remain valid", async () => {
      const principal = await operatorClient.query(api.platform.agentRegistry.currentUser, {});
      expect(principal?.id).toBeTruthy();
      await expect(cleanupClient.mutation(api.platform.agentUsers.ban, { userId: principal!.id, reason: "Disposable operator boundary acceptance" })).rejects.toThrow("PROTECTED_ADMIN");
      for (const surface of surfaces) {
        const gateway = await remoteGateway(request, origin, surface, renewedTokens.get(surface)!);
        try { expect(await gateway.call("search", { query: "organizations" })).toMatchObject({ matches: expect.any(Array) }); }
        finally { await gateway.close(); }
      }
    });
  } finally {
    if (organizationId) await cleanupClient.mutation(api.platform.organizations.setLifecycle, { organizationId, lifecycle: "active" });
    for (const surface of [...surfaces, "webmcp"] as const) await cleanupClient.mutation(api.platform.agentSurfaces.setEnabled, { surface, enabled: original!.surfaces[surface].enabled });
    await ownerContext.close(); await memberContext.close();
  }
});

test("a publicly invited operator loses browser authority on session revocation and remote authority on credential change", async ({ browser, page, request, baseURL }) => {
  test.skip(process.env.AGENT_MCP_ENABLED !== "true" || process.env.E2E_ORGANIZATION_AGENTS !== "true", "Requires explicit cross-app operator acceptance and configured origins");
  const origin = new URL(baseURL!).origin;
  const issuer = (await (await request.get(origin + "/.well-known/oauth-protected-resource/api/mcp")).json()).authorization_servers[0] as string;
  await signInAsAdmin(page); const { client: controller } = await sessionClient(page);
  const original = await controller.query(api.platform.agentSurfaces.configuration, {});
  const recipientContext = await browser.newContext({ baseURL: origin }); const recipient = await recipientContext.newPage();
  const invited = { email: disposableEmail(), password: disposablePassword(), name: "Invited operator" };
  try {
    for (const surface of [...surfaces, "webmcp"] as const) await controller.mutation(api.platform.agentSurfaces.setEnabled, { surface, enabled: true });
    const offset = markConvexLogPosition();
    await controller.mutation(api.platform.adminInvitations.invite, { email: invited.email });
    let invitation = "";
    await expect.poll(() => {
      const tail = readFileSync(process.env.E2E_CONVEX_LOG ?? resolve(productRoot, ".convex-dev.log"), "utf8").slice(offset);
      const match = tail.match(/Onboarding URL:\s*((?:(?!\\n)\S)+)/);
      invitation = match?.[1] ?? "";
      return Boolean(invitation);
    }, { timeout: 30_000 }).toBe(true);
    await installWebMcpSimulator(recipient); await addOrganizationAuthenticator(recipient);
    await navigatePrivateLink(recipient, invitation);
    await recipient.getByRole("button", { name: "Get started", exact: true }).click();
    await recipient.locator("#onboarding-name").fill(invited.name);
    await recipient.locator("#onboarding-password").fill(invited.password);
    await recipient.locator("#onboarding-confirm-password").fill(invited.password);
    await recipient.getByRole("button", { name: "Create account", exact: true }).click();
    await recipient.getByRole("button", { name: "Manual setup key", exact: true }).click();
    const secret = (await recipient.locator('[data-slot="copyable-field"] span.font-mono').innerText()).replace(/\s/g, "");
    expect(await webMcpTools(recipient)).toHaveLength(0);
    await recipient.getByRole("button", { name: "Continue to verification", exact: true }).click();
    await awaitStableTotpWindow(); await fillOtp(recipient, generateTotp(secret));
    const showCodes = recipient.locator("#backup-codes-password");
    await expect(showCodes).toBeVisible(); await showCodes.fill(invited.password);
    await recipient.getByRole("button", { name: "View backup codes", exact: true }).click();
    const codes = (await recipient.locator('[data-slot="copyable-field"] pre').innerText()).split("\n").map(value => value.trim()).filter(Boolean);
    expect(codes.length).toBeGreaterThanOrEqual(2);
    await recipient.getByRole("checkbox").check(); await recipient.getByRole("button", { name: "Continue", exact: true }).click();
    await recipient.locator("#verify-code-1").fill(codes[0]); await recipient.locator("#verify-code-2").fill(codes[1]);
    await expect(recipient.getByRole("button", { name: "Continue", exact: true })).toHaveCount(1); // outgoing slide must finish
    await recipient.getByRole("button", { name: "Continue", exact: true }).click();
    await recipient.locator("#passkey-name").fill("Operator acceptance key");
    await recipient.getByRole("button", { name: "Add passkey", exact: true }).click();
    await recipient.getByRole("button", { name: "Complete setup", exact: true }).click();
    await expect.poll(() => /\/sign-in$/.test(recipient.url()), { message: "Completed onboarding reaches sign-in" }).toBe(true);
    await fillStable(recipient, "#email", invited.email); await recipient.locator('form:has(#email) button[type="submit"]').click();
    await fillStable(recipient, "#password", invited.password); await recipient.locator('form:has(#password) button[type="submit"]').click();
    await awaitStableTotpWindow(); await fillOtp(recipient, generateTotp(secret));
    await expect.poll(() => /\/dashboard$/.test(recipient.url()), { message: "MFA sign-in reaches dashboard" }).toBe(true);
    const { client: target } = await sessionClient(recipient);
    const principal = await target.query(api.platform.agentRegistry.currentUser, {}); expect(principal?.role).toBe("admin");
    expect((await controller.query(api.platform.adminEmails.listProtected, {})).includes(invited.email)).toBe(true);
    await expect(controller.mutation(api.platform.agentUsers.ban, { userId: principal!.id })).rejects.toThrow("PROTECTED_ADMIN");
    const tokens = new Map<Surface, string>();
    for (const surface of surfaces) {
      // Pace real repeated step-up proofs within the deployed 5/minute budget.
      await new Promise(resolve => setTimeout(resolve, 12_250));
      const token = await authorize(recipient, issuer, origin, surface, invited, secret); tokens.set(surface, token);
      const gateway = await remoteGateway(request, origin, surface, token);
      try { expect(await gateway.call("search", { query: "organizations" })).toMatchObject({ matches: expect.any(Array) }); }
      finally { await gateway.close(); }
    }
    await recipient.goto(origin + "/manage/organizations"); await expect.poll(async () => (await webMcpTools(recipient)).length).toBe(3);
    excludes(await callWebMcp(recipient, "capabilities_execute", { name: "browser_readPage", input: {} }), [invited.password, secret, ...codes]);
    await controller.mutation(api.platform.agentUsers.revokeSessions, { userId: principal!.id });
    await expect.poll(async () => (await webMcpTools(recipient)).length).toBe(0);
    await expect(target.query(api.platform.agentCapabilities.browserRead, { name: "organizations_list", input: { paginationOpts: pageOpts } })).rejects.toThrow(/NOT_ADMIN|NOT_AUTHENTICATED/);
    // OAuth deliberately consumes its source session at issuance. Independent
    // delegations survive browser-session deletion, but never credential change.
    for (const surface of surfaces) {
      const gateway = await remoteGateway(request, origin, surface, tokens.get(surface)!);
      try { expect(await gateway.call("search", { query: "organizations" })).toMatchObject({ matches: expect.any(Array) }); }
      finally { await gateway.close(); }
    }
    await recipient.goto(origin + "/sign-in");
    await fillStable(recipient, "#email", invited.email); await recipient.locator('form:has(#email) button[type="submit"]').click();
    await fillStable(recipient, "#password", invited.password); await recipient.locator('form:has(#password) button[type="submit"]').click();
    await awaitStableTotpWindow(); await fillOtp(recipient, generateTotp(secret));
    await expect.poll(() => /\/dashboard$/.test(recipient.url()), { message: "MFA sign-in reaches dashboard" }).toBe(true);
    const passwordChange = await recipient.request.post(origin + "/api/auth/change-password", { headers: { Origin: origin }, data: { currentPassword: invited.password, newPassword: disposablePassword(), revokeOtherSessions: true } });
    expect(passwordChange.status()).toBe(200);
    for (const surface of surfaces) {
      const response = await request.post(origin + paths[surface], { headers: { Authorization: `Bearer ${tokens.get(surface)!}` }, data: {} });
      expect(response.status()).toBe(401); excludes(await response.text(), [invited.password, secret, ...codes]);
    }
  } finally {
    for (const surface of [...surfaces, "webmcp"] as const) await controller.mutation(api.platform.agentSurfaces.setEnabled, { surface, enabled: original!.surfaces[surface].enabled });
    await recipientContext.close();
  }
});

test.describe("native Chromium WebMCP organization boundary", () => {
  test("native tools enforce the operator projection and invalidate old opaque controls", async ({ page }) => {
    await page.goto("/sign-in");
    const supported = await page.evaluate(() => Boolean((document as typeof document & { modelContext?: unknown }).modelContext));
    test.skip(!supported, "Installed Chromium lacks native document.modelContext; provider simulator is separate evidence");
    const operator = await signInAsAdmin(page); const { client } = await sessionClient(page);
    const original = await client.query(api.platform.agentSurfaces.configuration, {});
    try {
      await client.mutation(api.platform.agentSurfaces.setEnabled, { surface: "webmcp", enabled: true });
      await page.goto("/manage/organizations");
      await expect.poll(async () => (await webMcpTools(page)).length).toBe(3);
      const call: Gateway = (operation, input) => callWebMcp(page, `capabilities_${operation}`, input);
      expect(await call("describe", { names: ["organizations_list", "organizations_get"] })).toHaveLength(2);
      const directory = await call("execute", { name: "organizations_list", input: { paginationOpts: pageOpts } });
      excludes(directory, [operator.password]);
      await expect(call("describe", { names: ["organizationEnrollment_verifyCredential"] })).rejects.toThrow();
      const before = await call("execute", { name: "browser_readPage", input: {} }) as { result: { controls: { controlId: string }[] } };
      const controlId = before.result.controls[0]?.controlId; expect(controlId).toBeTruthy();
      await client.mutation(api.platform.agentSurfaces.setEnabled, { surface: "webmcp", enabled: false });
      await expect.poll(async () => (await webMcpTools(page)).length).toBe(0);
      await client.mutation(api.platform.agentSurfaces.setEnabled, { surface: "webmcp", enabled: true });
      await expect.poll(async () => (await webMcpTools(page)).length).toBe(3);
      await call("execute", { name: "browser_readPage", input: {} });
      await expect(call("execute", { name: "browser_activate", input: { controlId } })).rejects.toThrow("CONTROL_UNAVAILABLE");
    } finally { await client.mutation(api.platform.agentSurfaces.setEnabled, { surface: "webmcp", enabled: original!.surfaces.webmcp.enabled }); }
  });
});
