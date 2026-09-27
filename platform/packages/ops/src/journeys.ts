import { deployedApps, fullSha, safeUrl } from "./evidence";
import { OpsError } from "./errors";
import type { Options } from "./options";
import type { OpsService } from "./service";
import type { Deployment, Environment, Job, Result, Run } from "./types";

export function runEnvironment(run: Run, records: Deployment[]): Environment | undefined {
  if (run.path?.endsWith("/cd-staging.yml")) return "staging";
  if (run.path?.endsWith("/cd-production.yml")) return "production";
  const envs = [...new Set(records.filter(r => r.payload.runId === run.id && r.payload.runAttempt === run.run_attempt).map(r => r.environment))];
  return envs.length === 1 && ["staging", "production"].includes(envs[0]) ? envs[0] as Environment : undefined;
}
export function assertAttempt(run: Run, attempt?: number) {
  if (attempt !== undefined && run.run_attempt !== attempt) throw new OpsError("RUN_SUPERSEDED", `Run ${run.id} now has attempt ${run.run_attempt}; requested attempt ${attempt}.`, "Inspect the new attempt explicitly; the monitor will not silently switch operations.", 4);
}
export function failureStage(job: Job): string {
  const step = job.steps?.find(s => s.conclusion === "failure")?.name ?? "";
  const text = `${job.name} ${step}`;
  if (/migration/i.test(step)) return "migration";
  if (/Record Ops|deployment tag/i.test(text)) return "evidence recording";
  if (/smoke|health|verification/i.test(text)) return "verification";
  if (/convex|schema/i.test(text)) return "backend";
  if (/attest/i.test(text)) return "attestation";
  if (/Deploy /i.test(job.name)) return "frontend deployment";
  if (/build|resolve|artifact/i.test(text)) return "build/artifact";
  return "CI/validation";
}
export async function diagnose(service: OpsService, id: number, o: Options): Promise<Result> {
  const run = await service.run(id); assertAttempt(run, o.attempt);
  const [jobs, records] = await Promise.all([
    service.read(`jobs/${id}`, () => service.jobs(id, run.run_attempt), []), service.records(1000),
  ]);
  const attempts = records.filter(r => r.payload.runId === id && r.payload.runAttempt === run.run_attempt);
  const failed = jobs.filter(j => ["failure", "timed_out", "cancelled", "action_required"].includes(j.conclusion ?? ""));
  const environment = runEnvironment(run, attempts);
  const rows = jobs.map(job => ({ job: job.name, status: job.status, conclusion: job.conclusion,
    stage: failureStage(job), step: job.steps?.find(s => s.conclusion === "failure" || s.status === "in_progress")?.name ?? null,
    started: job.started_at, completed: job.completed_at, url: safeUrl(job.html_url) }));
  const effects = attempts.map(r => ({ app: r.payload.app, result: r.payload.result, buildResult: r.payload.buildResult,
    sha: r.sha, health: r.payload.health, url: safeUrl(r.payload.deploymentUrl) }));
  const next = failed.map(job => {
    const stage = failureStage(job);
    return stage === "migration" || stage === "backend" ? "Review backend/schema and migration logs. A rollback also deploys backend code and runs migrations; check data compatibility."
      : stage === "evidence recording" ? "Deployment may already have changed serving state. Check status before retrying the workflow."
        : stage === "verification" ? "Inspect serving domains and deployment logs; workflow failure alone does not mean the previous release is still serving."
          : `Inspect ${job.name} logs and its first failed step before retrying.`;
  });
  if (run.status !== "completed") next.push(`Operation is ${run.status}. Resume: ops watch ${id} --attempt ${run.run_attempt}`);
  if (!attempts.length) next.push("No per-app outcomes were found in the inspected window. Effects remain unknown; inspect current serving state.");
  const serving = environment ? await service.status({ ...o, env: environment }, false) : null;
  return { run: id, attempt: run.run_attempt, environment: environment ?? "unknown", workflow: run.name,
    status: run.status, conclusion: run.conclusion, url: safeUrl(run.html_url), rows, effects,
    serving: serving?.rows ?? [], next: [...new Set(next)],
    logsCommand: run.status === "completed" && failed.length ? `ops logs ${id} --attempt ${run.run_attempt}` : null,
    note: "Job failures and recorded effects are facts; these next steps are investigation guidance. Skipped jobs do not establish that nothing changed. No retry or rollback was dispatched." };
}

