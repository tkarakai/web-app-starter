/** Reusable independent remote-surface acceptance and discovery/performance measurement. */
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { authenticate } from "./auth";
import { connectMcp, type AdminToolConnection } from "./client";
import { connectCli } from "./cli-client";
import { connectA2a } from "./a2a-client";
const args = process.argv.slice(2); const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
async function main() {
  if (args.includes("--help")) { process.stdout.write("Admin surface simulator: --surface mcp|cli|a2a [--origin URL] [--output summary.json] [--read-only]\nAuthenticates in the browser; validates every discovered schema, representative reads, and CRUD of its own disposable draft. Does not send email or modify users/policy. Output contains measurements only, never app data or credentials.\n"); return; }
  const surface = option("--surface") ?? "mcp"; if (!["mcp", "cli", "a2a"].includes(surface)) throw new Error("Use --surface mcp, cli or a2a");
  const origin = option("--origin") ?? "http://localhost:3002";
  const token = await authenticate(origin, surface as "mcp" | "cli" | "a2a");
  const client: AdminToolConnection = surface === "mcp" ? await connectMcp(origin, token) : surface === "cli" ? connectCli(origin, token) : await connectA2a(origin, token);
  const timings: number[] = []; const started = performance.now(); let responseCharacters = 0;
  async function call(name: string, input: Record<string, unknown>) {
    const before = performance.now(); const result = await client.callTool({ name, arguments: input }); timings.push(performance.now() - before);
    const content = result.content as { text?: string }[]; const text = content[0]?.text ?? "null"; responseCharacters += text.length;
    if (result.isError) throw new Error(`${name} failed: ${text}`);
    return JSON.parse(text);
  }
  const execute = (name: string, input: Record<string, unknown> = {}) => call("capabilities_execute", { name, input });
  try {
    const bootstrap = JSON.stringify(await client.listTools());
    const matches: { name: string; effect: string }[] = []; let offset: number | null = 0;
    do { const page = await call("capabilities_search", { offset, limit: 15 }); matches.push(...page.matches); offset = page.nextOffset; } while (offset !== null);
    if (new Set(matches.map(row => row.name)).size !== matches.length) throw new Error("Duplicate discovery entries");
    let schemaCharacters = 0;
    for (let i = 0; i < matches.length; i += 3) {
      const rows = await call("capabilities_describe", { names: matches.slice(i, i + 3).map(row => row.name) });
      for (const row of rows) { if (row.inputSchema.type !== "object") throw new Error("Invalid input schema"); schemaCharacters += JSON.stringify(row.inputSchema).length; }
    }
    const reads = ["account_currentUser", "account_assurance", "account_onboardingStatus", "account_ownPasskeys", "announcements_list", "announcements_active", "settings_keys", "settings_getEmailTemplate", "settings_getVerificationEmailTemplate", "security_getMfaPolicy", "security_getEmailVerificationPolicy", "admins_listProtected", "integrations_getStatus", "profile_get", "profile_getLocale", "surfaces_configuration"];
    for (const name of reads) await execute(name);
    for (const name of ["users_list", "invitations_list", "waitlist_list", "audit_list"]) await execute(name, { paginationOpts: { numItems: 5, cursor: null } });
    if (!args.includes("--read-only")) {
      const created = await execute("announcements_create", { name: `Surface simulator ${surface} ${Date.now()}`, bannerText: "Disposable simulator draft" }); const id = created.result.id as string;
      if (!id) throw new Error("Create returned no ID");
      try {
        await execute("announcements_update", { announcementId: id, patch: { bannerText: "Simulator updated" } });
        const row = await execute("announcements_get", { announcementId: id }); if (row.result.bannerText !== "Simulator updated") throw new Error("Update did not persist");
      } finally { await execute("announcements_delete", { announcementId: id }); }
      if ((await execute("announcements_get", { announcementId: id })).result !== null) throw new Error("Delete did not persist");
    }
    timings.sort((a, b) => a - b);
    const summary = { surface, capabilities: matches.length, effects: Object.fromEntries(["read", "write", "browser", "human"].map(effect => [effect, matches.filter(row => row.effect === effect).length])), bootstrapCharacters: bootstrap.length, bootstrapApproxTokens: Math.ceil(bootstrap.length / 4), approximation: "characters/4, not a provider tokenizer", selectedSchemasCharacters: schemaCharacters, responseCharacters, requests: timings.length, p50Ms: Math.round(timings[Math.floor(timings.length * .5)]!), p95Ms: Math.round(timings[Math.floor(timings.length * .95)]!), elapsedMs: Math.round(performance.now() - started), disposableDraftCleaned: !args.includes("--read-only") };
    const output = JSON.stringify(summary, null, 2) + "\n"; if (option("--output")) await writeFile(option("--output")!, output); process.stdout.write(output);
  } finally { await client.close(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Simulator failed"}\n`); process.exitCode = 1; });
