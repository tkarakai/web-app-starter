import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { readPublicFile, writePublicFile } from "../deploy-setup/model.ts";
import { safePath } from "../setup-updates/state.ts";
import type { WorkflowRecord } from "./types.ts";

export const RECORD = ".github/repository-workflow.json";
export function validateRecord(value: unknown): WorkflowRecord {
  const r = value as WorkflowRecord;
  if (!r || r.schemaVersion !== 1 || typeof r.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(r.repository)
    || !Number.isInteger(r.approvals) || r.approvals < 0 || r.approvals > 6
    || typeof r.dismissStaleReviews !== "boolean" || !Array.isArray(r.maintenanceBots)) throw Error("Invalid repository workflow policy; inspect " + RECORD);
  for (const bot of r.maintenanceBots) {
    if (!bot || typeof bot.login !== "string" || !/^[a-z0-9-]+\[bot\]$/.test(bot.login) || !Number.isSafeInteger(bot.appId) || bot.appId < 1
      || bot.kind !== "platform-update" || !["patch", "minor"].includes(bot.policy)) throw Error("Maintenance policies need a named GitHub App bot and a patch/minor constraint");
  }
  if (new Set(r.maintenanceBots.map(b => b.login)).size !== r.maintenanceBots.length) throw Error("Duplicate maintenance bot policy");
  if (r.discovery) {
    if (!Number.isSafeInteger(r.discovery.pr) || r.discovery.pr < 1 || typeof r.discovery.sha !== "string" || !/^[a-f0-9]{40}$/.test(r.discovery.sha) || !Array.isArray(r.discovery.checks)) throw Error("Invalid first-PR discovery");
    for (const c of r.discovery.checks) if (!c || typeof c.label !== "string" || !c.label || typeof c.context !== "string" || !c.context || /[\r\n]/.test(c.context) || !Number.isSafeInteger(c.appId) || c.appId < 1) throw Error("Invalid required check binding");
    if (new Set(r.discovery.checks.map(c => c.label)).size !== r.discovery.checks.length) throw Error("Ambiguous required check bindings");
  }
  return { schemaVersion: 1, repository: r.repository, approvals: r.approvals, dismissStaleReviews: r.dismissStaleReviews,
    maintenanceBots: r.maintenanceBots.map(b => ({ login: b.login, appId: b.appId, kind: b.kind, policy: b.policy })),
    ...(r.discovery ? { discovery: { pr: r.discovery.pr, sha: r.discovery.sha, checks: r.discovery.checks.map(c => ({ label: c.label, context: c.context, appId: c.appId })) } } : {}) };
}
export function readRecord(root: string, repo?: string): WorkflowRecord | undefined {
  safePath(root, RECORD);
  const text = readPublicFile(root, RECORD);
  if (text === undefined) return undefined;
  const record = validateRecord(JSON.parse(text));
  if (repo !== undefined && record.repository.toLowerCase() !== repo.toLowerCase()) throw Error("Repository workflow policy belongs to another repository");
  return record;
}
export function saveRecord(root: string, record: WorkflowRecord): void {
  const clean = validateRecord(record); safePath(root, RECORD);
  mkdirSync(path.join(root, ".github"), { recursive: true });
  writePublicFile(root, RECORD, JSON.stringify(clean, null, 2) + "\n");
}
export function expectedChecks(root: string, isPrivate: boolean): string[] {
  return checkInventory(isPrivate, file => existsSync(path.join(root, file)));
}
export function checkInventory(isPrivate: boolean, hasPackage: (file: string) => boolean): string[] {
  const checks = ["CI Shared Complete"];
  for (const [dir, label] of [["platform/apps/storybook", "Storybook"], ["apps/web", "Web"], ["platform/apps/admin", "Admin"], ["apps/landing", "Landing"]]) {
    if (hasPackage(`${dir}/package.json`)) checks.push(`CI ${label} Complete`);
  }
  checks.push("Security Complete");
  if (!isPrivate) checks.push("CodeQL");
  return checks;
}
