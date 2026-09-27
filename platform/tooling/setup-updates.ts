#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { demand } from "./platform-upgrade/metadata.ts";
import { gh, repository, configured, type Gh } from "./setup-updates/github.ts";
import { startSetup } from "./setup-updates/server.ts";

export function installCaller(root: string): boolean {
  const destination = path.join(root, ".github/workflows/update-platform.yml");
  for (const relative of [".github", ".github/workflows", ".github/workflows/update-platform.yml"]) {
    try { demand(!fs.lstatSync(path.join(root, relative)).isSymbolicLink(), "Update caller path must not traverse a symlink"); }
    catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
  }
  if (fs.existsSync(destination)) return false;
  const template = fs.readFileSync(path.join(root, "platform/templates/update-platform.yml"), "utf8");
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, template, { flag: "wx" }); return true;
}
export type Options = { repo?: string; check: boolean; fallback: boolean; replace: boolean; open: boolean };
export function argumentsFor(args: string[]): Options {
  const options: Options = { check: false, fallback: false, replace: false, open: true };
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === "--repo") { demand(!options.repo && args[i + 1], "--repo needs one owner/repo"); options.repo = args[++i]; }
    else if (value === "--check") options.check = true;
    else if (value === "--fallback") options.fallback = true;
    else if (value === "--replace") options.replace = true;
    else if (value === "--no-open") options.open = false;
    else throw Error("Unknown option: " + value);
  }
  demand(!(options.check && (options.fallback || options.replace)), "--check is read-only and cannot configure updates");
  demand(!(options.fallback && options.replace), "Fallback does not replace App credentials; remove the App ID variable explicitly if switching modes");
  if (options.repo) demand(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo), "Repository must be owner/repo");
  return options;
}
export const HELP = `Usage: bun run platform:setup-updates [--repo owner/repo] [--no-open]
  --check       Read configuration status only; never reads the stored private key
  --fallback    Install/preserve the caller and explain GITHUB_TOKEN setup
  --replace     Explicitly configure a new App over existing updater settings
Requires an adopted app, Node 24 and authenticated gh with repository administration access.
Registration and installation open in your browser; select only this app repository.
`;
export async function main(argv: string[], run: Gh = gh): Promise<number> {
  if (argv.includes("--help")) { process.stdout.write(HELP); return 0; }
  const options = argumentsFor(argv), root = fs.realpathSync(process.cwd());
  demand(fs.existsSync(path.join(root, ".platform-base.json")), "Run setup in an adopted app repository");
  const selected = options.repo ?? JSON.parse(run(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
  demand(typeof selected === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(selected), "Could not determine owner/repo");
  const repo = repository(JSON.parse(run(["api", "repos/" + selected]))), existing = configured(repo.full_name, run);
  if (options.check) { process.stdout.write(JSON.stringify({ repo: repo.full_name, appId: existing.id ?? null, privateKeyPresent: existing.key, callerPresent: fs.existsSync(path.join(root, ".github/workflows/update-platform.yml")), note: "Stored key validity is checked when the workflow mints its token." }, null, 2) + "\n"); return 0; }
  const added = installCaller(root); process.stdout.write(added ? "Added .github/workflows/update-platform.yml; review and commit it.\n" : "Preserved your existing update caller.\n");
  if (options.fallback) {
    demand(!existing.id, "An App ID is already configured. Fallback leaves credentials intact; remove PLATFORM_UPDATER_APP_ID explicitly if switching to GITHUB_TOKEN.");
    const settings = JSON.parse(run(["api", "repos/" + repo.full_name + "/actions/permissions/workflow"]));
    process.stdout.write("GITHUB_TOKEN fallback: workflow-file changes become manual-upgrade issues; PR CI may need Approve and run.\n");
    if (!settings.can_approve_pull_request_reviews) process.stdout.write("Enable Allow GitHub Actions to create and approve pull requests in https://github.com/" + repo.full_name + "/settings/actions before running updates.\n");
    return 0;
  }
  if ((existing.id || existing.key) && !options.replace) {
    demand(existing.id && existing.key, "Updater settings are incomplete. Correct them manually or pass --replace to configure a new App explicitly.");
    process.stdout.write("Updater App settings already exist and were preserved. Run Actions → Update platform to verify them; use --replace only to configure a new App.\n"); return 0;
  }
  const session = await startSetup({ repo, run });
  process.stdout.write("Open updater setup: " + session.url + "\nLeave this terminal running through registration and installation.\n");
  if (options.open) {
    try { if (process.platform === "darwin") execFileSync("open", [session.url], { stdio: "ignore" }); else if (process.platform === "win32") execFileSync("cmd.exe", ["/c", "start", "", session.url], { stdio: "ignore" }); else execFileSync("xdg-open", [session.url], { stdio: "ignore" }); }
    catch { process.stdout.write("Automatic browser opening was unavailable; use the URL above.\n"); }
  }
  const cancel = () => session.close(); process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try { const result = await session.done; process.stdout.write("Configured App " + result.id + " (https://github.com/apps/" + result.slug + ") for " + repo.full_name + ".\nRun Actions → Update platform after committing the caller.\n"); return 0; }
  finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { process.stderr.write("setup-updates: " + (error instanceof Error ? error.message : "Setup failed") + "\n"); process.exitCode = 1; });
