import * as fs from "node:fs";
import * as path from "node:path";
import { canonical, demand, digest, safeRelative } from "./metadata.ts";
import { readRegular } from "./io.ts";
import { secretValueFile } from "./ownership.ts";
import type { Gate, Plan } from "./plan.ts";

export type Outcome = "planned" | "unchanged" | "verified" | "needs-review" | "failed";
export type Decision = { gateId: string; planDigest: string; action: "reviewed" | "accept-release" | "reapply-patch" | "secret-configured" | "migration-complete"; evidence: string; at: string; migration?: { deployment: string; evidenceDigest: string } };
export type Step = { id: string; status: "passed" | "failed" | "pending"; command: string[]; exitCode: number | null; log: string; changedFiles: string[] };
export type UpgradeState = { stage: "planned" | "applied" | "codemods" | "installed" | "verified" | "recorded"; expectedFiles: Record<string, string>; decisions: Decision[]; steps: Step[]; branch?: string; executionRoot?: string; error?: string; activeStep?: string; requiresReplan?: boolean; hash: string };
export type Report = { schemaVersion: 1; tool: "platform-upgrade"; outcome: Outcome; plan: Plan; state: UpgradeState; updatedAt: string };

export function reportAppRoot(report: Report): string { return report.state.executionRoot ?? report.plan.app.root; }
export function sealState(state: UpgradeState): void { state.hash = digest(canonical(Object.fromEntries(Object.entries(state).filter(([key]) => key !== "hash")))); }
export function createReport(plan: Plan, files: Record<string, string>): Report {
  const state: UpgradeState = { stage: "planned", expectedFiles: files, decisions: [], steps: [], hash: "" }; sealState(state);
  return { schemaVersion: 1, tool: "platform-upgrade", outcome: "planned", plan, state, updatedAt: new Date().toISOString() };
}
export function readReport(file: string): Report {
  const value = JSON.parse(readRegular(file, 32 * 1024 * 1024).content.toString("utf8")) as Report;
  demand(value?.schemaVersion === 1 && value.tool === "platform-upgrade" && value.plan && value.state, "Unknown upgrade report schema");
  const { digest: planDigest, ...unsignedPlan } = value.plan;
  demand(digest(canonical(unsignedPlan)) === planDigest, "Upgrade plan changed; create a new plan");
  const { hash, ...unsignedState } = value.state;
  demand(digest(canonical(unsignedState)) === hash, "Upgrade state changed outside the tool; inspect and replan");
  demand(value.state.decisions.every(row => row.planDigest === planDigest && value.plan.gates.some(gate => gate.id === row.gateId)), "A review decision belongs to another plan");
  return value;
}
function safeReportPath(file: string): void {
  const full = path.resolve(file); demand(!secretValueFile(full), "A report cannot replace a secret-value file");
  let current = path.parse(full).root;
  for (const segment of full.slice(current.length).split(path.sep)) {
    current = path.join(current, segment);
    try { demand(!fs.lstatSync(current).isSymbolicLink(), "Report path traverses a symlink"); }
    catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
  }
}
export function reportPaths(file: string): { json: string; markdown: string } {
  // Resolve the caller-selected directory (including OS aliases such as macOS /var).
  // Never resolve the final file: an existing symlink is rejected by safeReportPath.
  const absolute = path.resolve(file); let parent = path.dirname(absolute); const missing: string[] = [];
  while (!fs.existsSync(parent)) { missing.unshift(path.basename(parent)); parent = path.dirname(parent); }
  const json = path.join(fs.realpathSync(parent), ...missing, path.basename(absolute));
  demand(json.endsWith(".json"), "The report path must end in .json");
  return { json, markdown: json.slice(0, -5) + ".md" };
}
export function exclusions(root: string, file: string): string[] {
  return Object.values(reportPaths(file)).map(full => path.relative(root, full).split(path.sep).join("/")).filter(relative => relative && !relative.startsWith("../") && !path.isAbsolute(relative)).map(relative => safeRelative(relative));
}
export function writeReport(file: string, report: Report): void {
  const paths = reportPaths(file);
  safeReportPath(paths.json); safeReportPath(paths.markdown);
  if (fs.existsSync(paths.json)) { const previous = readReport(paths.json); demand(previous.plan.app.root === report.plan.app.root && previous.plan.digest === report.plan.digest, "Report path belongs to another plan; choose another path"); }
  else demand(!fs.existsSync(paths.markdown), "Markdown report path already exists");
  report.updatedAt = new Date().toISOString(); sealState(report.state);
  for (const [destination, content] of [[paths.json, JSON.stringify(report, null, 2) + "\n"], [paths.markdown, renderReport(report)]] as const) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = destination + ".tmp-" + process.pid;
    const fd = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(fd, content); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, destination);
  }
}
export function decisionFor(report: Report, gate: Gate): Decision | undefined { return report.state.decisions.find(row => row.gateId === gate.id && row.planDigest === report.plan.digest); }
export function unresolved(report: Report, beforeApplyOnly = false): Gate[] { return report.plan.gates.filter(gate => (!beforeApplyOnly || gate.beforeApply) && !decisionFor(report, gate)); }
export function recordDecision(report: Report, input: { id: string; action: Decision["action"]; evidence: string; migrationEvidence?: string }): void {
  const gate = report.plan.gates.find(row => row.id === input.id); demand(gate, "Unknown review item: " + input.id);
  demand(input.evidence.trim().length >= 8 && input.evidence.length < 4096, "Provide a specific review reason/evidence, without secret values");
  demand(gate.kind !== "unrecorded-zone", "Record or remove the platform patch and create a new plan");
  const allowed: Record<Gate["kind"], Decision["action"][]> = {
    patch: ["accept-release", "reapply-patch"], "unrecorded-zone": [], "seam-conflict": ["reviewed", "accept-release"],
    "removed-env": ["reviewed"], "dynamic-env": ["reviewed"], "new-secret": ["secret-configured"], dependency: ["reviewed"], advisory: ["reviewed"], migration: ["migration-complete"],
  };
  demand(allowed[gate.kind].includes(input.action), "Unsupported resolution for " + gate.kind);
  const decision: Decision = { gateId: gate.id, planDigest: report.plan.digest, action: input.action, evidence: input.evidence, at: new Date().toISOString() };
  if (gate.kind === "migration") {
    demand(input.migrationEvidence, "Migration completion needs a saved, read-only status report");
    const text = fs.readFileSync(input.migrationEvidence, "utf8"); demand(text.length < 1024 * 1024, "Oversized migration evidence");
    const evidence = JSON.parse(text) as { phase?: string; matches?: boolean; deployment?: string; tables?: { matches?: boolean; missing?: number; mismatched?: number }[] };
    demand(evidence.phase === "complete" && evidence.matches === true && typeof evidence.deployment === "string", "Migration status is not complete and verified for a named deployment");
    const deployment = new URL(evidence.deployment); demand(["https:", "http:"].includes(deployment.protocol) && !deployment.username && !deployment.password && !deployment.search && !deployment.hash, "Invalid migration deployment URL");
    demand(Array.isArray(evidence.tables) && evidence.tables.length > 0 && evidence.tables.every(row => row.matches === true && row.missing === 0 && row.mismatched === 0), "Migration row verification is incomplete");
    decision.migration = { deployment: deployment.href.replace(/\/$/, ""), evidenceDigest: digest(text) };
  }
  report.state.decisions = report.state.decisions.filter(row => row.gateId !== gate.id).concat(decision);
  sealState(report.state);
}
function escape(text: string): string { return text.replace(/[\\`*_{}[\]<>|]/g, "\\$&"); }
export function renderReport(report: Report): string {
  const p = report.plan, pending = unresolved(report);
  const lines = [
    `# Platform ${p.installed.version} → ${p.target.version}`, "",
    `**Outcome: ${report.outcome}.** Stage: ${report.state.stage}.`, "",
    `Source: ${escape(p.source.kind === "github" ? "https://github.com/" + p.source.repo : p.source.path)}.`,
    `Installed commit: \`${p.installed.commit}\`. Target commit: \`${p.target.commit}\`.`,
    `Plan: \`${p.digest}\`. App starts at \`${p.app.head}\`.`, "",
    "## Review items", "",
    ...(pending.length ? pending.map(gate => `- [ ] **${escape(gate.id)}** — ${escape(gate.message)}`) : ["No unresolved review items."]),
    ...report.state.decisions.map(row => `- [x] ${escape(row.gateId)}: ${escape(row.action)} — ${escape(row.evidence)}`), "",
    "## Source changes", "", "| Path | Kind | Action |", "| --- | --- | --- |",
    ...p.changes.map(row => `| ${escape(row.path)} | ${row.kind} | ${row.action}${row.conflict ? "; conflict" : ""} |`), "",
    "## Ordered steps", "",
    ...p.releases.map(row => `- Release ${row.version}: \`${row.commit}\``),
    ...p.codemods.map(row => `- Codemod ${escape(row.id)} from ${row.release}: ${escape(row.path)}; possible app paths: ${row.touches.map(escape).join(", ")}`),
    ...p.migrations.map(row => `- Migration ${escape(row.id)}: expand ${escape(row.expansion)}, then verify, then contract ${escape(row.contract)}. ${escape(row.instructions)}. Read-only status: ${row.statusCommand.map(escape).join(" ")}`), "",
    "## Environment and dependencies", "",
    ...p.environment.changes.map(row => `- ${row.kind} ${row.name}${row.replacement ? " → " + row.replacement : ""}; ${row.secret ? "secret" : "public"}, ${row.required ? "required" : "optional"}.`),
    ...p.environment.scan.references.filter(row => p.environment.changes.some(change => change.name === row.name)).map(row => `- ${row.name}: ${escape(row.file)}:${row.line} (${row.kind})`),
    ...p.environment.scan.dynamic.map(row => `- Dynamic env access: ${escape(row.file)}:${row.line}`),
    ...p.dependencies.map(row => `- ${escape(row.path)}: ${escape(row.name)} ≥ ${row.minimum}; ${row.ranges.map(range => `${escape(range.before)} → ${escape(range.after ?? "review required")}`).join(", ")}`), "",
    "## Advisories, removals and patches", "",
    ...p.advisories.map(row => `- **${row.severity}: ${escape(row.id)}** — ${escape(row.summary)}; affected ${escape(row.affected)}, fixed ${row.fixed}.`),
    ...p.removedFiles.map(file => `- Removed upstream: ${escape(file)}`),
    ...p.renamedExports.map(row => `- Renamed export: ${escape(row.from)} → ${escape(row.to)}`),
    ...p.patches.map(row => `- Patch ${escape(row.path)}: ${row.absorbed ? "absorbed by target" : "requires a decision"}; ${escape(row.reason)}. Base/app/target diffs are in the JSON report.`),
    ...p.earlyCommits.map(commit => `- Early upstream commit absorbed: \`${commit}\``), "",
    "## Verification", "",
    ...report.state.steps.map(row => `- ${row.status}: ${escape(row.id)} (exit ${row.exitCode ?? "pending"})${row.log ? "; " + escape(row.log) : ""}`),
    ...(report.state.error ? ["", "Error: " + escape(report.state.error)] : []), "",
    "## Recovery", "", p.rollback, "",
    "The installed baseline advances only after all required checks and review/migration gates pass.", "",
  ];
  return lines.join("\n");
}
