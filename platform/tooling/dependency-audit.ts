import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXCEPTIONS_FILE = "dependency-audit-exceptions.json";

// A reviewed, expiring acceptance of one high/critical advisory in one package. It exists only
// for an advisory whose fix cannot be installed yet and whose vulnerable path the app does not
// reach; the reason records why, and the ticket tracks the upgrade that removes it.
export type AuditException = { advisory: string; package: string; expires: string; reason: string; ticket: string };

export function parseExceptions(text: string): AuditException[] {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).join() !== "exceptions" || !Array.isArray((parsed as { exceptions: unknown }).exceptions)) throw new Error(`${EXCEPTIONS_FILE} must be { "exceptions": [...] }`);
  return (parsed as { exceptions: unknown[] }).exceptions.map(row => {
    const entry = row as Record<string, unknown>;
    const keys = ["advisory", "package", "expires", "reason", "ticket"];
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(entry).sort().join() !== [...keys].sort().join() || !keys.every(key => typeof entry[key] === "string" && (entry[key] as string).trim())) throw new Error(`${EXCEPTIONS_FILE}: each exception needs exactly ${keys.join(", ")}`);
    const exception = entry as AuditException;
    if (!/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(exception.advisory)) throw new Error(`${EXCEPTIONS_FILE}: invalid advisory ${exception.advisory}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires) || Number.isNaN(Date.parse(`${exception.expires}T00:00:00Z`))) throw new Error(`${EXCEPTIONS_FILE}: invalid expiry ${exception.expires} for ${exception.advisory}`);
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(exception.ticket)) throw new Error(`${EXCEPTIONS_FILE}: ${exception.advisory} needs a GitHub issue URL as its ticket`);
    return exception;
  });
}

export function auditResult(output: string, status: number | null, exceptions: AuditException[] = [], today = new Date().toISOString().slice(0, 10)): { high: number; lower: number; excepted: number } {
  if (status !== 0 && status !== 1) throw new Error(`Dependency scanner failed (exit ${status})`);
  const parsed: unknown = JSON.parse(output);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid audit response");
  for (const exception of exceptions) if (exception.expires < today) throw new Error(`Audit exception for ${exception.advisory} (${exception.package}) expired on ${exception.expires}; re-assess it (${exception.ticket})`);
  const used = new Set<AuditException>();
  let high = 0, lower = 0, excepted = 0;
  for (const [name, rows] of Object.entries(parsed)) {
    if (!Array.isArray(rows)) throw new Error("Invalid audit advisory list");
    for (const row of rows) {
      if (!row || typeof row !== "object" || !["low", "moderate", "high", "critical"].includes(row.severity) || typeof row.url !== "string" || typeof row.title !== "string") throw new Error("Invalid audit advisory");
      if (!["high", "critical"].includes(row.severity)) { lower++; continue; }
      const exception = exceptions.find(entry => entry.package === name && row.url.endsWith(`/${entry.advisory}`));
      if (exception) { used.add(exception); excepted++; } else high++;
    }
  }
  // Bun exits 1 for findings of any severity. An empty error response is not clean.
  if ((high + lower + excepted === 0) !== (status === 0)) throw new Error("Audit exit status disagrees with the response");
  const stale = exceptions.filter(exception => !used.has(exception));
  if (stale.length) throw new Error(`Audit exceptions no longer match a high/critical finding; remove them: ${stale.map(exception => `${exception.advisory} (${exception.package})`).join(", ")}`);
  return { high, lower, excepted };
}
export function runAudit(): void {
  if (!existsSync("bun.lock")) throw new Error("Missing bun.lock; cannot audit dependencies");
  const exceptions = existsSync(EXCEPTIONS_FILE) ? parseExceptions(readFileSync(EXCEPTIONS_FILE, "utf8")) : [];
  const result = spawnSync("bun", ["audit", "--json"], { encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.signal || result.stderr.trim()) throw new Error(`Dependency scanner failed: ${result.error ?? result.stderr ?? result.signal}`);
  const counts = auditResult(result.stdout, result.status, exceptions);
  if (counts.high) { console.error(result.stdout); throw new Error(`${counts.high} high/critical dependency advisories`); }
  console.log(`Dependency audit passed: no unexcepted high/critical advisories; ${counts.lower} lower-severity advisories.`);
  for (const exception of exceptions) console.warn(`Excepted until ${exception.expires}: ${exception.advisory} (${exception.package}): ${exception.reason} ${exception.ticket}`);
  if (counts.lower || counts.excepted) console.warn(result.stdout);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runAudit(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
