#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { configureWorkers, type WorkerHost } from "./setup-updates/workers.ts";
import { workerVariables, type WorkerChoice, type WorkerRecord } from "./setup-updates/worker-state.ts";
import { pathToFileURL } from "node:url";
import { demand } from "./platform-upgrade/metadata.ts";
import { gh, repository, configured, type Gh } from "./setup-updates/github.ts";
import { startSetup } from "./setup-updates/server.ts";
import { MODE_VARIABLE, guardCaller, isDeliveryMode, readRecord, saveRecord, summary, updateStatus, type DeliveryMode } from "./setup-updates/state.ts";

export function installCaller(root: string): boolean {
  const destination = path.join(root, ".github/workflows/update-platform.yml");
  for (const relative of [".github", ".github/workflows", ".github/workflows/update-platform.yml"]) {
    try { demand(!fs.lstatSync(path.join(root, relative)).isSymbolicLink(), "Update caller path must not traverse a symlink"); }
    catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
  }
  const template = fs.readFileSync(path.join(root, "platform/templates/update-platform.yml"), "utf8");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let descriptor: number;
  try { descriptor = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644); }
  catch (error) { if ((error as { code?: string }).code === "EEXIST") return false; throw error; }
  try { fs.writeFileSync(descriptor, template); } finally { fs.closeSync(descriptor); }
  return true;
}
export type Options = { workers?: WorkerChoice; workerRun?: string; verifyHome?: string; deliverHome?: string; repo?: string; check: boolean; json: boolean; fallback: boolean; mode?: DeliveryMode; replace: boolean; open: boolean; yes: boolean };
export function argumentsFor(args: string[]): Options {
  const options: Options = { check: false, json: false, fallback: false, replace: false, open: true, yes: false };
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === "--repo") { demand(!options.repo && args[i + 1], "--repo needs one owner/repo"); options.repo = args[++i]; }
    else if (value === "--workers") { demand(!options.workers && ["hosted", "local"].includes(args[i + 1]), "--workers takes hosted or local"); options.workers = args[++i] as WorkerChoice; }
    else if (value === "--worker-run") { demand(/^[1-9][0-9]*$/.test(args[i + 1] ?? ""), "--worker-run needs a run ID"); options.workerRun = args[++i]; }
    else if (value === "--verify-home" || value === "--deliver-home") { demand(args[i + 1] && path.isAbsolute(args[i + 1]), value + " needs an absolute installation path"); options[value === "--verify-home" ? "verifyHome" : "deliverHome"] = args[++i]; }
    else if (value === "--check") options.check = true;
    else if (value === "--json") options.json = true;
    else if (["--app", "--fallback", "--defer"].includes(value)) {
      demand(!options.mode, "Choose one delivery mode"); options.mode = value === "--defer" ? "deferred" : value.slice(2) as DeliveryMode;
      options.fallback = options.mode === "fallback";
    }
    else if (value === "--yes") options.yes = true;
    else if (value === "--replace") options.replace = true;
    else if (value === "--no-open") options.open = false;
    else throw Error("Unknown option: " + value);
  }
  demand(!(options.check && (options.mode || options.replace || options.yes || options.workers || options.workerRun || options.verifyHome || options.deliverHome)), "--check is read-only and cannot configure updates");
  demand(!options.json || options.check, "--json requires --check");
  demand(!(options.fallback && options.replace), "Fallback does not replace App credentials; remove the App ID variable explicitly if switching modes");
  demand(!options.replace || !options.mode || options.mode === "app", "--replace is for App setup only");
  demand(!options.workerRun || options.workers === "local", "--worker-run requires --workers local");
  demand((!options.verifyHome && !options.deliverHome) || (options.workers === "local" && options.verifyHome && options.deliverHome && options.verifyHome !== options.deliverHome), "Select both distinct installation paths with --workers local");
  if (options.repo) demand(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo), "Repository must be owner/repo");
  return options;
}
export const HELP = `Usage: bun run platform:setup-updates [--repo owner/repo]
  --check [--json] Read-only live readiness and recorded intent; never reads a stored key
  --app           Guided repository-only App setup (recommended); --no-open prints a local URL
  --fallback      Built-in token: limited workflow delivery and manual PR CI
  --defer         Pause delivery without deleting credentials; manual updates remain available
  --workers hosted|local  Choose GitHub-hosted workers or two local Docker installations
  --worker-run ID  Validate the completed local-worker GitHub test before enabling routing
  --verify-home PATH --deliver-home PATH  Reuse two existing installations (absolute paths)
  --yes           Explicit owner consent to the selected mode's remote changes
  --replace       Explicitly register a new App; preserve existing credentials otherwise
Without --yes, setup records pending intent and prepares a guarded caller locally.
Fallback --yes enables the repository-wide create/approve PR capability, preserves default
workflow permissions, and does not submit approvals or enable auto-merge.
`;
/** Change only the PR capability after owner consent, preserving restricted token defaults. */
export function enableFallback(repo: string, run: Gh): void {
  const endpoint = "repos/" + repo + "/actions/permissions/workflow";
  const before = JSON.parse(run(["api", endpoint]));
  demand(["read", "write"].includes(before.default_workflow_permissions) && typeof before.can_approve_pull_request_reviews === "boolean", "Could not inspect workflow permissions");
  if (!before.can_approve_pull_request_reviews) run(["api", endpoint, "--method", "PUT", "--input", "-"], JSON.stringify({ default_workflow_permissions: before.default_workflow_permissions, can_approve_pull_request_reviews: true }));
  const after = JSON.parse(run(["api", endpoint]));
  demand(after.can_approve_pull_request_reviews === true && after.default_workflow_permissions === before.default_workflow_permissions, "GitHub did not confirm PR creation with the existing token defaults; ask the repository/organisation administrator");
}
export async function main(argv: string[], run: Gh = gh, setup: typeof startSetup = startSetup, local?: WorkerHost): Promise<number> {
  if (argv.includes("--help")) { process.stdout.write(HELP); return 0; }
  const options = argumentsFor(argv), root = fs.realpathSync(process.cwd());
  demand(fs.existsSync(path.join(root, ".platform-base.json")), "Run setup in an adopted app repository");
  const previous = readRecord(root);
  let selected = options.repo ?? previous?.repository;
  if (!selected) { try { selected = JSON.parse(run(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner; } catch { /* Offline checks are unknown. */ } }
  if (options.check) {
    const status = updateStatus(root, selected, run);
    process.stdout.write(options.json ? JSON.stringify(status, null, 2) + "\n" : summary(status)); return 0;
  }
  demand(typeof selected === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(selected), "Select your app with --repo owner/repo (works offline)");
  demand(!previous || previous.repository.toLowerCase() === selected.toLowerCase(), "Saved update repository differs; inspect the record before changing identity");
  // An interactive visit is the guided entry point; scripts keep explicit consent flags.
  if (process.stdin.isTTY && !options.mode && !options.workers && !options.replace && !options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      process.stdout.write("Scheduled updates open PRs for your review; auto-merge stays as configured. Choose app (recommended, repository-only App), fallback (limited built-in token), or deferred (configure later).\n");
      const mode = (await rl.question("Update delivery [" + (previous?.mode ?? "deferred") + "]: ")).trim() || previous?.mode || "deferred";
      demand(isDeliveryMode(mode), "Choose app, fallback or deferred"); options.mode = mode;
      let current = "unknown";
      try { const pools = workerVariables(selected, run); current = pools.verify || pools.deliver ? "existing local/custom routing" : "GitHub-hosted"; } catch { /* Preserve unreadable routing. */ }
      const answer = (await rl.question("Workers: hosted (GitHub computers), local (your Docker host), or preserve [preserve; current: " + current + "]: ")).trim() || "preserve";
      demand(["hosted", "local", "preserve"].includes(answer), "Choose hosted, local or preserve");
      if (answer !== "preserve") options.workers = answer as WorkerChoice;
      process.stdout.write("Consent covers the selected delivery settings and worker routing. Local setup installs two services and requests dedicated manager tokens; GitHub must pass their test before routing changes.\n");
      options.yes = (await rl.question("Apply this setup? [yes/no; no]: ")).trim() === "yes";
    } finally { rl.close(); }
  }
  const workerOnly = Boolean(options.workers && !options.mode && !options.replace);
  const observedMode = !previous && workerOnly ? updateStatus(root, selected, run).observed.mode : undefined;
  const mode = options.mode ?? (options.replace ? "app" : previous?.mode ?? (isDeliveryMode(observedMode) ? observedMode : "app"));
  demand(isDeliveryMode(mode), "Invalid delivery mode");
  if (workerOnly) {
    if (!previous) saveRecord(root, mode, selected, "pending", ["Inspect delivery credentials with --check; worker setup preserves their current settings."]);
    return await workers();
  }
  const added = installCaller(root), guarded = guardCaller(root);
  process.stdout.write(added ? "Added update caller; scheduled delivery waits for owner setup.\n" : "Preserved caller schedule, policy and auto-merge intent.\n");
  const pending = mode === "deferred" ? [] : ["Resume owner setup: bun run platform:setup-updates --repo " + selected + " --" + mode + " --yes"];
  if (!guarded) pending.push("Custom caller could not be safely guarded. Disable it in Actions while setup is pending, or add the delivery-mode guard documented in setup-updates.md.");
  saveRecord(root, mode, selected, mode === "deferred" ? "deferred" : "pending", pending);
  async function workers(): Promise<number> {
    if (!options.workers) return 0;
    const persist = (workers: WorkerRecord) => {
      const state = readRecord(root)!;
      saveRecord(root, state.mode, selected!, state.status, state.ownerActions, { workers });
    };
    if (!options.yes || mode === "deferred" && !workerOnly) {
      persist({ choice: options.workers, status: "pending", ownerActions: ["Resume bun run platform:setup-updates --workers " + options.workers + " --yes."] });
      process.stdout.write("Worker choice recorded; existing routing preserved.\n"); return 0;
    }
    try {
      await configureWorkers({ choice: options.workers, root, repo: selected!, runId: options.workerRun, ...(options.verifyHome && options.deliverHome ? { homes: { verify: options.verifyHome, deliver: options.deliverHome } } : {}) }, run, persist, local);
      process.stdout.write(summary(updateStatus(root, selected, run)));
      return readRecord(root)?.workers?.status === "configured" ? 0 : 2;
    } catch (error) {
      const action = error instanceof Error ? error.message : "Worker setup failed; inspect both installations before retrying.";
      const saved = readRecord(root)?.workers;
      persist({ ...saved, choice: options.workers, status: "pending", ownerActions: [action] });
      process.stderr.write(action + "\n"); return 2;
    }
  }
  if (!previous?.workers && !options.workers) {
    try {
      const current = workerVariables(selected, run);
      if (!current.verify && !current.deliver) saveRecord(root, mode, selected, mode === "deferred" ? "deferred" : "pending", pending, { workers: { choice: "hosted", status: "configured", ownerActions: [] } });
    } catch { /* Unreadable routing is preserved and reported unknown by --check. */ }
  }
  const workerResult = await workers();
  if (workerResult) return workerResult;
  const print = () => process.stdout.write(summary(updateStatus(root, selected, run)));
  if (!options.yes) {
    process.stdout.write(HELP + "\nNo remote settings changed. Existing live delivery is preserved; commit the local guard to pause an unconfigured caller.\n"); print(); return 0;
  }
  try {
    if (mode === "deferred") {
      run(["variable", "set", MODE_VARIABLE, "--repo", selected, "--body", "deferred"]);
      saveRecord(root, mode, selected, "deferred", pending); print(); return 0;
    }
    demand(guarded, "Review and guard your custom caller before enabling scheduled delivery");
    const repo = repository(JSON.parse(run(["api", "repos/" + selected]))), existing = configured(repo.full_name, run);
    if (mode === "fallback") {
      demand(!existing.id, "An App ID is already configured. Remove PLATFORM_UPDATER_APP_ID explicitly before switching to GITHUB_TOKEN; the key is preserved.");
      process.stdout.write("Owner consent: enable repository-wide GITHUB_TOKEN PR creation/approval capability. This updater creates PRs; it submits no approvals. Default token permissions and auto-merge intent are preserved.\n");
      enableFallback(repo.full_name, run);
      run(["variable", "set", MODE_VARIABLE, "--repo", selected, "--body", mode]);
      saveRecord(root, mode, selected, "configured", []); print(); return 0;
    }
    if ((existing.id || existing.key) && !options.replace) {
      demand(existing.id && existing.key, "Updater settings are incomplete. Repair the existing App manually or pass --replace to register a new App explicitly.");
      // Preserve an already enabled App. Newly recorded credentials need authenticated workflow validation first.
      const live = updateStatus(root, selected, run);
      saveRecord(root, mode, selected, live.observed.mode === "app" ? "configured" : "pending", ["Stored App-key validity is unknown. Dispatch Update platform to validate it, then set PLATFORM_UPDATE_DELIVERY=app only after successful token minting."], { app: { id: existing.id } });
      process.stdout.write("Existing App preserved; no replacement and no automatic activation from secret presence.\n"); print(); return 0;
    }
    demand(!previous?.app || options.replace, "A previously registered App is recorded. Finish its installation/credentials manually or use --replace deliberately; see the saved App URL.");
    process.stdout.write("Owner consent: register/install a private updater App on " + selected + " only, with Contents, Pull requests, Workflows and Issues write. GitHub asks you to authorise registration/installation. You still review and merge updates.\n");
    const session = await setup({ repo, run, onRegistered: app => {
      saveRecord(root, mode, selected!, "pending", ["App registered. Finish installation in the open setup session. If interrupted, inspect the existing App and finish credentials manually; do not register a duplicate."], { app: { id: String(app.id), url: "https://github.com/apps/" + app.slug } });
    } });
    process.stdout.write("Open updater setup: " + session.url + "\nLeave this terminal running through registration and installation.\n");
    if (options.open) {
      try { if (process.platform === "darwin") execFileSync("open", [session.url], { stdio: "ignore" }); else if (process.platform === "win32") execFileSync("cmd.exe", ["/c", "start", "", session.url], { stdio: "ignore" }); else execFileSync("xdg-open", [session.url], { stdio: "ignore" }); }
      catch { process.stdout.write("Automatic browser opening unavailable; use the URL above on this host (or an SSH tunnel).\n"); }
    }
    const cancel = () => session.close(); process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
    try {
      const result = await session.done;
      saveRecord(root, mode, selected, "pending", ["Credentials saved; finish activation with owner setup if interrupted."], { app: { id: String(result.id), url: "https://github.com/apps/" + result.slug }, validation: "authenticated-installation" });
      run(["variable", "set", MODE_VARIABLE, "--repo", selected, "--body", mode]);
      saveRecord(root, mode, selected, "configured", [], { app: { id: String(result.id), url: "https://github.com/apps/" + result.slug }, validation: "authenticated-installation" });
      print(); return 0;
    } finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
  } catch {
    const action = "Setup incomplete. Check gh auth status, repository/organisation policy and " + "https://github.com/" + selected + "/settings/actions. Repair partial App credentials rather than registering duplicates; see platform/docs/setup-updates.md. Resume the selected setup command with --yes when authorised.";
    let pause = "Existing live delivery could not be confirmed paused. Disable Update platform in Actions if it is still active while repairing setup.";
    if (guarded) {
      try { run(["variable", "set", MODE_VARIABLE, "--repo", selected, "--body", "deferred"]); pause = "Delivery-mode gate paused scheduling; commit the guarded caller if it is new."; }
      catch { /* Do not claim a remote pause when policy/access prevents it. */ }
    }
    saveRecord(root, mode, selected, "pending", [...pending, action, pause]);
    process.stderr.write(action + "\n"); print(); return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { process.stderr.write("setup-updates: " + (error instanceof Error ? error.message : "Setup failed") + "\n"); process.exitCode = 1; });
