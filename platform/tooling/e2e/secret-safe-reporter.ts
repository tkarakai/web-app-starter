import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult, TestStep } from "@playwright/test/reporter";
import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { activity, diagnostic, validateReport, type Activity, type Diagnostic, type SafeAttempt, type SafeReport } from "./secret-safe-report.ts";

/** Supported Reporter API only; no mutation of tests, errors or runner internals. */
export default class SecretSafeReporter implements Reporter {
  private config?: FullConfig;
  private suite?: Suite;
  private errors: Diagnostic[] = [];
  private outputBytes = 0;
  private unsafeCapture = false;
  private attempts = new Map<TestResult, SafeAttempt>();
  printsToStdio() { return true; }
  onBegin(config: FullConfig, suite: Suite) {
    this.config = config; this.suite = suite;
    const off = (value: unknown) => value === undefined || value === "off" || value === false ||
      (typeof value === "object" && value !== null && "mode" in value && value.mode === "off");
    this.unsafeCapture = config.projects.some(project => !off(project.use.trace) || !off(project.use.screenshot) || !off(project.use.video));
    if (this.unsafeCapture) this.errors.push("capture-policy");
  }
  onError(error: TestError) { this.errors.push(diagnostic(error.message)); }
  onStdOut(chunk: string | Buffer) { this.outputBytes += Buffer.byteLength(chunk); }
  onStdErr(chunk: string | Buffer) { this.outputBytes += Buffer.byteLength(chunk); }
  onTestBegin(_test: TestCase, result: TestResult) {
    this.attempts.set(result, { status: "skipped", expectedStatus: "passed", retry: result.retry, durationMs: 0, diagnostics: [], activities: {}, failures: [] });
  }
  onStepEnd(_test: TestCase, result: TestResult, step: TestStep) {
    const attempt = this.attempts.get(result); if (!attempt) return;
    const kind: Activity = activity(step.category, step.title);
    attempt.activities[kind] = (attempt.activities[kind] ?? 0) + 1;
    if (step.error && step.location) attempt.failures.push({
      file: relative(this.config?.rootDir ?? process.cwd(), resolve(step.location.file)).replaceAll("\\", "/"),
      line: step.location.line, column: step.location.column, category: kind,
    });
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const previous = this.attempts.get(result);
    this.attempts.set(result, { status: result.status, expectedStatus: test.expectedStatus, retry: result.retry,
      durationMs: Math.max(0, Math.round(result.duration)), diagnostics: result.errors.map(error => diagnostic(error.message)), activities: previous?.activities ?? {}, failures: previous?.failures ?? [] });
  }
  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] }> {
    const file = process.env.E2E_SAFE_RESULT_FILE;
    if (process.env.E2E_SAFE_RUNNER !== "1" || !file) return { status: "failed" };
    const report: SafeReport = { version: 1, status: this.unsafeCapture ? "failed" : result.status,
      globalErrors: this.errors, suppressedOutputBytes: this.outputBytes,
      tests: (this.suite?.allTests() ?? []).map((test, index) => ({ number: index + 1,
        file: relative(this.config?.rootDir ?? process.cwd(), resolve(test.location.file)).replaceAll("\\", "/"),
        line: test.location.line, column: test.location.column, outcome: test.outcome(),
        attempts: test.results.map(value => this.attempts.get(value) ?? { status: value.status, expectedStatus: test.expectedStatus,
          retry: value.retry, durationMs: Math.max(0, Math.round(value.duration)), diagnostics: value.errors.map(error => diagnostic(error.message)), activities: {}, failures: [] }) })) };
    // Invalid metadata fails the run instead of publishing an unchecked string.
    try { writeFileSync(file, JSON.stringify(validateReport(report)), { mode: 0o600 }); }
    catch { return { status: "failed" }; }
    return this.unsafeCapture ? { status: "failed" } : {};
  }
}
