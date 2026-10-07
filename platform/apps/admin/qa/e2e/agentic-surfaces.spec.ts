import { randomBytes, createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { fillStable, signInAsAdmin } from "./helpers/auth";
import { installWebMcpSimulator, webMcpTools, callWebMcp } from "./helpers/webmcp";
async function authorize(page: Page, issuer: string, origin: string, surface: "cli" | "a2a", user: { email: string; password: string }) {
  const verifier = randomBytes(32).toString("base64url"); const redirectUri = "http://127.0.0.1:45998/callback";
  const resource = origin + (surface === "cli" ? "/api/agent/cli" : "/api/a2a");
  const params = new URLSearchParams({ client_id: "pi-announcements", response_type: "code", redirect_uri: redirectUri, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), scope: "admin:manage", state: randomBytes(32).toString("base64url"), resource });
  await page.route(redirectUri + "**", route => route.fulfill({ status: 200, body: "Done" }));
  await page.goto(`${issuer}/api/agent/authorize?${params}`);
  await expect(page).toHaveURL(/sign-in\?.*agent_return=/);
  await fillStable(page, "#email", user.email); await page.locator('form:has(#email) button[type="submit"]').click();
  await fillStable(page, "#password", user.password); await page.locator('form:has(#password) button[type="submit"]').click();
  await page.getByRole("button", { name: "Authorize admin agent" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:45998\/callback\?.*code=/);
  const code = new URL(page.url()).searchParams.get("code")!;
  const response = await page.request.post(issuer + "/api/agent/token", { form: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: "pi-announcements", redirect_uri: redirectUri, resource } });
  expect(response.status()).toBe(200); return (await response.json()).access_token as string;
}
test("CLI and A2A independently authenticate, execute native CRUD and enforce protocol/task controls", async ({ page, request, baseURL }) => {
  test.skip(process.env.AGENT_MCP_ENABLED !== "true", "Opt-in agent origins required"); test.setTimeout(120_000);
  const origin = new URL(baseURL!).origin;
  const issuer = (await (await request.get(origin + "/.well-known/oauth-protected-resource/api/mcp")).json()).authorization_servers[0] as string;
  const user = await signInAsAdmin(page); await page.goto("/configure/features");
  for (const title of ["Admin CLI", "A2A"]) { const control = page.getByRole("switch", { name: `Enable ${title}`, exact: true }); if (!await control.isChecked()) await control.click(); await expect(control).toBeChecked(); }
  const card = await request.get(origin + "/.well-known/agent-card.json"); expect(card.status()).toBe(200); expect((await card.json()).supportedInterfaces).toContainEqual(expect.objectContaining({ protocolVersion: "1.0", protocolBinding: "JSONRPC" }));
  expect((await request.post(origin + "/api/a2a", { data: {} })).status()).toBe(401);
  expect((await request.post(origin + "/api/agent/cli", { data: {} })).status()).toBe(401);
  const cliToken = await authorize(page, issuer, origin, "cli", user);
  const cli = async (operation: string, input: unknown) => { const response = await request.post(origin + "/api/agent/cli", { headers: { Authorization: `Bearer ${cliToken}` }, data: { operation, input } }); expect(response.status()).toBe(200); return (await response.json()).result; };
  expect((await cli("search", { query: "users" })).matches.length).toBeGreaterThan(0);
  const created = await cli("execute", { name: "announcements_create", input: { name: "CLI acceptance", bannerText: "CLI" } });
  const cliId = created.result.id as string;
  try { await cli("execute", { name: "announcements_update", input: { announcementId: cliId, patch: { bannerText: "CLI changed" } } }); expect((await cli("execute", { name: "announcements_get", input: { announcementId: cliId } })).result.bannerText).toBe("CLI changed"); }
  finally { await cli("execute", { name: "announcements_delete", input: { announcementId: cliId } }); }
  const token = await authorize(page, issuer, origin, "a2a", user);
  let counter = 0;
  const rpc = async (method: string, params: unknown, version = "1.0", credential = token) => request.post(origin + "/api/a2a", { headers: { Authorization: `Bearer ${credential}`, "A2A-Version": version }, data: { jsonrpc: "2.0", id: ++counter, method, params } });
  expect((await rpc("ListTasks", {}, "0.3")).status()).toBe(400);
  expect((await rpc("ListTasks", {}, "1.0", cliToken)).status()).toBe(401);
  const command = async (name: string, input: unknown) => { const response = await rpc("SendMessage", { message: { messageId: randomBytes(16).toString("hex"), role: "ROLE_USER", parts: [{ data: { operation: "execute", input: { name, input } } }] } }); expect(response.status()).toBe(200); const task = (await response.json()).result.task; expect(task.status.state).toBe("TASK_STATE_COMPLETED"); return { taskId: task.id as string, value: task.artifacts[0].parts[0].data.result }; };
  const a2a = await command("announcements_create", { name: "A2A acceptance", bannerText: "A2A" }); const id = a2a.value.id as string;
  try { await command("announcements_update", { announcementId: id, patch: { bannerText: "A2A changed" } }); expect((await command("announcements_get", { announcementId: id })).value.bannerText).toBe("A2A changed"); }
  finally { await command("announcements_delete", { announcementId: id }); }
  expect((await (await rpc("CancelTask", { id: a2a.taskId })).json()).error.code).toBe(-32002);
  const pending = await rpc("SendMessage", { message: { messageId: randomBytes(16).toString("hex"), role: "ROLE_USER", parts: [{ text: "Please help" }] } });
  const waiting = (await pending.json()).result.task; expect(waiting.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
  expect((await (await rpc("CancelTask", { id: waiting.id })).json()).result.status.state).toBe("TASK_STATE_CANCELED");
  expect((await (await rpc("GetTask", { id: "not-owned-or-missing" })).json()).error.code).toBe(-32001);
  await page.goto(origin + "/configure/features");
  await page.getByRole("switch", { name: "Enable Admin CLI", exact: true }).click();
  await expect.poll(async () => (await request.post(origin + "/api/agent/cli", { headers: { Authorization: `Bearer ${cliToken}` }, data: { operation: "search", input: {} } })).status()).toBe(503);
  expect((await rpc("ListTasks", {})).status()).toBe(200);
  await page.getByRole("switch", { name: "Enable A2A", exact: true }).click();
  await expect.poll(async () => (await rpc("ListTasks", {})).status()).toBe(503);
});

test("WebMCP provider simulator uses a real admin session, native CRUD, live controls and cleanup", async ({ page }) => {
  test.setTimeout(90_000); await installWebMcpSimulator(page);
  await page.goto("/sign-in"); expect(await webMcpTools(page)).toHaveLength(0);
  await signInAsAdmin(page); await page.goto("/configure/features");
  const toggle = page.getByRole("switch", { name: "Enable WebMCP", exact: true }); if (!await toggle.isChecked()) await toggle.click();
  await expect.poll(async () => (await webMcpTools(page)).length).toBe(3);
  const execute = async (name: string, input: Record<string, unknown> = {}) => (await callWebMcp(page, "capabilities_execute", { name, input })) as { result: Record<string, unknown> };
  expect(await callWebMcp(page, "capabilities_search", { query: "browser" })).toMatchObject({ matches: expect.arrayContaining([expect.objectContaining({ name: "browser_readPage" })]) });
  const { result } = await execute("announcements_create", { name: "WebMCP acceptance", bannerText: "Browser" }); const id = result.id as string;
  try { await execute("announcements_update", { announcementId: id, patch: { bannerText: "Browser changed" } }); expect((await execute("announcements_get", { announcementId: id })).result.bannerText).toBe("Browser changed"); }
  finally { await execute("announcements_delete", { announcementId: id }); }
  await execute("browser_navigate", { path: "/manage/announcements" }); await expect(page).toHaveURL(/\/manage\/announcements$/);
  const snapshot = await execute("browser_readPage") as unknown as { result: { controls: { controlId: string; name: string }[] } };
  const create = snapshot.result.controls.find(control => /new announcement|create announcement/i.test(control.name)); expect(create).toBeDefined();
  await execute("browser_activate", { controlId: create!.controlId });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/settings?tab=security"); await expect.poll(async () => (await webMcpTools(page)).length).toBe(3);
  const secure = await execute("browser_readPage"); expect(JSON.stringify(secure)).not.toContain("Current Password");
  await page.goto("/configure/features"); await page.getByRole("switch", { name: "Enable WebMCP", exact: true }).click();
  await expect.poll(async () => (await webMcpTools(page)).length).toBe(0);
});
