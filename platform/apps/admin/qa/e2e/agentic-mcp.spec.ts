/** Opt-in real remote MCP acceptance against the managed local dev deployment. */
import { randomBytes, createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDisposableUser } from "./helpers/fixtures";
import { fillStable } from "./helpers/auth";

test("browser login, consent and PKCE grant support announcement CRUD and revocation", async ({ page, baseURL, request }) => {
  test.skip(process.env.AGENT_MCP_ENABLED !== "true", "Announcement MCP is opt-in; enable it on the test deployment.");
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("baseURL is required");
  const origin = new URL(baseURL).origin;
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const redirectUri = "http://127.0.0.1:45999/callback";
  const resource = origin + "/api/mcp";
  const params = new URLSearchParams({ client_id: "pi-announcements", response_type: "code", redirect_uri: redirectUri,
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), scope: "announcements:manage", state, resource });
  expect((await request.post("/api/mcp", { data: {} })).status()).toBe(401);
  expect((await request.post("/api/mcp", { data: {}, headers: { Origin: "https://attacker.test" } })).status()).toBe(403);
  const user = await createDisposableUser({ isAdmin: true });
  await page.route("http://127.0.0.1:45999/callback**", route => route.fulfill({ status: 200, body: "Authenticated" }));
  await page.goto(`/api/agent/authorize?${params}`);
  await expect(page).toHaveURL(/sign-in\?agent_return=/);
  await fillStable(page, "#email", user.email);
  await page.locator('form:has(#email) button[type="submit"]').click();
  await fillStable(page, "#password", user.password);
  await page.locator('form:has(#password) button[type="submit"]').click();
  await expect(page).toHaveURL(/\/settings\/agent-access\?/, { timeout: 20_000 });
  await page.getByRole("button", { name: "Authorize pi announcement agent" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:45999\/callback\?code=/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(state);
  const exchange = { grant_type: "authorization_code", code: callback.searchParams.get("code")!, code_verifier: verifier, client_id: "pi-announcements", redirect_uri: redirectUri, resource };
  expect((await request.post("/api/agent/token", { form: { ...exchange, code_verifier: "x".repeat(43) } })).status()).toBe(400);
  const response = await request.post("/api/agent/token", { form: exchange });
  expect(response.status()).toBe(200);
  const token = (await response.json()).access_token as string;
  expect((await request.post("/api/agent/token", { form: exchange })).status()).toBe(400);
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
    await page.goto("/settings/agent-access");
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByText("pi-announcements · revoked", { exact: true })).toBeVisible();
    const denied = await request.post("/api/mcp", { headers: { Authorization: `Bearer ${token}` }, data: {} });
    expect(denied.status()).toBe(401);
  } finally { await client.close(); }
});
