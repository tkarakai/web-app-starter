import { errorInfo, OpsError } from "./errors";
import { fullSha } from "./evidence";
import { deploymentProgress } from "./deployment-progress";
import type { Options } from "./options";
import type { Query, Report } from "./operations";
import type { Select } from "./prompts";
import type { Operation } from "./session";
import type { Environment, Result } from "./types";

export interface ConsoleUI {
  select: Select;
  ask(question: string): Promise<string>;
  tell(message: string): void;
  show(report: Report): void;
  load?<T>(command: string, work: () => Promise<T>): Promise<T>;
}
export interface ConsoleDependencies {
  ui: ConsoleUI; query: Query;
  load(): Promise<Operation | undefined>; save(operation: Operation): Promise<void>;
  setup(): Promise<void>; export(report: Report): Promise<void>;
}
class Home extends Error {}
type Choice = { label: string; action: () => Promise<void> };
const rows = (data: Result | null, key = "rows"): Record<string, unknown>[] => Array.isArray(data?.[key]) ? data[key] as Record<string, unknown>[] : [];
const short = (value: unknown) => typeof value === "string" ? value.slice(0, 8) : "unknown";
const empty = (): Report => ({ data: null, errors: [], warnings: [], coverage: [], observedAt: "" });
function candidateLabel(row: Record<string, unknown>): string {
  const ci: Record<string, string> = { success: "CI passed", pending: "CI pending", failure: "CI failed", error: "CI error", unknown: "CI not reported", unavailable: "CI unavailable" };
  const state = row.branch ? ci[String(row.ci)] ?? "CI unknown" : row.eligibility === "workflow-gates-pass" ? "Production gates pass" : row.eligibility === "blocked" ? "Gates not passed" : row.taggedAt ? "Previously deployed" : "Review checks";
  return `${short(row.sha)} · ${row.artifactSummary ? `${row.artifactSummary} · ` : ""}${state} · ${row.change ?? row.taggedAt ?? "release"}`;
}
const latestFailures = (data: Result | null) => rows(data, "recentOperations")
  .filter((r, i, all) => all.findIndex(other => other.environment === r.environment) === i)
  .filter(r => r.conclusion && r.conclusion !== "success");
export function summary(report: Report): string[] {
  const data = report.data;
  const lines = [report.observedAt ? `Checked ${report.observedAt}` : "You can choose a task while this loads."];
  if (data?.repository) lines.push(`Repository: ${data.repository}`);
  if (data?.outcome) lines.push(`Verification: ${data.outcome}`);
  if (data?.status) lines.push(`Workflow: ${data.status}${data.conclusion ? ` · ${data.conclusion}` : ""} · attempt ${data.attempt ?? "unknown"}`);
  const displayRows = [...rows(data)];
  if (displayRows.some(row => row.job)) displayRows.sort((a, b) => {
    const priority = (row: Record<string, unknown>) => row.status === "in_progress" ? 0 : row.conclusion && !["success", "skipped"].includes(String(row.conclusion)) ? 1 : 2;
    return priority(a) - priority(b);
  });
  for (const row of displayRows.slice(0, 6)) lines.push([
    row.environment, row.app ?? row.job, row.state ?? row.result ?? row.status,
    row.deployedSha ? short(row.deployedSha) : row.step,
    row.latestAttempt && !["success", "unchanged", "unknown"].includes(String(row.latestAttempt)) ? `latest attempt ${row.latestAttempt}` : undefined,
  ].filter(Boolean).join(" · "));
  for (const op of latestFailures(data).slice(0, 2)) lines.push(`Latest ${op.environment} deployment: ${op.conclusion === "failure" ? "failed" : op.conclusion}. Investigate it to see what happened.`);
  for (const op of rows(data, "activity").slice(0, 2)) lines.push(`Active: ${op.environment} run ${op.run} · ${op.status}`);
  if (rows(data, "skipped").length) lines.push(`${rows(data, "skipped").length} targets intentionally not tracked.`);
  if (report.errors.length) lines.push(`Evidence incomplete: ${report.errors[0].message}`);
  return lines;
}

