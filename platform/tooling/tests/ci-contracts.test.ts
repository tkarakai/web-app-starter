import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { matchesGlob } from "node:path";
import { waitForPage } from "../http-ready.ts";
import { assessAdvisoryRace, runRaceCheck } from "../advisory-race.ts";
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

test("newly recognized alerts block once their fix is older than the security cooldown", () => {
  const alert = (created_at: string, fixed = "1.2.2") => {
    const vulnerability = { package: { ecosystem: "npm", name: "source-map-js" }, first_patched_version: { identifier: fixed }, vulnerable_version_range: ">= 1.0.0, < 1.2.2" };
    return {
      number: 315, created_at, dependency: { package: vulnerability.package, manifest_path: "bun.lock" },
      security_advisory: { ghsa_id: "GHSA-fixture", severity: "high", summary: "fixture", vulnerabilities: [vulnerability] },
    };
  };
  const times = { "source-map-js": { "1.2.2": "2026-09-30T14:08:00Z", "1.2.3": "2026-10-06T00:00:00Z" } };
  const packages = { "source-map-js": ["source-map-js@1.2.1"] };
  const race = assessAdvisoryRace([alert("2026-10-05T23:31:00Z")], times, "2026-10-05T22:13:53Z", "2026-10-06T01:24:00Z", packages);
  assert.equal(race.actionable.length, 1);
  assert.equal(race.actionable[0].recognizedAfterRenovate, true);
  assert.equal(race.actionable[0].fixedPublishedAt, "2026-09-30T14:08:00Z");
  const cooling = assessAdvisoryRace([alert("2026-10-06T00:10:00Z", "1.2.3")], times, "2026-10-05T22:13:53Z", "2026-10-06T01:24:00Z", packages);
  assert.equal(cooling.actionable.length, 0); assert.equal(cooling.coolingDown.length, 1);
  const candidates: Record<string, string[]>[] = [{}, { alias: ["source-map-js@1.2.2"] }, { nested: ["source-map-js@1.2.3"] }];
  for (const candidate of candidates) {
    const repaired = assessAdvisoryRace([alert("2026-10-05T23:31:00Z")], {}, undefined, "2026-10-06T01:24:00Z", candidate);
    assert.deepEqual(repaired, { actionable: [], coolingDown: [], noFixedRelease: [] });
  }
  const mixed = assessAdvisoryRace([alert("2026-10-05T23:31:00Z")], times, undefined, "2026-10-06T01:24:00Z", { alias: ["source-map-js@1.2.2"], "parent/source-map-js": ["source-map-js@1.2.1"] });
  assert.equal(mixed.actionable.length, 1);
  assert.equal(mixed.actionable[0].recognizedAfterRenovate, false);
  const boundary = assessAdvisoryRace([alert("2026-10-06T00:10:00Z", "1.2.3")], times, undefined, "2026-10-06T12:00:00Z", packages);
  assert.equal(boundary.actionable.length, 1);
  const base = alert("2026-10-05T23:31:00Z");
  const unpatchedVulnerability = { ...base.security_advisory.vulnerabilities[0], first_patched_version: null };
  const unpatched = { ...base, security_advisory: { ...base.security_advisory, vulnerabilities: [unpatchedVulnerability] } };
  assert.equal(assessAdvisoryRace([unpatched], {}, undefined, "2026-10-06T01:24:00Z", packages).noFixedRelease.length, 1);
  assert.equal(assessAdvisoryRace([unpatched], {}, undefined, "2026-10-06T01:24:00Z", candidates[1]).noFixedRelease.length, 0);
  const currentLine = { package: base.dependency.package, vulnerable_version_range: ">= 1.0.0-canary.0, < 1.0.6", first_patched_version: { identifier: "1.0.6" } };
  const nextLine = { package: base.dependency.package, vulnerable_version_range: ">= 2.0.0-canary.0, < 2.0.2", first_patched_version: { identifier: "2.0.2" } };
  const multiLine = { ...base, security_advisory: { ...base.security_advisory, vulnerabilities: [currentLine, nextLine] } };
  const multiTimes = { "source-map-js": { "2.0.2": "2026-09-30T14:08:00Z" } };
  assert.equal(assessAdvisoryRace([multiLine], multiTimes, undefined, "2026-10-06T01:24:00Z", { next: ["source-map-js@2.0.1-canary.1"] }).actionable[0].fixed, "2.0.2");
  assert.equal(assessAdvisoryRace([multiLine], {}, undefined, "2026-10-06T01:24:00Z", { repaired: ["source-map-js@2.0.2"] }).actionable.length, 0);
  for (const range of [">= 1.0.0 || < 1.2.2", ">= 1.0.0 < 1.2.2"]) {
    const unsupported = { ...base, security_advisory: { ...base.security_advisory, vulnerabilities: [{ ...base.security_advisory.vulnerabilities[0], vulnerable_version_range: range }] } };
    assert.throws(() => assessAdvisoryRace([unsupported], times, undefined, "2026-10-06T01:24:00Z", packages), /Unsupported GitHub advisory range/);
  }
  const empty = { ...base, security_advisory: { ...base.security_advisory, vulnerabilities: [] } };
  assert.deepEqual(assessAdvisoryRace([empty], {}, undefined, "2026-10-06T01:24:00Z", packages), { actionable: [], coolingDown: [], noFixedRelease: [] });
});

