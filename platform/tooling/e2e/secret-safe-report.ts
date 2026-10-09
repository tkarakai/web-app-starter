/** Values are intentionally excluded: a reporter cannot recognize arbitrary credentials. */
export const statuses = ["passed", "failed", "timedOut", "skipped", "interrupted"] as const;
export type Status = typeof statuses[number];
export const categories = ["assertion", "timeout", "navigation", "runtime", "capture-policy"] as const;
export type Diagnostic = typeof categories[number];
export const activities = ["assertion", "fill", "type", "navigate", "click", "api", "fixture", "hook", "step", "attachment"] as const;
export type Activity = typeof activities[number];
export interface SafeAttempt {
  status: Status; expectedStatus: Status; retry: number; durationMs: number;
  diagnostics: Diagnostic[]; activities: Partial<Record<Activity, number>>;
  failures: Array<{ file: string; line: number; column: number; category: Activity }>;
}
export interface SafeTest {
  number: number; file: string; line: number; column: number;
  outcome: "expected" | "unexpected" | "flaky" | "skipped"; attempts: SafeAttempt[];
}
export interface SafeReport {
  version: 1; status: "passed" | "failed" | "timedout" | "interrupted";
  tests: SafeTest[]; globalErrors: Diagnostic[]; suppressedOutputBytes: number;
}
export function diagnostic(message = ""): Diagnostic {
  if (/expect\(|assertion|toHave|toEqual|toBe/.test(message)) return "assertion";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/goto|navigation|net::/.test(message)) return "navigation";
  return "runtime";
}
export function activity(category: string, title: string): Activity {
  if (category === "expect") return "assertion";
  if (category === "fixture" || category === "hook") return category;
  if (category === "test.attach") return "attachment";
  if (category !== "pw:api") return "step";
  if (/\bfill\b/i.test(title)) return "fill";
  if (/\btype\b|pressSequentially/i.test(title)) return "type";
  if (/\bgoto\b|navigate/i.test(title)) return "navigate";
  if (/\bclick\b/i.test(title)) return "click";
  return "api";
}
/** Reconstruct, never forward a parsed record with unknown keys or unchecked strings. */
export function validateReport(input: unknown): SafeReport {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid safe report");
    return value as Record<string, unknown>;
  };
  const integer = (value: unknown) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid safe number");
    return value;
  };
  const choice = <T extends string>(value: unknown, allowed: readonly T[]): T => {
    if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error("Invalid safe category");
    return value as T;
  };
  const array = (value: unknown): unknown[] => {
    if (!Array.isArray(value)) throw new Error("Invalid safe list");
    return value;
  };
  const sourceFile = (value: unknown) => {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_./-]+\.[cm]?[jt]sx?$/.test(value)) throw new Error("Invalid source file");
    return value;
  };
  const root = object(input);
  if (root.version !== 1) throw new Error("Invalid safe version");
  return { version: 1, status: choice(root.status, ["passed", "failed", "timedout", "interrupted"]),
    suppressedOutputBytes: integer(root.suppressedOutputBytes), globalErrors: array(root.globalErrors).map(v => choice(v, categories)),
    tests: array(root.tests).map(value => {
      const test = object(value);
      return { number: integer(test.number), file: sourceFile(test.file), line: integer(test.line), column: integer(test.column),
        outcome: choice(test.outcome, ["expected", "unexpected", "flaky", "skipped"]), attempts: array(test.attempts).map(value => {
          const attempt = object(value); const counts = object(attempt.activities);
          return { status: choice(attempt.status, statuses), expectedStatus: choice(attempt.expectedStatus, statuses),
            retry: integer(attempt.retry), durationMs: integer(attempt.durationMs),
            diagnostics: array(attempt.diagnostics).map(v => choice(v, categories)),
            failures: array(attempt.failures).map(value => { const failure = object(value); return {
              file: sourceFile(failure.file), line: integer(failure.line), column: integer(failure.column), category: choice(failure.category, activities) }; }),
            activities: Object.fromEntries(Object.entries(counts).map(([k, v]) => [choice(k, activities), integer(v)])) };
        }) };
    }) };
}
export function counts(report: SafeReport) {
  const attempts = report.tests.flatMap(test => test.attempts);
  return { tests: report.tests.length, attempts: attempts.length, retries: attempts.filter(a => a.retry > 0).length,
    passed: attempts.filter(a => a.status === "passed").length, failed: attempts.filter(a => a.status === "failed").length,
    skipped: report.tests.filter(t => t.outcome === "skipped").length,
    timedOut: attempts.filter(a => a.status === "timedOut").length, interrupted: attempts.filter(a => a.status === "interrupted").length,
    unexpected: report.tests.filter(t => t.outcome === "unexpected").length, flaky: report.tests.filter(t => t.outcome === "flaky").length };
}
export function textReport(report: SafeReport, github = false): string {
  const lines = [`Secret-safe browser run: ${report.status}`, JSON.stringify(counts(report))];
  for (const test of report.tests) for (const attempt of test.attempts) {
    const text = `Test #${test.number}: ${attempt.status}; expected=${attempt.expectedStatus}; retry=${attempt.retry}; diagnostics=${attempt.diagnostics.join(",") || "none"}; actions=${JSON.stringify(attempt.activities)}`;
    lines.push(`${test.file}:${test.line}:${test.column} ${text}`);
    for (const failure of attempt.failures) lines.push(`  ${failure.file}:${failure.line}:${failure.column} Failed ${failure.category}`);
    const location = attempt.failures.at(-1) ?? test;
    if (github && test.outcome === "unexpected") lines.push(`::error file=${location.file},line=${location.line},col=${location.column}::${text}`);
  }
  for (const error of report.globalErrors) lines.push(`Run diagnostic: ${error}`);
  return lines.join("\n") + "\n";
}
export function htmlReport(report: SafeReport): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Secret-safe browser report</title><body><h1>Browser acceptance: ${report.status}</h1><p>Values, titles, output, source excerpts and attachments are deliberately omitted. Source locations and result categories remain.</p><pre>${escape(textReport(report))}</pre></body></html>`;
}
