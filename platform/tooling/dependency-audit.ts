import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function auditResult(output: string, status: number | null): { high: number; lower: number } {
  if (status !== 0 && status !== 1) throw new Error(`Dependency scanner failed (exit ${status})`);
  const parsed: unknown = JSON.parse(output);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid audit response");
  let high = 0, lower = 0;
  for (const rows of Object.values(parsed)) {
    if (!Array.isArray(rows)) throw new Error("Invalid audit advisory list");
    for (const row of rows) {
      if (!row || typeof row !== "object" || !["low", "moderate", "high", "critical"].includes(row.severity) || typeof row.url !== "string" || typeof row.title !== "string") throw new Error("Invalid audit advisory");
      if (["high", "critical"].includes(row.severity)) high++; else lower++;
    }
  }
  // Bun exits 1 for findings of any severity. An empty error response is not clean.
  if ((high + lower === 0) !== (status === 0)) throw new Error("Audit exit status disagrees with the response");
  return { high, lower };
}
export function runAudit(): void {
  if (!existsSync("bun.lock")) throw new Error("Missing bun.lock; cannot audit dependencies");
  const result = spawnSync("bun", ["audit", "--json"], { encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.signal || result.stderr.trim()) throw new Error(`Dependency scanner failed: ${result.error ?? result.stderr ?? result.signal}`);
  const counts = auditResult(result.stdout, result.status);
  if (counts.high) { console.error(result.stdout); throw new Error(`${counts.high} high/critical dependency advisories`); }
  console.log(`Dependency audit passed: no high/critical advisories; ${counts.lower} lower-severity advisories.`);
  if (counts.lower) console.warn(result.stdout);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runAudit(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
