import * as fs from "node:fs";
import * as path from "node:path";
import { demand } from "../platform-upgrade/metadata.ts";
import { configured, type Gh } from "./github.ts";

export const RECORD = ".github/update-delivery.json";
export const CALLER = ".github/workflows/update-platform.yml";
export const MODE_VARIABLE = "PLATFORM_UPDATE_DELIVERY";
export type DeliveryMode = "app" | "fallback" | "deferred";
export const GUARD = "${{ vars.PLATFORM_UPDATE_DELIVERY == 'app' || vars.PLATFORM_UPDATE_DELIVERY == 'fallback' || (github.event_name == 'workflow_dispatch' && vars.PLATFORM_UPDATER_APP_ID != '') }}";
export function isDeliveryMode(value: unknown): value is DeliveryMode { return value === "app" || value === "fallback" || value === "deferred"; }
export type RecordState = {
  schemaVersion: 1; mode: DeliveryMode; repository: string; source: string; caller: string;
  settings: string; status: "pending" | "configured" | "deferred"; lastCheck: string;
  ownerActions: string[]; app?: { id: string; url?: string }; validation?: "authenticated-installation";
};
export function safePath(root: string, relative: string): string {
  const parts = relative.split("/");
  for (let i = 1; i <= parts.length; i++) {
    try { demand(!fs.lstatSync(path.join(root, ...parts.slice(0, i))).isSymbolicLink(), "Update setup path must not traverse a symlink"); }
    catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
  }
  return path.join(root, relative);
}
export function readRecord(root: string): RecordState | undefined {
  const file = safePath(root, RECORD);
  if (!fs.existsSync(file)) return undefined;
  const state = JSON.parse(fs.readFileSync(file, "utf8")) as RecordState;
  demand(state.schemaVersion === 1 && isDeliveryMode(state.mode) && /^[\w.-]+\/[\w.-]+$/.test(state.repository), "Invalid update-delivery record; inspect it before setup");
  return state;
}
export function saveRecord(root: string, mode: DeliveryMode, repo: string, status: RecordState["status"], ownerActions: string[], extra: Partial<Pick<RecordState, "app" | "validation">> = {}): RecordState {
  const previous = readRecord(root);
  demand(!previous || previous.repository.toLowerCase() === repo.toLowerCase(), "Saved update repository differs; inspect the record before changing identity");
  const state: RecordState = { schemaVersion: 1, mode, repository: repo, source: previous?.source ?? "tkarakai/web-app-starter", caller: CALLER, settings: "https://github.com/" + repo + "/settings/actions", status, lastCheck: new Date().toISOString(), ownerActions, ...(previous?.mode === mode ? { app: previous.app, validation: previous.validation } : {}), ...extra };
  const file = safePath(root, RECORD); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n"); return state;
}
type CallerJob = { index: number; headerLength: number; body: string };
function callerJobs(text: string): CallerJob[] {
  const jobs: CallerJob[] = [];
  let current: CallerJob | undefined, offset = 0;
  for (const line of text.split("\n")) {
    if (/^ {2}[\w-]+:[ \t\r]*$/.test(line)) {
      current = { index: offset, headerLength: line.length + 1, body: "" }; jobs.push(current);
    } else if (current && (line.startsWith("    ") || !line.trim() || line.trimStart().startsWith("#"))) {
      current.body += line + "\n";
    } else current = undefined;
    offset += line.length + 1;
  }
  return jobs.filter(row => /^ {4}uses: ["']?\.\/\.github\/workflows\/platform-update\.yml["']?[ \t\r]*$/m.test(row.body));
}
function callerIsGuarded(text: string): boolean {
  const jobs = callerJobs(text);
  return jobs.length === 1 && jobs[0].body.split("\n").some(line => line.trimEnd() === "    if: " + GUARD);
}
/** Add only a delivery gate to a standard caller. Preserve every schedule, input and existing condition. */
export function guardCaller(root: string): boolean {
  const file = safePath(root, CALLER), text = fs.readFileSync(file, "utf8");
  if (callerIsGuarded(text)) return true;
  const candidates = callerJobs(text);
  if (candidates.length !== 1 || /^ {4}if:/m.test(candidates[0].body)) return false;
  const row = candidates[0], offset = row.index + row.headerLength;
  fs.writeFileSync(file, text.slice(0, offset) + "    if: " + GUARD + "\n" + text.slice(offset)); return true;
}
export type Status = {
  repository: string | null; intent: RecordState | null; observed: {
    mode: DeliveryMode | "unset" | "unknown"; appId: string | null; privateKeyPresent: boolean | null;
    appAuthentication: "unknown"; pullRequestCreation: boolean | null; defaultWorkflowPermissions: string | null;
    callerPresent: boolean; callerGuarded: boolean; scheduleUTC: string[]; policy: string | null; autoMerge: boolean | null;
  }; readiness: "ready" | "blocked" | "unknown" | "deferred"; ownerActions: string[]; checkedAt: string;
};
export function updateStatus(root: string, repo: string | undefined, run: Gh): Status {
  const intent = readRecord(root), selected = repo ?? intent?.repository;
  const file = safePath(root, CALLER), callerPresent = fs.existsSync(file), callerConfiguration = callerPresent ? fs.readFileSync(file, "utf8") : null;
  const result: Status = { repository: selected ?? null, intent: intent ?? null, observed: { mode: "unknown", appId: null, privateKeyPresent: null, appAuthentication: "unknown", pullRequestCreation: null, defaultWorkflowPermissions: null, callerPresent, callerGuarded: callerIsGuarded(callerConfiguration ?? ""), scheduleUTC: [...(callerConfiguration ?? "").matchAll(/cron:\s*["']([\d*/?, -]+)["']/g)].map(row => row[1]), policy: /policy:\s*(patch|minor|major)\s*$/m.exec(callerConfiguration ?? "")?.[1] ?? null, autoMerge: /auto-merge:\s*(true|false)\s*$/m.test(callerConfiguration ?? "") ? /auto-merge:\s*true\s*$/m.test(callerConfiguration ?? "") : null }, readiness: "unknown", ownerActions: [...(intent?.ownerActions ?? [])], checkedAt: new Date().toISOString() };
  if (!selected) { result.ownerActions.push("Select the app repository with --repo owner/repo."); return result; }
  demand(!intent || intent.repository.toLowerCase() === selected.toLowerCase(), "Saved update repository differs; inspect the record before changing identity");
  try {
    const config = configured(selected, run);
    result.observed.appId = config.id ?? null; result.observed.privateKeyPresent = config.key;
    const variables = JSON.parse(run(["variable", "list", "--repo", selected, "--json", "name,value"])) as { name: string; value: string }[];
    const mode = variables.find(row => row.name === MODE_VARIABLE)?.value;
    result.observed.mode = isDeliveryMode(mode) ? mode : "unset";
  } catch { result.ownerActions.push("Could not inspect Actions variables/secrets. Sign in with gh and rerun --check; credential state is unknown."); }
  try {
    const settings = JSON.parse(run(["api", "repos/" + selected + "/actions/permissions/workflow"]));
    if (typeof settings.can_approve_pull_request_reviews === "boolean") result.observed.pullRequestCreation = settings.can_approve_pull_request_reviews;
    if (["read", "write"].includes(settings.default_workflow_permissions)) result.observed.defaultWorkflowPermissions = settings.default_workflow_permissions;
  } catch { /* This endpoint requires administration access; routine tokens cannot inspect it. */ }
  const mode = intent?.mode ?? result.observed.mode;
  if (mode === "deferred") {
    result.readiness = "deferred";
    if (result.observed.mode === "unknown") { result.readiness = "unknown"; result.ownerActions.push("Deferred intent is saved locally; an owner must confirm the remote delivery gate is paused before relying on it."); }
    if (!result.observed.callerGuarded) result.readiness = "unknown";
    if (result.observed.mode === "app" || result.observed.mode === "fallback") result.readiness = "blocked";
    if (result.observed.mode === "app" || result.observed.mode === "fallback" || !result.observed.callerGuarded) result.ownerActions.push("Scheduled delivery may still be active. Run --defer --yes and commit the guarded caller, or disable the workflow in GitHub Actions.");
  } else if (mode === "app") {
    if (result.observed.privateKeyPresent === false || result.observed.appId === null && result.observed.privateKeyPresent !== null) {
      result.readiness = "blocked"; result.ownerActions.push("App credentials are missing or partial. Repair the existing App; --replace is required to register another.");
    } else result.ownerActions.push("App-key validity cannot be read from a stored secret. Run Actions → Update platform and inspect token minting; do not infer validity from secret presence or Git author metadata.");
  } else if (mode === "fallback") {
    if (result.observed.appId) { result.readiness = "blocked"; result.ownerActions.push("App ID still selects the App identity. Remove it explicitly before selecting fallback."); }
    else if (result.observed.pullRequestCreation === false) { result.readiness = "blocked"; result.ownerActions.push("An owner must run --fallback --yes to enable PR creation, or use " + "https://github.com/" + selected + "/settings/actions."); }
    else if (result.observed.pullRequestCreation === true && result.observed.privateKeyPresent !== null) result.readiness = "ready";
    else result.ownerActions.push("PR-creation permission is unknown. An administrator must re-check Actions settings.");
  } else result.ownerActions.push("Choose --app, --fallback or --defer; absent App credentials do not mean fallback was configured.");
  if (mode !== "deferred") {
    if (!callerPresent) { result.readiness = "blocked"; result.ownerActions.push("Install the caller with platform:setup-updates and commit it."); }
    if (result.observed.callerGuarded && result.observed.mode !== mode) { if (result.readiness !== "blocked") result.readiness = result.observed.mode === "unknown" ? "unknown" : "blocked"; result.ownerActions.push("Caller is paused, unknown, or live mode differs from intent. Complete owner setup with --yes and commit the caller."); }
  }
  return result;
}
export function summary(status: Status): string {
  const schedule = status.observed.scheduleUTC.join(", ") || "none / inspect caller";
  return ["Update delivery: " + (status.intent?.mode ?? "not chosen") + "; readiness: " + status.readiness,
    "Recorded setup: " + (status.intent?.status ?? "none") + "; last setup attempt: " + (status.intent?.lastCheck ?? "none") + "; recorded validation: " + (status.intent?.validation ?? "none") + "; live mode: " + status.observed.mode,
    "Repository scope: " + (status.repository ?? "unknown") + "; API identity: " + (status.observed.appId ? "App ID " + status.observed.appId : status.observed.mode === "fallback" ? "github-actions[bot]" : "unknown / inactive"),
    "Schedule (UTC): " + schedule + "; policy: " + (status.observed.policy ?? "inspect caller") + "; auto-merge: " + (status.observed.autoMerge ?? "inspect caller"),
    ...status.ownerActions.map(action => "Owner action: " + action),
    "Intent: " + RECORD + "; schedule/policy/auto-merge authority: " + CALLER,
    "Re-check: bun run platform:setup-updates --check --json; change: --app / --fallback / --defer (remote changes require --yes). Review and commit local setup files."].join("\n") + "\n";
}
