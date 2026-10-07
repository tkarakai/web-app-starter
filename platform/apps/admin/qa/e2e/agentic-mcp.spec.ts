/** Opt-in real remote MCP acceptance against the managed local dev deployment. */
import { randomBytes, createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SESSION_COOKIE_NAME } from "@web-app-starter/auth/cookies";
import { fillStable, signInAsAdmin } from "./helpers/auth";

test("browser login, consent and PKCE grant support announcement CRUD and revocation", async ({ page, baseURL, request }) => {
  test.skip(process.env.AGENT_MCP_ENABLED !== "true", "Announcement MCP is opt-in; enable it on the test deployment.");
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("baseURL is required");
  const origin = new URL(baseURL).origin;
  const metadata = await (await request.get(origin + "/.well-known/oauth-protected-resource/api/mcp")).json();
  const issuer = metadata.authorization_servers[0] as string;
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const redirectUri = "http://127.0.0.1:45999/callback";
  const resource = origin + "/api/mcp";
  const params = new URLSearchParams({ client_id: "pi-announcements", response_type: "code", redirect_uri: redirectUri,
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), scope: "announcements:manage", state, resource });
  const user = await signInAsAdmin(page);
  await page.goto("/configure/features");
  const serverSwitch = page.getByRole("switch", { name: "Enable MCP server" });
  await expect(serverSwitch).toBeEnabled();
  if (!await serverSwitch.isChecked()) await serverSwitch.click();
  await expect(serverSwitch).toBeChecked();
  expect((await request.post("/api/mcp", { data: {} })).status()).toBe(401);
  expect((await request.post("/api/mcp", { data: {}, headers: { Origin: "https://attacker.test" } })).status()).toBe(403);
  await page.route("http://127.0.0.1:45999/callback**", route => route.fulfill({ status: 200, body: "Authenticated" }));
  await page.context().addCookies([{ name: SESSION_COOKIE_NAME, value: "expired-fixture-cookie", url: issuer }]);
  await page.goto(`${issuer}/api/agent/authorize?${params}`);
  await expect(page).toHaveURL(/sign-in\?.*agent_return=/);
  await fillStable(page, "#email", user.email);
  await page.locator('form:has(#email) button[type="submit"]').click();
  await fillStable(page, "#password", user.password);
  await page.locator('form:has(#password) button[type="submit"]').click();
  await expect(page).toHaveURL(/\/settings\/agent-access\?/, { timeout: 20_000 });
  const dialog = page.getByRole("alertdialog", { name: "Authorize announcement agent" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(new URL(page.url()).origin).toBe(issuer);
  const cookies = await page.context().cookies();
  const applicationCookie = cookies.find(cookie => cookie.name === SESSION_COOKIE_NAME && cookie.domain === new URL(origin).hostname);
  const authorizationCookie = cookies.find(cookie => cookie.name === SESSION_COOKIE_NAME && cookie.domain === new URL(issuer).hostname);
  expect(applicationCookie).toBeDefined();
  expect(authorizationCookie).toBeDefined();
  expect(authorizationCookie?.value).not.toBe(applicationCookie?.value);
  for (const path of ["/dashboard", "/configure/features", "/manage/announcements", "/api/auth/admin/list-users", "/api/mcp"])
    expect((await page.request.get(issuer + path)).status()).toBe(404);
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deny access", exact: true })).toBeFocused();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/agent-access\?/);
  await dialog.getByRole("button", { name: "Authorize pi announcement agent" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:45999\/callback\?code=/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(state);
  const exchange = { grant_type: "authorization_code", code: callback.searchParams.get("code")!, code_verifier: verifier, client_id: "pi-announcements", redirect_uri: redirectUri, resource };
  expect((await request.post(issuer + "/api/agent/token", { form: { ...exchange, code_verifier: "x".repeat(43) } })).status()).toBe(400);
  expect((await request.post(origin + "/api/agent/token", { form: exchange })).status()).toBe(403);
  const response = await request.post(issuer + "/api/agent/token", { form: exchange });
  expect(response.status()).toBe(200);
  const token = (await response.json()).access_token as string;
  expect((await request.post(issuer + "/api/agent/token", { form: exchange })).status()).toBe(400);
  const client = new Client({ name: "independent-admin-acceptance", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    const content = result.content as { type: string; text?: string }[];
    return JSON.parse(content.find(c => c.type === "text")?.text ?? "null") as unknown;
  };
  try {
    expect((await client.listTools()).tools).toHaveLength(5);
    const { id } = await call("announcements_create", { name: "Browser MCP acceptance", bannerText: "First" }) as { id: string };
    try {
      expect(await call("announcements_get", { announcementId: id })).toMatchObject({ bannerText: "First", isLive: false });
      await call("announcements_update", { announcementId: id, patch: { bannerText: "Second" } });
      expect(await call("announcements_get", { announcementId: id })).toMatchObject({ bannerText: "Second" });
      expect(await call("announcements_list", {})).toEqual(expect.arrayContaining([expect.objectContaining({ _id: id })]));
    } finally { await call("announcements_delete", { announcementId: id }); }
    expect(await call("announcements_get", { announcementId: id })).toBeNull();
    await page.goto(origin + "/settings/agent-grants");
    await page.goto(origin + "/configure/features");
    await page.getByRole("switch", { name: "Enable MCP server" }).click();
    await expect(page.getByRole("switch", { name: "Enable MCP server" })).not.toBeChecked();
    expect((await request.post("/api/mcp", { headers: { Authorization: `Bearer ${token}` }, data: {} })).status()).toBe(503);
    await page.getByRole("switch", { name: "Enable MCP server" }).click();
    await expect(page.getByRole("switch", { name: "Enable MCP server" })).toBeChecked();
    const denied = await request.post("/api/mcp", { headers: { Authorization: `Bearer ${token}` }, data: {} });
    expect(denied.status()).toBe(401);
  } finally { await client.close(); }
});


test("denying modal consent returns to pi without granting access", async ({ page, baseURL, request }) => {
  test.skip(process.env.AGENT_MCP_ENABLED !== "true", "Announcement MCP is opt-in.");
  test.setTimeout(60_000);
  if (!baseURL) throw new Error("baseURL is required");
  const origin = new URL(baseURL).origin;
  const user = await signInAsAdmin(page);
  const metadata = await (await request.get(origin + "/.well-known/oauth-protected-resource/api/mcp")).json();
  const issuer = metadata.authorization_servers[0] as string;
  const state = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({ client_id: "pi-announcements", response_type: "code", redirect_uri: "http://127.0.0.1:45999/callback",
    code_challenge_method: "S256", code_challenge: randomBytes(32).toString("base64url"), scope: "announcements:manage", state, resource: origin + "/api/mcp" });
  await page.route("http://127.0.0.1:45999/callback**", route => route.fulfill({ status: 200, body: "Access denied" }));
  await page.goto(`${issuer}/api/agent/authorize?${params}`);
  await expect(page).toHaveURL(/sign-in\?.*agent_return=/);
  await fillStable(page, "#email", user.email);
  await page.locator('form:has(#email) button[type="submit"]').click();
  await fillStable(page, "#password", user.password);
  await page.locator('form:has(#password) button[type="submit"]').click();
  await expect(page).toHaveURL(/\/settings\/agent-access\?/, { timeout: 20_000 });
  const dialog = page.getByRole("alertdialog", { name: "Authorize announcement agent" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Deny access", exact: true }).click();
  await expect(page).toHaveURL(/callback\?error=access_denied/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(state);
  expect(callback.searchParams.has("code")).toBe(false);
  await page.goto("/settings/agent-grants");
  await expect(page.getByText("No agent grants.", { exact: true })).toBeVisible();
});
