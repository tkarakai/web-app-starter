import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FullConfig, FullResult, Suite, TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import SecretSafeReporter from "../e2e/secret-safe-reporter.ts";
import { activity, counts, htmlReport, textReport, validateReport } from "../e2e/secret-safe-report.ts";
import { runSecretSafePlaywright, safeArguments } from "../e2e/secret-safe-playwright.ts";
import { assertSecretSafeRunner } from "../e2e/secret-safe-config.ts";

test("reporter retains failed assertions, retries and skipped status without serializing values", async () => {
  const marker = ["synthetic", "password", "totp", "recovery", "token"].join("_");
  const dir = mkdtempSync(join(tmpdir(), "safe-reporter-unit-"));
  const previous = { runner: process.env.E2E_SAFE_RUNNER, result: process.env.E2E_SAFE_RESULT_FILE };
  process.env.E2E_SAFE_RUNNER = "1"; process.env.E2E_SAFE_RESULT_FILE = join(dir, "result.json");
  try {
    const failed = { status: "failed", retry: 1, duration: 5, errors: [{ message: `expect(secret).toBe(${marker})`, stack: marker, snippet: marker, cause: { message: marker } }],
      attachments: [{ name: marker, path: marker, body: Buffer.from(marker) }], stdout: [marker], stderr: [marker], steps: [{ title: marker, params: { value: marker } }] } as unknown as TestResult;
    const skipped = { status: "skipped", retry: 0, duration: 0, errors: [] } as unknown as TestResult;
    const item = (results: TestResult[], outcome: string) => ({ title: marker, titlePath: () => [marker], annotations: [{ type: marker, description: marker }],
      location: { file: "/tests/security.spec.ts", line: 12, column: 3 }, expectedStatus: "passed", results, outcome: () => outcome }) as unknown as TestCase;
    const first = item([failed], "unexpected"); const second = item([skipped], "skipped");
    const reporter = new SecretSafeReporter();
    reporter.onBegin({ rootDir: "/tests", projects: [{ use: { trace: "off", screenshot: "off", video: "off" } }] } as FullConfig,
      { allTests: () => [first, second] } as Suite);
    reporter.onStdOut(marker); reporter.onStdErr(Buffer.from(marker));
    reporter.onTestBegin(first, failed);
    reporter.onStepEnd(first, failed, { category: "pw:api", title: `Fill ${marker}`, params: { value: marker } } as unknown as TestStep);
    reporter.onStepEnd(first, failed, { category: "expect", title: marker, error: { message: marker }, location: { file: "/tests/security.spec.ts", line: 44, column: 7 } } as TestStep);
    reporter.onStepEnd(first, failed, { category: "test.step", title: "org-context-absent" } as TestStep);
    reporter.onStepEnd(first, failed, { category: "test.step", title: `org-context-absent:${marker}` } as TestStep);
    reporter.onTestEnd(first, failed); reporter.onTestEnd(second, skipped);
    reporter.onError({ message: `Navigation failed https://example.invalid/?token=${marker}`, snippet: marker });
    await reporter.onEnd({ status: "failed" } as FullResult);
    const report = validateReport(JSON.parse(readFileSync(process.env.E2E_SAFE_RESULT_FILE, "utf8")));
    for (const output of [JSON.stringify(report), htmlReport(report), textReport(report), textReport(report, true)]) assert.ok(!output.includes(marker));
    assert.equal(report.status, "failed"); assert.equal(report.tests[0].line, 12);
    assert.equal(report.tests[0].attempts[0].diagnostics[0], "assertion");
    assert.equal(report.tests[0].attempts[0].activities.fill, 1);
    assert.equal(report.tests[0].attempts[0].activities.assertion, 1);
    assert.equal(report.tests[0].attempts[0].activities["org-context-absent"], 1);
    assert.equal(report.tests[0].attempts[0].activities.step, 1);
    assert.deepEqual(counts(report), { tests: 2, attempts: 2, retries: 1, passed: 0, failed: 1, skipped: 1, timedOut: 0, interrupted: 0, unexpected: 1, flaky: 0 });
    assert.match(textReport(report, true), /::error file=security.spec.ts,line=44,col=7::/);
    assert.deepEqual(report.tests[0].attempts[0].failures, [{ file: "security.spec.ts", line: 44, column: 7, category: "assertion" }]);
  } finally {
    if (previous.runner === undefined) delete process.env.E2E_SAFE_RUNNER; else process.env.E2E_SAFE_RUNNER = previous.runner;
    if (previous.result === undefined) delete process.env.E2E_SAFE_RESULT_FILE; else process.env.E2E_SAFE_RESULT_FILE = previous.result;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("organization observations accept exact closed titles, never prefixed private data", () => {
  assert.equal(activity("test.step", "org-url-expected"), "org-url-expected");
  for (const title of ["org-url-expected:secret", "org-url-expected\nsecret", "org-secret-token", "org-url-expected "]) {
    assert.equal(activity("test.step", title), "step");
  }
  assert.equal(activity("pw:api", "org-url-expected"), "api");
});

test("safe report validator rejects invalid categories and reconstructs unknown fields away", () => {
  const base = { version: 1, status: "failed", tests: [], globalErrors: ["runtime"], suppressedOutputBytes: 0 };
  assert.deepEqual(validateReport({ ...base, message: "credential" }), base);
  assert.throws(() => validateReport({ ...base, status: "credential" }));
  assert.throws(() => validateReport({ ...base, globalErrors: ["credential"] }));
  assert.throws(() => validateReport({ ...base, suppressedOutputBytes: -1 }));
  assert.throws(() => validateReport(null));
});

test("CLI reporter selection cannot opt into raw built-ins or capture overrides", () => {
  assert.deepEqual(safeArguments(["--reporter=list,json", "security.spec.ts", "--workers=1"]), { args: ["security.spec.ts", "--workers=1"], formats: new Set(["list", "json"]) });
  assert.deepEqual(safeArguments(["--reporter", "github,html"]).formats, new Set(["github", "html"]));
  for (const value of ["--reporter=blob", "--reporter=./raw.ts", "--add-reporter=html", "--add-reporter", "--", "--ui", "--ui-port=3333", "--debug", "--trace=on", "--output=/tmp/raw", "--list", "--reporter"]) assert.throws(() => safeArguments([value]));
});

test("config guard admits discovery and wrapped worker reload but rejects direct execution", () => {
  const argv = process.argv;
  const names = ["E2E_SAFE_RUNNER", "E2E_SAFE_RESULT_FILE", "E2E_SAFE_REPORTER_PATH", "TEST_WORKER_INDEX"];
  const saved = names.map(name => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    process.argv = ["node", "playwright", "test", "--reporter=list"];
    assert.throws(() => assertSecretSafeRunner());
    process.argv.push("--list"); assert.doesNotThrow(() => assertSecretSafeRunner());
    process.argv = ["node", "worker"];
    process.env.E2E_SAFE_RUNNER = "1"; process.env.E2E_SAFE_RESULT_FILE = "/private/result";
    process.env.E2E_SAFE_REPORTER_PATH = "/source/reporter.ts";
    assert.throws(() => assertSecretSafeRunner());
    process.env.TEST_WORKER_INDEX = "0"; assert.doesNotThrow(() => assertSecretSafeRunner());
    delete process.env.TEST_WORKER_INDEX;
    process.argv.push("--reporter=/source/reporter.ts"); assert.doesNotThrow(() => assertSecretSafeRunner());
  } finally {
    process.argv = argv;
    names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
  }
});

test("runner refuses symlink report targets without overwriting their referent", async () => {
  const root = mkdtempSync(join(tmpdir(), "safe-report-links-"));
  const previous = process.env.E2E_SAFE_REPORT_DIR;
  try {
    const victim = join(root, "existing.txt"); writeFileSync(victim, "keep existing data");
    const output = join(root, "report"); mkdirSync(output);
    symlinkSync(victim, join(output, "report.json")); process.env.E2E_SAFE_REPORT_DIR = output;
    assert.equal(await runSecretSafePlaywright(["--help"]), 2);
    assert.equal(readFileSync(victim, "utf8"), "keep existing data");
    const alias = join(root, "alias"); symlinkSync(output, alias); process.env.E2E_SAFE_REPORT_DIR = alias;
    assert.equal(await runSecretSafePlaywright(["--help"]), 2);
    assert.equal(readFileSync(victim, "utf8"), "keep existing data");
  } finally {
    if (previous === undefined) delete process.env.E2E_SAFE_REPORT_DIR; else process.env.E2E_SAFE_REPORT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
