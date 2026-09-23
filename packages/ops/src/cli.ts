#!/usr/bin/env bun
import { setTimeout as sleep } from "node:timers/promises";
import { account, authStatus, githubApi, login, projects, requireInteractive, resolveTeam, teams, vercelApi, type Provider } from "./auth";
import { offerSetup, setup } from "./setup";
import { command, loadConfig } from "./config";
import { errorInfo, OpsError, redact, registerSecret } from "./errors";
import { parseOptions, type Options } from "./options";
import { envelope, render, safeCell } from "./output";
import { OpsService } from "./service";
import type { Result } from "./types";

const HELP = `ops — deployment visibility and workflow control

  ops [status] [--env staging|production] [--app web] [--watch]
  ops history [--env staging|production] [--since ISO_DATE]
  ops builds [--app web]
  ops candidates [--to production]
  ops inspect SHA [--to production]
  ops diff production SHA             Compare each live app with a commit
  ops diff SHA SHA                    Compare two commits
  ops runs [--active] [--watch]         Workflows, active jobs and steps
  ops watch RUN_ID                    Follow jobs until the run completes
  ops logs RUN_ID                     Fetch completed failed-job logs
  ops deploy SHA --to staging|production [--dry-run | --yes] [--watch]
  ops rollback SHA --to staging|production [--dry-run | --yes] [--watch]
  ops setup                          Guided login, team and project configuration
  ops auth status                    Check both accounts and credential sources
  ops auth login github|vercel        Sign in with the official provider CLI
  ops teams                          List Vercel team names, slugs and IDs
  ops projects [--team ID_OR_SLUG]    Discover Vercel project IDs
  ops doctor                         Check credentials, access and configuration

Options:
  --json           Versioned JSON envelope; watch emits one envelope per line
  --debug          Request timings and stack traces to stderr (credentials redacted)
  --config PATH    Configuration file (default: ./ops.config.json)
  --repo OWNER/REPO Override repository; otherwise config or gh repo view
  --limit N        Bounded history window, 1–1000 (default 30)
  --interval N     Watch polling seconds, 1–60 (default 10)
  --timeout N      Watch timeout seconds, 1–86400 (default 1800)
  --ref BRANCH     Workflow code branch for dispatch (default config.workflowRef)
  --yes            Explicitly authorize dispatch; never inferred from --json

Auth: gh auth login and vercel login sessions; no credentials in ops config.
      GH_TOKEN / GITHUB_TOKEN and VERCEL_TOKEN override sessions for CI.
Exit: 0 success; 1 provider/unexpected error; 2 usage/config/gate failure;
      3 partial results; 4 workflow failed; 5 watch timed out; 130 interrupted.
Read commands do not mutate deployments. Writes are never automatically retried.
`;
const controller = new globalThis.AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
function interrupted() {
  if (controller.signal.aborted) throw new OpsError("INTERRUPTED", "Watch interrupted; any dispatched workflow continues on GitHub.", "Use ops runs or ops watch RUN_ID to reconnect.", 130);
}
async function pause(o: Options, deadline: number) {
  interrupted();
  if (Date.now() >= deadline) throw new OpsError("WATCH_TIMEOUT", "Watch timed out; the workflow may still be running.", "Use ops runs or ops watch RUN_ID to reconnect. Do not redispatch just to resume watching.", 5);
  try { await sleep(Math.min(o.interval * 1000, deadline - Date.now()), undefined, { signal: controller.signal }); }
  catch (cause) { interrupted(); throw cause; }
}
async function watch(service: OpsService, id: number, o: Options, deadline: number): Promise<void> {
  for (;;) {
    interrupted();
    const data = await service.runDetails(id);
    render("watch", data, o.json, service.errors, service.warnings);
    if (data.status === "completed") {
      if (data.conclusion !== "success") throw new OpsError("WORKFLOW_FAILED", `Workflow ${id} completed with ${data.conclusion}.`, `Run ops logs ${id} or open ${data.url}.`, 4, { runId: id, conclusion: data.conclusion, url: data.url });
      return;
    }
    await pause(o, deadline);
  }
}
async function execute(service: OpsService, o: Options): Promise<Result> {
  switch (o.command) {
    case "status": return service.status(o);
    case "history": return service.history(o);
    case "builds": return service.builds(o);
    case "candidates": return service.candidates(o);
    case "inspect": return service.inspect(o.args[0], o);
    case "diff": return service.diff(o.args[0], o.args[1], o);
    case "runs": return service.runs(o);
    case "projects": return service.projects();
    case "deploy": case "rollback": return service.dispatch(o.args[0], o);
    case "logs": {
      const run = await service.run(Number(o.args[0]));
      if (run.status !== "completed") throw new OpsError("LOGS_NOT_READY", "GitHub downloadable job logs are not complete while the run is active.", `Use ops watch ${run.id} for live step status, or open ${run.html_url}.`, 2);
      const logs = await command("gh", ["run", "view", String(run.id), "--repo", service.config.repository, "--log-failed"]);
      return { run: run.id, url: run.html_url, logs: redact(logs), note: logs ? "Completed failed-job logs." : "No failed-job logs were returned." };
    }
    case "doctor": {
      const checks = await Promise.allSettled([
        service.gh.get<{ full_name: string }>(service.root),
        service.projects(),
      ]);
      const rows = checks.map((r, i) => {
        if (r.status === "rejected") service.errors.push(r.reason);
        return { provider: i ? "vercel" : "github", result: r.status === "fulfilled" ? "accessible" : "failed" };
      });
      const missing = Object.entries(service.config.apps).flatMap(([app, c]) => ["staging", "production"].filter(env => c.projects[env as "staging" | "production"] === undefined).map(env => `${app}/${env}`));
      const skipped = Object.entries(service.config.apps).flatMap(([app, c]) => ["staging", "production"].filter(env => c.projects[env as "staging" | "production"] === null).map(env => `${app}/${env}`));
      if (missing.length) service.errors.push(service.projectConfigurationError(missing));
      return { rows, repository: service.config.repository, workflowRef: service.config.workflowRef, missingProjectMappings: missing, skippedProjectMappings: skipped };
    }
    default: throw new Error(`Unhandled command ${o.command}`);
  }
}
export async function main(argv: string[]) {
  const json = argv.includes("--json");
  let name = "unknown";
  try {
    for (const token of [process.env.GH_TOKEN, process.env.GITHUB_TOKEN, process.env.VERCEL_TOKEN]) if (token) registerSecret(token);
    const o = parseOptions(argv); name = o.command;
    if (o.command === "help") { if (o.json) render("help", { usage: HELP }, true); else console.log(HELP); return; }
    const log = (message: string) => console.error(`${o.debug ? "[debug]" : "[retry]"} ${safeCell(message)}`);
    const requestLog = (message: string) => { if (o.debug || message.includes("retry ")) log(message); };
    if (!await offerSetup(o, requestLog)) return;
    if (o.command === "setup") { render("setup", await setup(o, requestLog), o.json); return; }
    if (o.command === "auth") {
      if (o.args[0] === "login") {
        requireInteractive(o.json);
        const provider = o.args[1] as Provider;
        await login(provider);
        render("auth", { rows: [await account(provider, requestLog)] }, o.json);
      } else {
        const result = await authStatus(requestLog);
        render("auth", result.data, o.json, result.errors);
        if (result.errors.length) process.exitCode = 3;
      }
      return;
    }
    if (o.command === "teams") { render("teams", { rows: await teams(vercelApi(requestLog)) }, o.json); return; }
    if (o.command === "projects") {
      const api = vercelApi(requestLog);
      // Discovery must work before GitHub/repository setup. A repo override only
      // supplies a harmless fallback for loadConfig; no GitHub API is needed.
      const teamId = o.team ? await resolveTeam(api, o.team) : (await loadConfig(o.config, o.repo ?? "discovery/projects")).teamId;
      render("projects", { rows: await projects(api, teamId), scope: teamId ?? "unscoped environment token; use --team ID_OR_SLUG for a team" }, o.json);
      return;
    }
    const config = await loadConfig(o.config, o.repo);
    if (o.app && !config.apps[o.app]) throw new OpsError("USAGE", `Unknown app ${o.app}.`, `Configured apps: ${Object.keys(config.apps).join(", ")}.`, 2);
    const service = new OpsService(config, githubApi(requestLog), vercelApi(requestLog), o.config);
    const deadline = Date.now() + o.timeout * 1000;
    if (o.command === "watch") { await watch(service, Number(o.args[0]), o, deadline); return; }
    for (;;) {
      interrupted();
      service.errors = []; service.warnings = [];
      const data = await execute(service, o);
      render(o.command, data, o.json, service.errors, service.warnings);
      if (service.errors.length) { process.exitCode = 3; return; }
      if (["deploy", "rollback"].includes(o.command)) {
        if (o.watch && data.dispatched) {
          for (;;) {
            const run = await service.findDispatchedRun(String(data.workflow), String(data.requestId));
            if (run) { await watch(service, run.id, o, deadline); return; }
            await pause(o, deadline);
          }
        }
        return;
      }
      if (!o.watch) return;
      await pause(o, deadline);
    }
  } catch (error) {
    const e = errorInfo(error);
    if (json) console.log(redact(JSON.stringify(envelope(name, null, [error]))));
    console.error(`Error [${e.code}]: ${safeCell(e.message)}\n${safeCell(e.hint)}`);
    if (argv.includes("--debug") && error instanceof Error) console.error((error.stack ?? String(error)).split("\n").map(safeCell).join("\n"));
    process.exitCode = error instanceof OpsError ? error.exitCode : 1;
  }
}
if (import.meta.main) await main(process.argv.slice(2));
