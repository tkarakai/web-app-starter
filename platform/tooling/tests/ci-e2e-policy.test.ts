import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../ci-e2e-policy.sh", import.meta.url));

function run(command: string, environment: Record<string, string>, directory: string) {
  const output = path.join(directory, "output");
  fs.writeFileSync(output, "");
  const clean: Record<string, string | undefined> = { ...process.env, GITHUB_OUTPUT: output };
  for (const name of ["PR_E2E", "SKIP_E2E", "REQUIRE_E2E", "EVENT_NAME", "DRAFT", "REPO_PRIVATE"]) delete clean[name];
  const result = spawnSync("bash", [script, command], { env: { ...clean, ...environment }, encoding: "utf8" });
  return { ...result, output: fs.readFileSync(output, "utf8") };
}

test("resolve maps the mode, drafts, forced runs and the deprecated SKIP_E2E", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const pr = { EVENT_NAME: "pull_request", DRAFT: "false" };
  for (const [environment, expected] of [
    [pr, "run"],
    [{ ...pr, PR_E2E: "always" }, "run"],
    [{ ...pr, PR_E2E: "on-demand" }, "on-demand"],
    [{ ...pr, PR_E2E: "off" }, "skip"],
    [{ ...pr, DRAFT: "true" }, "skip"],
    [{ ...pr, DRAFT: "true", PR_E2E: "on-demand" }, "skip"],
    [{ ...pr, SKIP_E2E: "false" }, "run"],
    [{ ...pr, SKIP_E2E: "true", PR_E2E: "on-demand" }, "on-demand"],
    [{ ...pr, PR_E2E: "off", REQUIRE_E2E: "true" }, "run"],
    [{ EVENT_NAME: "push", PR_E2E: "off" }, "run"],
    [{ EVENT_NAME: "workflow_dispatch", PR_E2E: "nonsense" }, "run"],
  ] as const) {
    const result = run("resolve", environment, directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.output, `e2e=${expected}\n`, JSON.stringify(environment));
    assert.doesNotMatch(result.stdout, /deprecated/);
  }

  const legacy = run("resolve", { ...pr, SKIP_E2E: "true" }, directory);
  assert.equal(legacy.output, "e2e=skip\n");
  assert.match(legacy.stdout, /::warning title=SKIP_E2E is deprecated::.*PLATFORM_CI_PR_E2E=off/);

  const invalid = run("resolve", { ...pr, PR_E2E: "sometimes" }, directory);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.output, "");
  assert.match(invalid.stdout, /::error title=Invalid PLATFORM_CI_PR_E2E::'sometimes'/);
});

test("resolve notices a private repository that hasn't chosen a mode", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const pr = { EVENT_NAME: "pull_request", DRAFT: "false" };
  const notice = /::notice title=E2E runs on every push to a ready PR::.*PLATFORM_CI_PR_E2E/;
  assert.match(run("resolve", { ...pr, REPO_PRIVATE: "true" }, directory).stdout, notice);
  const quiet: Record<string, string>[] = [
    { ...pr, REPO_PRIVATE: "false" },
    { ...pr },
    { ...pr, REPO_PRIVATE: "true", PR_E2E: "always" },
    { ...pr, REPO_PRIVATE: "true", SKIP_E2E: "true" },
    { EVENT_NAME: "push", REPO_PRIVATE: "true" },
  ];
  for (const environment of quiet) assert.doesNotMatch(run("resolve", environment, directory).stdout, notice, JSON.stringify(environment));
});

test("label reads the pull request's labels live and fails without run-e2e", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  // curl stub: records its arguments and prints $LABELS_JSON.
  fs.writeFileSync(path.join(bin, "curl"), '#!/bin/bash\nprintf "%s\\n" "$@" > "$CURL_ARGS"\nprintf "%s" "$LABELS_JSON"\n', { mode: 0o755 });
  const environment = {
    PATH: bin + path.delimiter + process.env.PATH,
    CURL_ARGS: path.join(directory, "args"),
    GITHUB_TOKEN: "token",
    GITHUB_API_URL: "https://api.example.test",
    GITHUB_REPOSITORY: "owner/repo",
    PR_NUMBER: "42",
  };

  const labelled = run("label", { ...environment, LABELS_JSON: '[{"id":1,"name":"bug"},{"id":2,"name": "run-e2e"}]' }, directory);
  assert.equal(labelled.status, 0, labelled.stdout + labelled.stderr);
  assert.match(labelled.stdout, /E2E requested with the run-e2e label/);
  const args = fs.readFileSync(environment.CURL_ARGS, "utf8");
  assert.match(args, /https:\/\/api\.example\.test\/repos\/owner\/repo\/issues\/42\/labels\?per_page=100/);
  assert.match(args, /Authorization: Bearer token/);

  for (const labels of ["[]", '[{"name":"run-e2e-later"}]', '[{"name":"bug","description":"run-e2e"}]']) {
    const missing = run("label", { ...environment, LABELS_JSON: labels }, directory);
    assert.equal(missing.status, 1, labels);
    assert.match(missing.stdout, /::error title=E2E required before merge::.*'run-e2e' label/);
  }
});