export async function verifyServing(service: OpsService, id: number, o: Options): Promise<Result> {
  const run = await service.run(id); assertAttempt(run, o.attempt);
  if (!/\/cd-(staging|production|rollback)\.yml$/.test(run.path)) throw new OpsError("USAGE", "Serving verification requires a deployment or rollback workflow.", "Choose a deployment run from ops history.", 2);
  const base = { run: id, attempt: run.run_attempt, url: safeUrl(run.html_url), workflowStatus: run.status, workflowConclusion: run.conclusion };
  if (run.status !== "completed") return { ...base, outcome: "waiting", rows: [], note: `Workflow is ${run.status}; serving verification begins after completion.` };
  if (run.conclusion !== "success") return { ...base, outcome: "workflow-failed", rows: [], next: `ops diagnose ${id} --attempt ${run.run_attempt}` };
  const records = await service.records(1000);
  const attempt = records.filter(r => r.payload.runId === id && r.payload.runAttempt === run.run_attempt);
  const environment = runEnvironment(run, attempt);
  if (!environment) return { ...base, outcome: "incomplete", rows: [], note: "Cannot establish the run's environment from workflow/record evidence." };
  if (o.env && environment !== o.env) throw new OpsError("ENVIRONMENT_MISMATCH", `Run ${id} targets ${environment}, not ${o.env}.`, "Choose a run for the intended environment.", 2);
  const live = await service.status({ ...o, env: environment, app: undefined }, false);
  const rows: Record<string, unknown>[] = [];
  const selected = new Set(attempt.map(r => r.sha));
  if (o.expectedSha && (selected.size !== 1 || !selected.has(o.expectedSha))) return { ...base, environment, outcome: "incomplete", rows: [], note: "Recorded target does not match the reviewed release. Inspect the run before proceeding." };
  for (const app of [...deployedApps, "backend"]) {
    const matches = attempt.filter(r => r.payload.app === app && r.environment === environment);
    const record = matches[0];
    let expected = record;
    let state = "incomplete";
    let reason = "Missing or conflicting per-app outcome evidence.";
    const valid = matches.length === 1 && selected.size === 1 && fullSha(record?.sha)
      && record.payload.selectedSha === record.sha;
    if (valid && ["success", "unchanged"].includes(record.payload.result ?? "")) {
      if (record.payload.result === "unchanged") {
        // An unchanged app is expected to retain the last observed successful deployment,
        // not adopt the selected commit's SHA. Absence of a baseline remains unknown.
        expected = records.filter(r => r.environment === environment && r.payload.app === app && r.payload.result === "success"
          && r.payload.runId !== id && r.created_at < record.created_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      }
      if (app === "backend") { state = "workflow-evidence"; reason = `${record.payload.result}; no live backend version probe`; }
      else {
        const observed = live.rows?.find(r => r.app === app);
        if (expected && fullSha(expected.sha) && expected.payload.selectedSha === expected.sha && observed && fullSha(observed.deployedSha)) {
          const identityMatches = observed.deployedSha === expected.sha && observed.runId === expected.payload.runId
            && observed.runAttempt === expected.payload.runAttempt && safeUrl(expected.payload.deploymentUrl) !== null
            && observed.deploymentUrl === safeUrl(expected.payload.deploymentUrl);
          state = identityMatches && observed.state === "READY" ? "serving" : "mismatch";
          reason = identityMatches ? `Expected deployment is ${observed.state}` : "Serving deployment differs from the expected app outcome.";
        } else reason = "Serving identity, tracking configuration, or unchanged-app baseline is unavailable.";
        rows.push({ app, state, reason, expectedSha: expected?.sha ?? null, servingSha: observed?.deployedSha ?? null,
          unchanged: record.payload.result === "unchanged", url: observed?.url ?? null });
        continue;
      }
    }
    rows.push({ app, state, reason, expectedSha: expected?.sha ?? null });
  }
  const outcome = service.errors.length || rows.some(r => r.state === "incomplete") ? "incomplete"
    : rows.some(r => r.state === "mismatch") ? "mismatch" : "serving";
  return { ...base, environment, outcome, rows,
    note: "Serving means workflow success plus exact expected frontend deployment identities on configured domains. Backend evidence is workflow-only. No new health probes, observation window, or database restoration is implied." };
}
