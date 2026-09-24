import { command } from "./config";
import { errorInfo, OpsError, redact } from "./errors";
import { assertAttempt } from "./journeys";
import type { Options } from "./options";
import type { OpsService } from "./service";
import type { Coverage, Result } from "./types";

export interface Report { command?: string; data: Result | null; errors: ReturnType<typeof errorInfo>[]; warnings: string[]; coverage: Coverage[]; observedAt: string }
export type Query = (options: Options) => Promise<Report>;
export async function query(service: OpsService, options: Options): Promise<Report> {
  let data: Result | null = null;
  try { data = await execute(service, options); }
  catch (error) { service.errors.push(error); }
  return { command: options.command, data: data ? { repository: service.config.repository, ...data } : null, errors: service.errors.map(errorInfo), warnings: service.warnings, coverage: service.coverage, observedAt: new Date().toISOString() };
}
export function verificationExit(data: Result): number {
  return data.outcome === "serving" ? 0 : data.outcome === "incomplete" ? 3 : data.outcome === "workflow-failed" ? 4 : 6;
}

export async function execute(service: OpsService, o: Options): Promise<Result> {
  switch (o.command) {
    case "diagnose": return service.diagnose(Number(o.args[0]), o);
    case "verify": return service.verify(o.run!, o);
    case "request": { const run = await service.requestRun(o.request!); return { run: run?.id, attempt: run?.run_attempt, status: run?.status ?? "not-observed", url: run?.html_url }; }
    case "watch": return service.runDetails(Number(o.args[0]), o.attempt);
    case "status": return service.status(o);
    case "history": return service.history(o);
    case "builds": return service.builds(o);
    case "candidates": return service.candidates(o);
    case "inspect": return service.releasePreview(o.args[0], o);
    case "diff": return service.diff(o.args[0], o.args[1], o);
    case "runs": return service.runs(o);
    case "projects": return service.projects();
    case "deploy": case "rollback": return service.dispatch(o.args[0], o);
    case "logs": {
      const run = await service.run(Number(o.args[0])); assertAttempt(run, o.attempt);
      if (run.status !== "completed") throw new OpsError("LOGS_NOT_READY", "GitHub downloadable job logs are not complete while the run is active.", `Use ops watch ${run.id} for live step status, or open ${run.html_url}.`, 2);
      const logs = await command("gh", ["run", "view", String(run.id), "--repo", service.config.repository, "--log-failed", "--attempt", String(run.run_attempt)]);
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
