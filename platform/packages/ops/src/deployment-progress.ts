import type { Report } from "./operations";
import type { Operation } from "./session";

const jobs = (report: Report) => Array.isArray(report.data?.rows) ? report.data.rows as Record<string, unknown>[] : [];
const failed = (job: Record<string, unknown>) => job.status === "completed" && !["success", "skipped", "neutral"].includes(String(job.conclusion));
const stage = (name: string) => /^ci-|^CI |^Validate|^Detect Changes/.test(name) ? "Checks"
  : /^(Build |Resolve |Attest )/.test(name) ? "Artifacts"
    : /^Deploy /.test(name) ? "Deployment" : "Verification and records";

export function deploymentProgress(workflow: Report, verification: Report | undefined, id: number, attempt: number | undefined,
  interval: number, saved?: Operation, stopped = false): string[] {
  const all = jobs(workflow), active = all.filter(j => j.status === "in_progress"), failures = all.filter(failed);
  const done = workflow.data?.status === "completed", success = done && workflow.data?.conclusion === "success";
  const errors = [...workflow.errors, ...(verification?.errors ?? [])];
  const serving = verification?.data?.outcome === "serving" && !errors.length;
  const headline = serving ? "COMPLETE — workflow passed; intended release is serving."
    : done && !success ? `STOPPED — workflow ${workflow.data?.conclusion ?? "finished without success"}.`
      : stopped ? "NEEDS ATTENTION — monitoring stopped before completion was confirmed."
        : success ? "VERIFYING — workflow passed; checking intended release is serving."
          : failures.length ? "RUNNING — a job failed; waiting for the workflow to finish."
            : active.length ? `RUNNING — ${stage(String(active[0].job)).toLowerCase()}.`
              : workflow.observedAt ? `WAITING — workflow ${workflow.data?.status ?? "status unavailable"}.` : "CONNECTING — fetching deployment progress…";
  const lines = [saved ? `${saved.environment} ${saved.operation} · ${saved.sha.slice(0, 8)} · run #${id} / attempt ${attempt ?? "?"}` : `Run #${id} / attempt ${attempt ?? "?"}`,
    headline, `${stopped || serving || (done && !success) ? "Last checked" : `Auto-refresh ${interval}s · checked`} ${verification?.observedAt || workflow.observedAt || "pending"}`];
  for (const group of ["Checks", "Artifacts", "Deployment", "Verification and records"]) {
    const found = all.filter(j => stage(String(j.job)) === group);
    const counts = [
      ["passed", found.filter(j => j.conclusion === "success").length],
      ["running", found.filter(j => j.status === "in_progress").length],
      ["waiting", found.filter(j => j.status !== "completed" && j.status !== "in_progress").length],
      ["failed/cancelled", found.filter(failed).length],
      ["skipped", found.filter(j => j.conclusion === "skipped").length],
    ].filter(([, count]) => count).map(([label, count]) => `${count} ${label}`);
    lines.push(`${group}: ${counts.join(", ") || (done ? "no jobs reported" : "not started")}`);
  }
  if (verification?.data) {
    const states = jobs(verification).map(row => `${row.app}: ${row.state}`);
    lines.push(`Serving: ${states.join(" · ") || verification.data.outcome}`);
    if (!serving) {
      const reason = jobs(verification).find(row => !["serving", "workflow-evidence"].includes(String(row.state)))?.reason ?? verification.data.note;
      if (reason) lines.push(String(reason));
    }
  } else lines.push(`Serving: ${success ? "checking now…" : "checked after workflow success"}`);
  // Prioritize what is happening now, never the first few completed jobs.
  for (const job of [...failures, ...active].slice(0, 3)) lines.push(`${failed(job) ? "Failed" : "Now"}: ${job.job}${job.step ? ` · ${job.step}` : ""}`);
  if (active.length + failures.length > 3) lines.push("More active/failed jobs in Deployment actions → View all jobs and evidence.");
  if (errors.length) lines.push(`Read problem: ${errors[0].message}${stopped ? "" : " Retrying automatically."}`);
  return lines;
}