test("advisory gate retains alerts without Renovate metadata and permits repaired candidates", async t => {
  const previous = process.cwd();
  const root = mkdtempSync(`${previous}/.advisory-race-test-`);
  process.chdir(root);
  t.after(() => { process.chdir(previous); rmSync(root, { recursive: true, force: true }); });
  const vulnerability = { package: { ecosystem: "npm", name: "source-map-js" }, first_patched_version: { identifier: "1.2.2" }, vulnerable_version_range: ">= 1.0.0, < 1.2.2" };
  const alert = {
    number: 315, created_at: "2026-10-05T23:31:00Z", dependency: { package: vulnerability.package, manifest_path: "bun.lock" },
    security_advisory: { ghsa_id: "GHSA-fixture", severity: "high", summary: "fixture", vulnerabilities: [vulnerability] },
  };
  const requests: string[] = [];
  let runStatus = 502;
  let alertsStatus = 200;
  const warnings: string[] = [];
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(url);
    if (url.includes("dependabot/alerts")) return new Response(JSON.stringify([alert, { ...alert, dependency: { ...alert.dependency, package: { ecosystem: "pip", name: "irrelevant" } } }, { ...alert, dependency: { ...alert.dependency, package: { ecosystem: "npm", name: "low-severity" } }, security_advisory: { ...alert.security_advisory, severity: "low" } }]), { status: alertsStatus, headers: { date: "2026-10-06T01:24:00Z" } });
    if (url.includes("actions/workflows")) return new Response(JSON.stringify({ workflow_runs: [{ updated_at: "2026-10-05T22:13:53Z", conclusion: "success" }] }), { status: runStatus });
    assert.equal(url, "https://registry.npmjs.org/source-map-js");
    return new Response(JSON.stringify({ time: { "1.2.2": "2026-09-30T14:08:00Z" } }));
  });
  const candidate = (version: string) => writeFileSync("bun.lock", JSON.stringify({ lockfileVersion: 1, workspaces: {}, packages: { alias: [`source-map-js@${version}`, "", {}, "sha512-YQ=="], irrelevant: ["irrelevant@1.0.0", "", {}, "sha512-YQ=="], low: ["low-severity@1.0.0", "", {}, "sha512-YQ=="] } }));
  const env = { GITHUB_REPOSITORY: "owner/repository", GITHUB_TOKEN: "fixture" };
  candidate("1.2.1");
  await assert.rejects(runRaceCheck(env), /Actionable high\/critical/);
  assert(warnings.some(message => message.includes("Renovate completion evidence unavailable")));
  assert.equal(requests.filter(url => new URL(url).hostname === "registry.npmjs.org").length, 1);
  runStatus = 200;
  await assert.rejects(runRaceCheck(env), /Actionable high\/critical/);
  candidate("1.2.2"); requests.length = 0;
  await runRaceCheck(env);
  assert(!requests.some(url => new URL(url).hostname === "registry.npmjs.org"));
  alertsStatus = 403; requests.length = 0;
  await runRaceCheck(env);
  assert.equal(requests.length, 1);
  assert(warnings.some(message => message.includes("Supplemental GitHub advisory evidence unavailable")));
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
  const workflow = JSON.parse(execFileSync("bun", ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))", file], { encoding: "utf8" })) as { permissions: Record<string, string>; jobs: Record<string, { needs?: string[]; if?: string; steps: { run?: string }[] }> };
  const callerFile = new URL("../../../.github/workflows/security.yml", import.meta.url).pathname;
  const caller = JSON.parse(execFileSync("bun", ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))", callerFile], { encoding: "utf8" })) as { permissions: Record<string, string>; jobs: { platform: { uses: string } } };
  assert.equal(caller.jobs.platform.uses, "./.github/workflows/platform-security.yml");
  for (const permissions of [caller.permissions, workflow.permissions]) {
    assert.equal(permissions["vulnerability-alerts"], "read");
    assert.equal(permissions.actions, "read");
  }
  const audit = workflow.jobs["dependency-audit"];
  assert(audit.steps.some(step => step.run === "bun run check:advisory-race"), "dependency audit must execute the independent GitHub alert gate");
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
