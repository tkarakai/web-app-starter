import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { matchesGlob } from "node:path";
import { runInNewContext } from "node:vm";
import { waitForPage } from "../http-ready.ts";
import { auditResult } from "../dependency-audit.ts";
import { CHECKOUT_CHECKS, PLATFORM_CHECKS, UPGRADE_CHECKS, checksFor, runChecks } from "../ci-checks.ts";

test("HTTP readiness retries compilation failures, follows redirects and rejects permanent failure", async t => {
  let status = 500, calls = 0, recoveryCalls = 0, recover = false;
  const server = createServer((req, res) => { calls++; if (recover && req.url === "/page" && ++recoveryCalls === 3) status = 200; if (req.url === "/redirect") { res.writeHead(307, { location: "/page" }); } else res.writeHead(status); res.end("page"); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => server.close());
  const address = server.address(); assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  await assert.rejects(waitForPage(url, 2000), /HTTP 500/);
  recover = true;
  await waitForPage(url + "/redirect", 5000); assert.ok(calls >= 3); assert.equal(recoveryCalls, 3);
  recover = false; status = 404; await assert.rejects(waitForPage(url, 2000), /HTTP 404/);
});

test("shared impact policy selects consumers/backend, new packages and CI changes; docs remain unaffected", () => {
  const policy = JSON.parse(readFileSync(new URL("../../../.github/platform-impact.json", import.meta.url), "utf8")) as Record<string, string[]>;
  const matches = (key: string, file: string) => [...policy[key], ...policy.root].some(pattern => matchesGlob(file, pattern));
  for (const file of ["packages/onboarding/styles.css", "packages/messages/hu.json", "packages/future/index.ts", "platform/packages/convex-platform/src/component/waitlist.ts", "platform/packages/i18n/src/config.ts", ".github/workflows/platform-ci-web.yml", "bun.lock"]) {
    for (const consumer of ["web", "admin", "landing", "storybook", "backend"]) assert.equal(matches(consumer, file), true, `${consumer}: ${file}`);
  }
  assert.equal(matches("web", "apps/web/src/app/page.tsx"), true);
  assert.equal(matches("landing", "apps/web/src/app/page.tsx"), false);
  assert.equal(matches("web", "docs/example.md"), false);
});

test("every ordinary workflow runner has an explicit local-only route", () => {
  const directory = new URL("../../../.github/workflows/", import.meta.url);
  const github = { workflow: "CI Web", event_name: "pull_request", sha: "a".repeat(40), run_id: 123, run_attempt: 1 };
  const inputs = { git_sha: "", worker_pool: "" };
  const needs = { check: { outputs: { head: github.sha } } };
  const format = (template: string, ...values: unknown[]) => template.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)]));
  const runner = (expression: string, vars: Record<string, string>, event_name = github.event_name): string[] => {
    const values = new Proxy(vars, { get: (current, name: string) => current[name] ?? "" });
    const value = runInNewContext(expression, { vars: values, github: { ...github, event_name }, inputs, needs,
      format, fromJSON: JSON.parse, startsWith: (value: string, prefix: string) => value.startsWith(prefix) }) as string | string[];
    return Array.isArray(value) ? value : [value];
  };
  const localRoutes: Record<string, string>[] = [
    { PLATFORM_CI_LOCAL_ONLY: "true" },
    { PLATFORM_CI_WORKER_POOL: "starter-pool" },
    { PLATFORM_CI_AUX_RUNNER: "starter-ci" },
    { PLATFORM_CI_RUNNER: "starter-ci" },
    { PLATFORM_UPDATE_RUNNER: "starter-update" },
    { PLATFORM_UPDATE_DELIVERY_RUNNER: "starter-update-deliver" },
  ];
  for (const file of readdirSync(directory).filter(name => name.endsWith(".yml"))) {
    const lines = readFileSync(new URL(file, directory), "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (!/^\s+runs-on:/.test(line)) continue;
      if (file === "platform-update-workers-check.yml") continue;
      if (file === "ci-verify.yml" && line.includes("inputs.worker_pool")) {
        assert.match(line, /starter-source-\{1\}/);
        assert.match(line, /starter-run-\{2\}/);
        continue;
      }
      const expression = line.match(/runs-on: \$\{\{ (.*) \}\}/)?.[1];
      assert(expression, `${file}:${index + 1} has no evaluated selector`);
      assert.deepEqual(runner(expression, {}), ["ubuntu-latest"], `${file}:${index + 1} should default to hosted`);
      for (const vars of localRoutes) {
        assert(!runner(expression, vars).includes("ubuntu-latest"), `${file}:${index + 1} uses hosted with ${Object.keys(vars)[0]}`);
      }
      if (line.includes("starter-run-")) {
        assert.match(line, /starter-source-\{1\}/, `${file}:${index + 1} lacks source binding`);
        assert.match(line, /starter-run-\{2\}/, `${file}:${index + 1} lacks run binding`);
      }
      if (file === "platform-security.yml") {
        assert.match(line, /github\.event_name != 'schedule'/);
        assert(!runner(expression, { PLATFORM_CI_WORKER_POOL: "starter-pool" }, "schedule").includes("ubuntu-latest"));
      }
    }
  }
});

