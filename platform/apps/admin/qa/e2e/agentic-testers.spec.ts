/** Opt-in real clients and inference. These tests never require a provider in ordinary CI. */
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { fillStable, signInAsAdmin } from "./helpers/auth";
const productRoot = resolve(__dirname, "../../../../..");
async function runTester(page: Page, origin: string, user: { email: string; password: string }, script: string, args: string[]) {
  const child = spawn("bun", [script, "--origin", origin, ...args], { cwd: productRoot, env: { ...process.env, AGENT_NO_OPEN: "true" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; let errors = ""; let accept!: (value: string) => void;
  const urlPromise = new Promise<string>((resolve, reject) => { accept = resolve; child.once("error", reject); });
  child.stdout.on("data", value => { output += String(value); const url = output.match(/https?:\/\/[^\s]+\/api\/agent\/authorize\?[^\s]+/); if (url) accept(url[0]); });
  child.stderr.on("data", value => { errors += String(value); });
  const completion = new Promise<number | null>(resolve => child.once("exit", resolve));
  try {
    const url = await Promise.race([urlPromise, completion.then(() => { throw new Error("Tester exited before authorization"); }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Tester authorization timeout")), 20_000))]);
    await page.goto(url); await expect(page).toHaveURL(/sign-in\?.*agent_return=/);
    await fillStable(page, "#email", user.email); await page.locator('form:has(#email) button[type="submit"]').click();
    await fillStable(page, "#password", user.password); await page.locator('form:has(#password) button[type="submit"]').click();
    await page.getByRole("button", { name: "Authorize admin agent" }).click();
    const exit = await Promise.race([completion, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Tester completion timeout")), 120_000))]);
    // Remove the initial OAuth URL before attaching/logging a report.
    const safe = output.replace(/https?:\/\/[^\s]+\/api\/agent\/authorize\?[^\s]+/g, "[authorization URL omitted]");
    if (exit !== 0) throw new Error(`Tester failed (${exit}): ${errors}\n${safe}`);
    return safe;
  } finally { if (child.exitCode === null) child.kill("SIGTERM"); }
}
for (const surface of ["mcp", "cli", "a2a"] as const) test(`independent ${surface} simulator validates the full catalogue and measures performance`, async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.AGENT_SIMULATORS !== "true", "Explicit all-capability simulator run"); test.setTimeout(150_000);
  const user = await signInAsAdmin(page); const origin = new URL(baseURL!).origin;
  await page.goto("/configure/features");
  const title = surface === "mcp" ? "MCP server" : surface === "cli" ? "Admin CLI" : "A2A";
  const toggle = page.getByRole("switch", { name: `Enable ${title}`, exact: true }); await expect(toggle).toBeEnabled(); if (!await toggle.isChecked()) await toggle.click(); await expect(toggle).toBeChecked();
  const output = await runTester(page, origin, user, "platform/packages/announcement-agent/src/simulator.ts", ["--surface", surface]);
  const summary = output.slice(output.indexOf("{\n"));
  process.stdout.write(summary);
  if (process.env.AGENT_EVIDENCE_DIR) { await mkdir(process.env.AGENT_EVIDENCE_DIR, { recursive: true }); await writeFile(resolve(process.env.AGENT_EVIDENCE_DIR, `${surface}-simulator.json`), summary); }
  expect(output).toContain('"disposableDraftCleaned": true'); expect(output).toContain('"capabilities":');
  await testInfo.attach(`${surface}-measurements`, { body: output, contentType: "application/json" });
});
for (const surface of ["mcp", "cli", "a2a"] as const) test(`pi conversation discovers and manages a draft through ${surface}`, async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.AGENT_LLM_SMOKE !== "true", "Explicit provider-backed pi acceptance"); test.setTimeout(150_000);
  const user = await signInAsAdmin(page); const origin = new URL(baseURL!).origin;
  await page.goto("/configure/features"); const title = surface === "mcp" ? "MCP server" : surface === "cli" ? "Admin CLI" : "A2A";
  const toggle = page.getByRole("switch", { name: `Enable ${title}`, exact: true }); await expect(toggle).toBeEnabled(); if (!await toggle.isChecked()) await toggle.click(); await expect(toggle).toBeChecked();
  const name = `Pi full-surface ${surface} ${Date.now()}`;
  const reportPath = testInfo.outputPath(`${surface}-pi-evidence.json`);
  const output = await runTester(page, origin, user, "platform/packages/announcement-agent/src/cli.ts", ["--report", reportPath, "--surface", surface, "--provider", process.env.AGENT_TEST_PROVIDER ?? "openai-codex", "--model", process.env.AGENT_TEST_MODEL ?? "gpt-6.1-sol", "--prompt", `Discover the administration capabilities and inspect their schemas. Create an unscheduled announcement draft named ${name} with banner text Pi acceptance. Read it, update the banner to Pi verified, read it to verify, then permanently delete only that draft and verify it is gone. I explicitly authorize this disposable draft CRUD. Also read current MFA policy and list the first five users without changing users or policy. Report all tool errors.`]);
  expect(output).toContain("[capabilities_search]"); expect(output).toContain("[capabilities_describe]"); expect(output).toContain("[capabilities_execute]");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as { tools: { capability?: string; success: boolean; createdAnnouncementId?: string; announcementId?: string; absent?: boolean; bannerHash?: string }[] };
  expect(report.tools.filter(tool => !tool.success)).toHaveLength(0);
  const created = report.tools.find(tool => tool.capability === "announcements_create"); expect(created?.createdAnnouncementId).toBeTruthy();
  const id = created!.createdAnnouncementId!;
  expect(report.tools).toEqual(expect.arrayContaining([expect.objectContaining({ capability: "announcements_update", announcementId: id, success: true }), expect.objectContaining({ capability: "announcements_delete", announcementId: id, success: true }), expect.objectContaining({ capability: "announcements_get", announcementId: id, absent: true })]));
  await testInfo.attach(`${surface}-pi-evidence`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  if (process.env.AGENT_EVIDENCE_DIR) { await mkdir(process.env.AGENT_EVIDENCE_DIR, { recursive: true }); await writeFile(resolve(process.env.AGENT_EVIDENCE_DIR, `${surface}-pi.json`), JSON.stringify(report, null, 2) + "\n"); }
  await page.goto(origin + "/manage/announcements"); await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await testInfo.attach(`${surface}-pi-conversation`, { body: output, contentType: "text/plain" });
});
