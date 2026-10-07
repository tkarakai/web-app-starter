/** Actual Chromium WebMCP engine, separate from the portable provider simulator. */
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { webMcpTools, callWebMcp } from "./helpers/webmcp";
test.use({ launchOptions: { args: ["--enable-blink-features=WebMCP"] } });
test("native WebMCP registration, discovery, authenticated CRUD and removal", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/sign-in");
  const supported = await page.evaluate(() => Boolean((document as typeof document & { modelContext?: unknown }).modelContext));
  test.skip(!supported, "Installed Chromium does not expose the experimental WebMCP API");
  expect(await webMcpTools(page)).toHaveLength(0);
  await signInAsAdmin(page); await page.goto("/configure/features");
  const toggle = page.getByRole("switch", { name: "Enable WebMCP", exact: true }); await expect(toggle).toBeEnabled();
  if (!await toggle.isChecked()) await toggle.click();
  await expect.poll(async () => (await webMcpTools(page)).length).toBe(3);
  const describe = await callWebMcp(page, "capabilities_describe", { names: ["announcements_create"] }); expect(JSON.stringify(describe)).toContain("bannerText");
  const execute = async (name: string, input: Record<string, unknown> = {}) => (await callWebMcp(page, "capabilities_execute", { name, input })) as { result: Record<string, unknown> | null };
  const { result } = await execute("announcements_create", { name: "Native WebMCP draft", bannerText: "Native browser engine" }); const id = result!.id as string;
  try { await execute("announcements_update", { announcementId: id, patch: { bannerText: "Native updated" } }); expect((await execute("announcements_get", { announcementId: id })).result?.bannerText).toBe("Native updated"); }
  finally { await execute("announcements_delete", { announcementId: id }); }
  expect((await execute("announcements_get", { announcementId: id })).result).toBeNull();
  await toggle.click(); await expect.poll(async () => (await webMcpTools(page)).length).toBe(0);
});