test("audit enforces severity independently of Bun's any-finding exit and rejects errors", () => {
  const report = (severity: string) => JSON.stringify({ pkg: [{ title: "fixture advisory", severity, url: "https://example.test/advisory" }] });
  assert.deepEqual(auditResult("{}", 0), { high: 0, lower: 0 });
  assert.deepEqual(auditResult(report("low"), 1), { high: 0, lower: 1 });
  assert.deepEqual(auditResult(report("moderate"), 1), { high: 0, lower: 1 });
  for (const severity of ["high", "critical"]) assert.equal(auditResult(report(severity), 1).high, 1);
  for (const [output, status] of [["{}", 1], ["{}", 127], ["network error", 1], ['{"error":"unavailable"}', 0], [report("unknown"), 1], [report("high"), 0]] as const) assert.throws(() => auditResult(output, status));
});

test("CI inventory executes every selected stage and propagates each stage failure", () => {
  for (const profile of ["checkout", "platform", "contracts", "online"]) {
    const checks = checksFor(profile, process.cwd()), recorded: string[] = [];
    runChecks(profile, process.cwd(), script => { recorded.push(script); return 0; });
    assert.deepEqual(recorded, checks);
    for (const failing of checks) {
      const calls: string[] = [];
      assert.throws(() => runChecks(profile, process.cwd(), script => { calls.push(script); return script === failing ? 7 : 0; }), new RegExp(failing));
      assert.equal(calls.at(-1), failing);
    }
  }
  for (const required of [...CHECKOUT_CHECKS, ...PLATFORM_CHECKS, "test:contracts"]) assert.ok((UPGRADE_CHECKS as readonly string[]).includes(required));
  assert.ok(PLATFORM_CHECKS.includes("test:auth-ui")); assert.ok(PLATFORM_CHECKS.includes("test:ops"));
  assert.throws(() => checksFor("typo", process.cwd()), /Unknown/);
});

test("audit CLI fails on findings and scanner failures, while allowing only the documented lower severities", async t => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "audit-cli-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "bin")); writeFileSync(join(root, "bun.lock"), "fixture");
  for (const [output, status, expected] of [["{}", 0, 0], [JSON.stringify({ pkg: [{ severity: "low", title: "fixture", url: "https://example.test/advisory" }] }), 1, 0], [JSON.stringify({ pkg: [{ severity: "high", title: "fixture", url: "https://example.test/advisory" }] }), 1, 1], ["{}", 127, 1], ["network unavailable", 1, 1]] as const) {
    writeFileSync(join(root, "bin/bun"), `#!/bin/sh\nprintf '%s' '${output}'\nexit ${status}\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [new URL("../dependency-audit.ts", import.meta.url).pathname], { cwd: root, env: { ...process.env, PATH: join(root, "bin") }, encoding: "utf8" });
    assert.equal(result.status, expected, result.stderr);
  }
  rmSync(join(root, "bun.lock"));
  assert.notEqual(spawnSync(process.execPath, [new URL("../dependency-audit.ts", import.meta.url).pathname], { cwd: root }).status, 0);
});

test("all affected workflow consumers use the shared impact policy", async () => {
  const { execFileSync } = await import("node:child_process");
  for (const name of ["ci-web", "ci-admin", "ci-landing", "ci-storybook", "ci-shared", "cd-staging"]) {
    const file = new URL(`../../../.github/workflows/platform-${name}.yml`, import.meta.url).pathname;
    const workflow = JSON.parse(execFileSync("bun", ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))", file], { encoding: "utf8" })) as { jobs: Record<string, { steps?: { id?: string; with?: { filters?: string } }[] }> };
    const filters = Object.values(workflow.jobs).flatMap(job => job.steps ?? []).filter(step => step.id === "filter");
    assert.equal(filters.length, 1, name);
    assert.equal(filters[0].with?.filters, ".github/platform-impact.json", name);
  }
});

test("Security Complete rejects failed, cancelled and unexpected skipped scans", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const file = new URL("../../../.github/workflows/platform-security.yml", import.meta.url).pathname;
  const workflow = JSON.parse(execFileSync("bun", ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))", file], { encoding: "utf8" })) as { jobs: Record<string, { needs?: string[]; if?: string; steps: { run?: string }[] }> };
  const gate = workflow.jobs.complete;
  assert.equal(gate.if, "always()");
  assert.deepEqual(new Set(gate.needs), new Set(["paid-features", "codeql", "dependency-audit", "secrets-scan", "dependency-review"]));
  const run = gate.steps[0].run!;
  for (const paid of [true, false]) for (const event of ["pull_request", "push"]) {
    const results: Record<string, { result: string; outputs?: { code_security: string } }> = {
      "paid-features": { result: "success", outputs: { code_security: String(paid) } },
      "codeql": { result: paid ? "success" : "skipped" },
      "dependency-audit": { result: "success" }, "secrets-scan": { result: "success" },
      "dependency-review": { result: paid && event === "pull_request" ? "success" : "skipped" },
    };
    const execute = () => spawnSync("bash", ["-e", "-c", run], { env: { ...process.env, RESULTS: JSON.stringify(results), EVENT_NAME: event }, stdio: "ignore" }).status;
    assert.equal(execute(), 0);
    results["paid-features"].outputs!.code_security = "";
    assert.notEqual(execute(), 0, "missing capability decision");
    results["paid-features"].outputs!.code_security = String(paid);
    for (const name of gate.needs!) {
      const original = results[name].result;
      for (const failure of ["failure", "cancelled", ...(original === "success" ? ["skipped"] : [])]) {
        results[name].result = failure;
        assert.notEqual(execute(), 0, `${paid}/${event}/${name}/${failure}`);
      }
      results[name].result = original;
    }
  }
});
