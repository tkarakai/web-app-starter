import { safeUrl } from "./evidence";
import { errorInfo, redact } from "./errors";
import type { Result } from "./types";
export function safeCell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // Provider strings must not inject ANSI escapes or terminal control sequences.
  // eslint-disable-next-line no-control-regex
  return redact(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}
export function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "No matching records.";
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const cells = rows.map(row => keys.map(k => safeCell(row[k])));
  const labels = keys.map(k => k.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase());
  const widths = labels.map((k, i) => Math.min(72, Math.max(k.length, ...cells.map(c => c[i].length))));
  const format = (row: string[]) => row.map((v, i) => (v.length > widths[i] ? `${v.slice(0, widths[i] - 1)}…` : v).padEnd(widths[i])).join("  ").trimEnd();
  return [format(labels), ...cells.map(format)].join("\n");
}
export function sanitizeLinks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeLinks);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /url$/i.test(key) && typeof entry === "string" ? safeUrl(entry) : sanitizeLinks(entry)]));
}
export function envelope(command: string, data: Result | null, errors: unknown[] = [], warnings: string[] = []) {
  return { schemaVersion: 1, command, ok: errors.length === 0, partial: data !== null && errors.length > 0,
    observedAt: new Date().toISOString(), data: sanitizeLinks(data), errors: errors.map(errorInfo), warnings };
}
// Human tables stay compact; JSON always retains the complete records.
function humanRows(command: string, section: string, rows: Record<string, unknown>[]) {
  const columns: Record<string, string[]> = {
    status: ["environment", "app", "state", "deployedSha", "latestAttempt", "deployedAt"],
    diagnose: ["job", "stage", "status", "conclusion", "step"],
    verify: ["app", "state", "expectedSha", "servingSha", "reason"],
    recentOperations: ["environment", "run", "status", "conclusion", "createdAt"],
    deploymentTags: ["environment", "sha", "operation", "taggedAt"],
    history: ["environment", "app", "sha", "result", "health", "actor", "recordedAt"],
    builds: ["app", "artifact", "builtFrom", "uploadedAt", "available", "expiresAt"],
    candidates: ["sha", "change", "ci", "artifactSummary", "eligibility"],
    inspect: ["app", "action", "builtFrom", "artifact", "expiresAt"],
    diff: ["app", "from", "to", "relationship", "ahead", "behind", "url"],
    runs: ["run", "workflow", "sha", "status", "conclusion", "activeJobs"],
    watch: ["job", "status", "conclusion", "step"],
    workflows: ["run", "workflow", "status", "conclusion", "createdAt"],
  };
  const keys = command === "candidates" && section === "rows" && rows.some(row => row.branch)
    ? ["sha", "change", "ci", "artifactSummary", "branch"] : columns[section === "rows" ? command : section === "activity" ? "runs" : section];
  if (!keys) return rows;
  return rows.map(row => Object.fromEntries(keys.map(key => {
    let value = row[key];
    if (command !== "candidates" && typeof value === "string" && /^[a-f0-9]{40}$/.test(value)) value = value.slice(0, 8);
    if (typeof value === "string" && /At$/.test(key)) value = value.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC");
    if (key === "activeJobs" && Array.isArray(value)) value = value.map(j => `${j.name}: ${j.step ?? j.status}`).join("; ");
    return [key, value];
  })));
}
export function render(command: string, data: Result, json: boolean, errors: unknown[] = [], warnings: string[] = [], sink = { log: (line: string) => console.log(line), error: (line: string) => console.error(line) }) {
  const result = envelope(command, data, errors, warnings);
  for (const error of errors) { const e = errorInfo(error); sink.error(`Error [${e.code}]: ${safeCell(e.message)}\n${e.hint.split("\n").map(safeCell).join("\n")}`); }
  if (json) sink.log(redact(JSON.stringify(result)));
  else {
    sink.log(`${command} · observed ${result.observedAt}`);
    for (const [key, value] of Object.entries(sanitizeLinks(data) as Result)) {
      if (key === "jobs") continue;
      if (command === "status" && key === "rows" && Array.isArray(value) && !value.length && result.errors.some(e => e.code === "CONFIG_MISSING")) continue;
      if (key === "logs" && typeof value === "string") { sink.log(value.split("\n").map(safeCell).join("\n")); continue; }
      if (Array.isArray(value) && value.every(v => typeof v === "object" && v !== null)) {
        const headings: Record<string, string> = { deploymentTags: "Release tags", workflows: "Deployment workflows", activity: "Active CI and builds", backend: "Backend records", skipped: "Not tracked (skipped in setup)" };
        const rowHeadings: Record<string, string> = { history: "App outcomes", status: "Current environments", builds: "Artifacts", candidates: data.target === "staging" ? "Staging candidates" : "Production candidates", inspect: "Deployment plan", diff: "Changes", runs: "Workflow runs", watch: "Jobs" };
        sink.log(`\n${key === "rows" ? rowHeadings[command] ?? "Results" : headings[key] ?? key}\n${table(humanRows(command, key, value as Record<string, unknown>[]))}`);
        if (key !== "coverage") for (const row of value as Record<string, unknown>[]) {
          const link = safeUrl(row.url);
          if (link) sink.log(`  ${safeCell(row.app ?? row.run ?? row.sha ?? row.job ?? "Source")}: ${link}`);
          if (row.next) sink.log(`  Next: ${safeCell(row.next)}`);
        }
      } else if (value !== undefined) sink.log(`${key}: ${safeCell(value)}`);
    }
  }
  for (const warning of warnings) sink.error(`Warning: ${safeCell(warning)}`);
}