/** Navigation owns no provider or dispatch logic. All reads/writes use the same query interface as CLI commands. */
export class OperationsConsole {
  private saved?: Operation;
  private environment: Environment = "production";
  private homeReport = empty();
  constructor(private base: Options, private deps: ConsoleDependencies) {}
  private get ui() { return this.deps.ui; }
  private read(command: string, options: Partial<Options> = {}, background = false): Promise<Report> {
    const work = () => this.query(command, options);
    return !background && this.ui.load ? this.ui.load(command, work) : work();
  }
  private async query(command: string, options: Partial<Options>): Promise<Report> {
    try {
      if (this.base.signal?.aborted) throw new OpsError("INTERRUPTED", "Console closed.", "Remote work continues.", 130);
      const pending = this.deps.query({ ...this.base, command, args: [], watch: false, yes: false, dryRun: false, env: undefined, to: undefined, ...options });
      if (!this.base.signal) return await pending;
      const signal = this.base.signal;
      return await new Promise<Report>((resolve, reject) => {
        const cancel = () => reject(new OpsError("INTERRUPTED", "Console closed.", "Remote work continues; resume the saved request.", 130));
        signal.addEventListener("abort", cancel, { once: true });
        pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
        if (signal.aborted) cancel();
      });
    }
    catch (error) { if (this.base.signal?.aborted) throw error; return { ...empty(), observedAt: new Date().toISOString(), errors: [errorInfo(error)] }; }
  }
  private async menu(title: string, choices: Choice[], detail: string[] = []): Promise<boolean> {
    const index = await this.ui.select(title, [...choices.map(c => c.label), "Back", "Home"], 0, { back: true, summary: () => detail });
    if (index < 0 || index === choices.length) return false;
    if (index === choices.length + 1) throw new Home();
    try { await choices[index].action(); }
    catch (error) {
      if (error instanceof Home || (error instanceof OpsError && error.code === "INTERRUPTED")) throw error;
      const info = errorInfo(error); this.ui.tell(`${info.message}\n${info.hint}`);
    }
    return true;
  }
  private async chooseEnvironment(): Promise<Environment | undefined> {
    const index = await this.ui.select("Choose environment", ["Production", "Staging", "Back"], this.environment === "production" ? 0 : 1, { back: true });
    if (index < 0 || index === 2) return;
    return this.environment = index === 0 ? "production" : "staging";
  }
  private equivalent(command: string): string {
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    return command + (this.base.config ? ` --config ${quote(this.base.config)}` : "") + (this.base.repo ? ` --repo ${quote(this.base.repo)}` : "");
  }
  private async details(report: Report, equivalent: string) {
    this.ui.show(report);
    while (await this.menu("Evidence details", [
      { label: "Show equivalent command", action: async () => this.ui.tell(this.equivalent(equivalent)) },
      { label: "Export this observation", action: async () => this.deps.export(report) },
    ], ["Scroll up for the report. Its timestamps describe when this evidence was observed."])) { /* retain the observation */ }
  }
  private async report(title: string, command: string, options: Partial<Options>, equivalent: string) {
    let report = await this.read(command, options);
    while (await this.menu(title, [
      { label: "View full evidence and links", action: () => this.details(report, equivalent) },
      { label: "Refresh this read", action: async () => { report = await this.read(command, options); } },
      { label: "Check access or repair setup", action: () => this.access() },
    ], summary(report))) { /* retain selections */ }
  }
  async run() {
    try { this.saved = await this.deps.load(); } catch (error) { this.ui.tell(errorInfo(error).hint); }
    for (;;) {
      let active = true;
      // Read-only observations cannot hold the home menu hostage. Keep the menu order fixed.
      void this.read("status", {}, true).then(report => { if (active) this.homeReport = report; }).catch(() => {});
      const failure = () => latestFailures(this.homeReport.data)[0];
      const choices: Choice[] = [
        ...(this.saved ? [{ label: `Watch ${this.saved.environment} ${this.saved.operation}${this.saved.runId ? ` #${this.saved.runId}` : " request"}`, action: () => this.follow(this.saved!) }] : []),
        { label: "Monitor environments", action: () => this.monitor() },
        { label: "Investigate a deployment problem", action: () => {
          const op = failure(); return op ? this.operation(Number(op.run), typeof op.attempt === "number" ? op.attempt : undefined) : this.investigate();
        } },
        { label: "Deploy to production", action: () => this.release("deploy", "production") },
        { label: "Deploy to staging", action: () => this.release("deploy", "staging") },
        { label: "Roll back an environment", action: async () => { const env = await this.chooseEnvironment(); if (env) await this.release("rollback", env); } },
        { label: "Explore deployment history", action: () => this.audit() },
        { label: "Setup and access", action: () => this.access() },
      ];
      try {
        let index: number, highlighted = 0;
        for (;;) {
          index = await this.ui.select("Operations · What would you like to do?", [...choices.map(c => c.label), "Quit"], highlighted,
            { back: true, title: "Environment overview", pending: () => !this.homeReport.observedAt,
              onHighlight: index => { highlighted = index; },
              summary: () => summary(this.homeReport), labels: () => [...choices.map(c => c.label === "Investigate a deployment problem" && failure()
                ? `Investigate latest ${failure()!.environment} deployment (${failure()!.conclusion === "failure" ? "failed" : failure()!.conclusion})` : c.label), "Quit"] });
          if (index >= 0) break;
          const exit = await this.ui.select("Exit operations console?", ["Keep using ops", "Exit ops"], 0,
            { back: true, summary: () => ["Escape or ‘Keep using ops’ returns to your previous selection.", "Any remote deployment continues if you exit."] });
          if (exit === 1) return;
        }
        active = false;
        if (index === choices.length) return;
        await choices[index].action();
      } catch (error) {
        if (error instanceof Home) continue;
        if (error instanceof OpsError && error.code === "INTERRUPTED") throw error;
        const info = errorInfo(error); this.ui.tell(`${info.message}\n${info.hint}`);
      } finally { active = false; }
    }
  }
  private async monitor() {
    const index = await this.ui.select("Monitor › Scope", ["All environments", "Production", "Staging", "Back"], 0, { back: true });
    if (index < 0 || index === 3) return;
    const env = index === 1 ? "production" : index === 2 ? "staging" : undefined;
    let report = await this.read("status", { env });
    while (await this.menu(`Monitor › ${env ?? "All environments"}`, [
      ...latestFailures(report.data).map(op => ({ label: `Investigate latest ${op.environment} deployment (${op.conclusion})`, action: () => this.operation(Number(op.run), typeof op.attempt === "number" ? op.attempt : undefined) })),
      ...rows(report.data).map(row => ({ label: `${row.environment} / ${row.app} · ${row.state}`, action: () => this.report(`Monitor › ${row.app}`, "status", { env: String(row.environment), app: String(row.app) }, `bun run ops status --env ${row.environment} --app ${row.app}`) })),
      { label: "Watch live updates", action: () => this.live("status", { env }) },
      { label: "Inspect active and recent operations", action: () => this.investigate(env) },
      { label: "View full evidence and links", action: () => this.details(report, `bun run ops status${env ? ` --env ${env}` : ""}`) },
      { label: "Refresh", action: async () => { report = await this.read("status", { env }); } },
      { label: "Check access or repair setup", action: () => this.access() },
    ], summary(report))) { /* scope retained */ }
  }
  private async live(command: string, options: Partial<Options>) {
    let report = empty(), active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const next = await this.read(command, options, true);
      if (!active) return;
      report = next;
      timer = setTimeout(() => { void poll().catch(() => {}); }, this.base.interval * 1000);
    };
    void poll().catch(() => {});
    try {
      await this.ui.select("Live observations · Remote work continues when you leave", ["Back to exploration"], 0,
        { back: true, title: "Environment monitoring", pending: () => !report.observedAt, summary: () => summary(report) });
    } finally { active = false; if (timer) clearTimeout(timer); }
  }
  private async investigate(env?: string) {
    let report = await this.read("history", { env });
    for (;;) {
      const operations = rows(report.data, "workflows");
      const choices: Choice[] = operations.map(row => ({ label: `#${row.run} · ${row.workflow} · ${row.conclusion ?? row.status}`, action: () => this.operation(Number(row.run)) }));
      choices.push({ label: "Enter a run ID", action: async () => {
        const value = (await this.ui.ask("Run ID (blank goes back): ")).trim();
        if (!value) return;
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) { this.ui.tell("Enter a numeric run ID."); return; }
        await this.operation(Number(value));
      } }, { label: "Refresh", action: async () => { report = await this.read("history", { env }); } },
      { label: "View evidence or provider errors", action: () => this.details(report, "bun run ops history") });
      if (!await this.menu("Investigate › Choose operation", choices, ["Failed, active and successful operations can all be investigated.", ...report.errors.map(e => e.message)])) return;
    }
  }
  private async operation(id: number, attempt?: number) {
    let report = await this.read("diagnose", { args: [String(id)], attempt });
    const pinned = attempt ?? (typeof report.data?.attempt === "number" ? report.data.attempt : undefined);
    while (await this.menu(`Investigate › Run #${id}${pinned ? ` / attempt ${pinned}` : ""}`, [
      { label: "Examine jobs, effects and next steps", action: () => this.details(report, `bun run ops diagnose ${id}${pinned ? ` --attempt ${pinned}` : ""}`) },
      { label: "Read failed-job logs", action: () => this.report("Failed-job logs", "logs", { args: [String(id)], attempt: pinned }, `bun run ops logs ${id}${pinned ? ` --attempt ${pinned}` : ""}`) },
      { label: "Follow workflow and verify serving", action: () => this.followRun(id, pinned) },
      { label: "Check what is serving now", action: () => this.monitor() },
      { label: "Explore rollback candidates", action: async () => { const env = await this.chooseEnvironment(); if (env) await this.release("rollback", env); } },
      { label: "Refresh diagnosis", action: async () => { report = await this.read("diagnose", { args: [String(id)], attempt: pinned }); } },
    ], [...summary(report), ...rows(report.data, "effects").map(r => `${r.app}: ${r.result}`), ...(Array.isArray(report.data?.next) ? report.data.next.map(String) : [])])) { /* exact attempt retained */ }
  }
  private async audit() {
    const env = await this.chooseEnvironment(); if (!env) return;
    let since: string | undefined, app: string | undefined, limit = this.base.limit;
    let report = await this.read("history", { env, limit });
    while (await this.menu(`History › ${env}${app ? ` / ${app}` : ""}`, [
      { label: "View timeline and evidence", action: () => this.details(report, `bun run ops history --env ${env} --limit ${limit}${since ? ` --since ${since}` : ""}${app ? ` --app ${app}` : ""}`) },
      ...rows(report.data, "workflows").map(row => ({ label: `Inspect run #${row.run} · ${row.conclusion ?? row.status}`, action: () => this.operation(Number(row.run)) })),
      { label: "Change time/app filters", action: async () => {
        const time = (await this.ui.ask("Since ISO date/time (blank for recent history): ")).trim();
        if (time && !Number.isFinite(Date.parse(time))) { this.ui.tell("Enter a valid ISO date or timestamp."); return; }
        const choice = await this.ui.select("History › App", ["All apps", "web", "admin", "landing", "backend", "Back"], 0, { back: true });
        if (choice < 0 || choice === 5) return;
        since = time || undefined; app = [undefined, "web", "admin", "landing", "backend"][choice];
        report = await this.read("history", { env, app, since, limit });
      } },
      { label: "Export this observation", action: () => this.deps.export(report) },
      ...(limit < 1000 ? [{ label: "Look further back", action: async () => { limit = Math.min(1000, limit * 2); report = await this.read("history", { env, app, since, limit }); } }] : []),
      { label: "Refresh", action: async () => { report = await this.read("history", { env, app, since, limit }); } },
    ], [`${rows(report.data).length} app outcomes; ${rows(report.data, "deploymentTags").length} verified deployment tags.`,
      `Showing recent history, up to ${limit} records per source.${limit === 1000 ? " Maximum history size reached." : " Choose ‘Look further back’ for older records."}`, ...report.errors.map(e => e.message)])) { /* filters retained */ }
  }
  private async release(kind: "deploy" | "rollback", env: Environment) {
    let allCommits = false;
    const load = () => this.read(kind === "rollback" ? "history" : "candidates", { env: kind === "rollback" ? env : undefined, to: kind === "deploy" ? env : undefined, allCommits });
    let report = await load();
    for (;;) {
      const candidates = kind === "rollback" ? rows(report.data, "deploymentTags") : rows(report.data);
      const seen = new Set<string>();
      const choices: Choice[] = candidates.filter(row => {
        if (!fullSha(row.sha) || seen.has(row.sha)) return false;
        seen.add(row.sha); return true;
      }).map(row => ({
        label: candidateLabel(row),
        action: () => this.preview(kind, env, String(row.sha), row),
      }));
      choices.push({ label: "Enter an explicit commit SHA", action: async () => {
        const sha = (await this.ui.ask("Commit SHA (blank goes back): ")).trim();
        if (!sha) return;
        if (!/^[a-f0-9]{7,40}$/i.test(sha)) { this.ui.tell("Enter a commit SHA, not a branch name."); return; }
        await this.preview(kind, env, sha);
      } }, { label: "View candidate evidence", action: () => this.details(report, kind === "rollback" ? `bun run ops history --env ${env}` : `bun run ops candidates --to ${env}${allCommits ? " --all-commits" : ""}`) },
      ...(kind === "deploy" && env === "staging" ? [{ label: allCommits ? "Show only artifact-producing commits" : "Show all recent commits", action: async () => { allCommits = !allCommits; report = await load(); } }] : []),
      { label: "Refresh candidates", action: async () => { report = await load(); } });
      if (!await this.menu(`${kind === "rollback" ? "Rollback" : "Deploy"} › ${env} › Choose a commit`, choices,
        [kind === "rollback" ? "Prior deployment evidence is not a guarantee of data compatibility. Rollback runs backend migrations; it does not restore data."
          : report.data?.sourceBranch ? `Recent commits on ${report.data.sourceBranch}${allCommits ? " (including reuse-only and unknown builds)" : " that produced available app packages"}, newest first. CI shows the last reported overall gate.` : "Commits with a successful staging deployment. Review production checks before deploying.",
          ...(report.data?.hiddenWithoutProducedArtifacts ? [`${report.data.hiddenWithoutProducedArtifacts} commit${report.data.hiddenWithoutProducedArtifacts === 1 ? "" : "s"} hidden: no confirmed available artifacts produced by these commits. Choose “Show all recent commits” to explore them.`] : []),
          ...(!candidates.length && kind === "deploy" && env === "staging" ? ["No commits that produced available app packages in this window. Explore other commits or enter a SHA to review a new build."] : []),
          ...(kind === "deploy" ? ["Artifact labels show which apps produced available packages."] : []),
          "Select a commit to review. Deployment requires a separate confirmation.", ...report.errors.map(e => e.message)])) return;
    }
  }
  private async preview(kind: "deploy" | "rollback", env: Environment, sha: string, candidate?: Record<string, unknown>) {
    let report = await this.read("inspect", { args: [sha], to: env });
    // Resolve a short selection once; subsequent review and dispatch stay pinned to this full SHA.
    const selected = typeof report.data?.sha === "string" ? report.data.sha : sha;
    while (await this.menu(`${kind} › ${env} › ${selected}`, [
      { label: "Review changes, scope and evidence", action: () => this.details(report, `bun run ops inspect ${selected} --to ${env}`) },
      ...(Array.isArray(candidate?.appEvidence) ? [{ label: "View recorded per-app build results", action: () => this.details({ ...report, command: "build-results", data: {
        sha: selected, run: candidate.evidenceRun, attempt: candidate.evidenceAttempt, rows: candidate.appEvidence as Record<string, unknown>[],
        note: "Staging build records and available artifacts from staging push runs, checked when candidates were loaded. The deployment workflow recomputes input hashes for current target configuration.",
      } }, `bun run ops candidates --to ${env}${env === "staging" ? " --all-commits" : ""}`) }] : []),
      { label: "Compare with current environment", action: () => this.report("Release changes", "diff", { args: [env, selected] }, `bun run ops diff ${env} ${selected}`) },
      { label: "Review staging history", action: () => this.report("Staging evidence", "history", { env: "staging" }, "bun run ops history --env staging") },
      { label: "Continue to confirmation", action: () => this.confirm(kind, env, selected) },
      { label: "Refresh preview", action: async () => { report = await this.read("inspect", { args: [selected], to: env }); } },
    ], [`Selected commit: ${selected}`, `CI: ${report.data?.ci ?? "unknown"}; staging tag: ${report.data?.stagingTag ?? "unknown"}`,
      "Artifact plan from recorded target inputs; current configuration is checked during deployment:",
      ...rows(report.data).map(row => `${row.app}: ${{ "reuse-recorded-artifact": "existing artifact found", "build-required": "recorded artifact missing or expired; build expected", "resolve-at-deploy": "reuse or build determined during deployment", "deploy-source-and-migrations": "deploy source and migrations (no frontend artifact)" }[String(row.action)] ?? row.action}`),
      "Scope: web, admin, landing, backend and migrations; monitoring skips do not change deployment scope.",
      "Completion: successful workflow + intended deployments serving configured domains.", ...report.errors.map(e => e.message)])) { /* back returns to candidates */ }
  }
  private async confirm(kind: "deploy" | "rollback", env: Environment, sha: string) {
    const preview = await this.read(kind, { args: [sha], to: env, dryRun: true });
    if (preview.errors.length || !fullSha(preview.data?.sha)) { await this.details(preview, `bun run ops ${kind} ${sha} --to ${env} --dry-run`); return; }
    const action = await this.ui.select(`Confirm ${kind} › ${env} › ${preview.data.sha}`, ["Back to review", `Confirm ${kind} to ${env}`], 0, { back: true, summary: () => [
      `Repository: ${preview.data!.repository}`, `Commit: ${preview.data!.sha}`, `Environment: ${env.toUpperCase()}`,
      `Workflow code: ${preview.data!.workflowRef}`, "Scope: web, admin, landing, backend and migrations.",
      kind === "rollback" ? "Rollback redeploys code and runs migrations; it does not restore database contents." : "Gates were just rechecked and will be checked again before dispatch.",
      "Remote work continues if you close this console. Completion requires workflow success and intended serving state.",
    ] });
    if (action !== 1) return;
    if (env === "production" || kind === "rollback") {
      if ((await this.ui.ask(`Type ${env} to authorize this ${kind} (blank cancels): `)).trim() !== env) { this.ui.tell("No deployment requested."); return; }
    }
    const data = preview.data;
    const pending: Operation = { repository: String(data.repository), environment: env, sha: String(data.sha), workflow: String(data.workflow),
      workflowRef: String(data.workflowRef), requestId: String(data.requestId), startedAt: new Date().toISOString(), operation: kind, accepted: false };
    // Persist identity BEFORE the write so a disconnected/uncertain response can be resumed safely.
    await this.deps.save(pending); this.saved = pending;
    const result = await this.read(kind, { args: [pending.sha], to: env, yes: true, ref: pending.workflowRef, request: pending.requestId, expectedRepository: pending.repository });
    if (result.data?.dispatched) {
      this.saved = { ...pending, accepted: true };
      try { await this.deps.save(this.saved); } catch { this.ui.tell(`Could not update session. Resume using request ${pending.requestId}.`); }
    }
    if (result.errors.length) this.ui.show(result);
    else this.ui.tell(`Request accepted for ${env} ${kind} ${pending.sha.slice(0, 8)}. Watching automatically through workflow completion and serving verification.`);
    if (result.errors.length) this.ui.tell(`Do not repeat the dispatch if acceptance is uncertain. Resume request ${pending.requestId} from Home.`);
    else await this.follow(this.saved);
    throw new Home();
  }
  private async follow(saved: Operation) {
    while (!saved.runId) {
      const lookup = (background = false) => this.read("request", { request: saved.requestId, expectedRepository: saved.repository }, background);
      let report = await lookup();
      let choice = -2;
      if (typeof report.data?.run !== "number") {
        let active = true, timer: ReturnType<typeof setTimeout> | undefined;
        const poll = async () => {
          const next = await lookup(true);
          if (!active) return;
          report = next;
          if (typeof report.data?.run !== "number") timer = setTimeout(() => { void poll().catch(() => {}); }, this.base.interval * 1000);
        };
        timer = setTimeout(() => { void poll().catch(() => {}); }, this.base.interval * 1000);
        try {
          choice = await this.ui.select(`Watching ${saved.environment} ${saved.operation} › Waiting for GitHub`,
            ["Deployment actions"], 0, {
              observe: true, back: true, complete: () => typeof report.data?.run === "number",
              summary: () => [`${saved.environment} ${saved.operation} · ${saved.sha.slice(0, 8)}`, `Request ${saved.requestId}`, saved.accepted ? "Accepted; waiting for the run to appear. Checking automatically…" : "Acceptance was not recorded. Checking for this request automatically…",
                "The run is not visible yet. We will keep checking this request; no new deployment will be started.", ...report.errors.map(e => e.message)],
            });
        } finally { active = false; if (timer) clearTimeout(timer); }
      }
      if (choice === -1) return;
      if (choice === 0) {
        const action = await this.ui.select("Waiting for GitHub › Deployment actions", ["Keep waiting", "View request evidence", "Return Home"], 0, { back: true });
        if (action === 2) throw new Home();
        if (action === 1) await this.details(report, `bun run ops watch --request ${saved.requestId} --until serving`);
      }
      if (typeof report.data?.run === "number") {
        saved = { ...saved, runId: report.data.run, attempt: Number(report.data.attempt) };
        this.saved = saved; await this.deps.save(saved);
      }
    }
    await this.followRun(saved.runId!, saved.attempt, saved);
  }
  private async followRun(id: number, attempt?: number, saved?: Operation) {
    let workflow = empty(), verification: Report | undefined, active = true, timer: ReturnType<typeof setTimeout> | undefined;
    let pinned = attempt, started = Date.now(), generation = 0;
    const context = { expectedRepository: saved?.repository, expectedSha: saved?.sha, env: saved?.environment };
    const blocked = () => [...workflow.errors, ...(verification?.errors ?? [])].some(e => ["RUN_SUPERSEDED", "SESSION_REPOSITORY", "ENVIRONMENT_MISMATCH"].includes(e.code));
    const timedOut = () => Date.now() - started >= this.base.timeout * 1000;
    const serving = () => verification?.data?.outcome === "serving" && !verification.errors.length && !workflow.errors.length;
    const failed = () => workflow.data?.status === "completed" && workflow.data?.conclusion !== "success";
    const finished = () => serving() || failed() || blocked() || timedOut();
    const progress = () => [...deploymentProgress(workflow, verification, id, pinned, this.base.interval, saved, blocked() || timedOut()),
      ...(timedOut() ? ["Local watch timed out. The remote operation continues; choose Watch again to reconnect."] : [])];
    const poll = async () => {
      const observedGeneration = generation;
      const next = await this.read("watch", { args: [String(id)], attempt: pinned, expectedRepository: context.expectedRepository }, true);
      if (!active || generation !== observedGeneration) return;
      if (pinned === undefined && typeof next.data?.attempt === "number") pinned = next.data.attempt;
      workflow = next;
      if (next.data?.status === "completed" && next.data.conclusion === "success" && !next.errors.length) {
        const verified = await this.read("verify", { run: id, attempt: pinned, ...context }, true);
        if (!active || generation !== observedGeneration) return;
        verification = verified;
      } else verification = undefined;
      if (active && !finished()) timer = setTimeout(() => { void poll().catch(() => {}); }, this.base.interval * 1000);
    };
    void poll().catch(() => {});
    const command = () => `bun run ops watch ${id}${pinned ? ` --attempt ${pinned}` : ""} --until serving`;
    try {
      for (;;) {
        if (!finished()) {
          const index = await this.ui.select(`Watching ${saved?.environment ?? ""} ${saved?.operation ?? "deployment"} › Run #${id}`,
            ["Deployment actions"], 0, { observe: true, back: true, complete: finished, summary: progress });
          if (index === -1) return;
          if (index === -2) continue;
        }
        const terminal = finished();
        const title = terminal ? serving() ? "Deployment complete" : failed() ? "Deployment failed or cancelled" : "Deployment needs attention" : "Deployment actions · Watching continues";
        const choice = await this.ui.select(title,
          [terminal ? "Return Home" : "Return to live watch", "View all jobs and evidence", "Investigate this operation", "Show resume command", terminal ? "Watch again" : "Stop watching and go Home"], 0,
          { back: true, summary: progress, complete: terminal ? undefined : finished });
        if (choice === -2) continue;
        if (choice < 0) { if (terminal) return; continue; }
        if (choice === 0) { if (terminal) throw new Home(); continue; }
        if (choice === 1) await this.details(workflow, command());
        if (choice === 2) await this.operation(id, pinned);
        if (choice === 3) {
          this.ui.tell(`To reconnect later:\n${this.equivalent(command())}\n${terminal ? "This observation has finished." : "Returning to live watch automatically."}`);
        }
        if (choice === 4) {
          if (!terminal) throw new Home();
          // Retry observation only; never resend a deployment or adopt a new attempt.
          if (timer) clearTimeout(timer);
          generation++;
          workflow = empty(); verification = undefined; started = Date.now();
          void poll().catch(() => {});
        }
      }
    } finally { active = false; if (timer) clearTimeout(timer); }
  }
  private async access() {
    while (await this.menu("Setup and access", [
      { label: "Check account access", action: () => this.report("Account access", "auth", { args: ["status"] }, "bun run ops auth status") },
      { label: "Check repository and project configuration", action: () => this.report("Configuration", "doctor", {}, "bun run ops doctor") },
      { label: "Run guided setup / repair", action: () => this.deps.setup() },
    ])) { /* return to the calling journey */ }
  }
}
