import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { parseEnv } from "node:util";
import { anonymousTarget, assertAnonymousLaunch, assertHostedEnvironment, provisionFixtures } from "../local-fixtures.ts";

test("hosted preflight rejects all fixture configuration and malformed output", () => {
  assert.doesNotThrow(() => assertHostedEnvironment("BETTER_AUTH_SECRET\nSITE_URL\n"));
  assert.doesNotThrow(() => assertHostedEnvironment(""));
  for (const key of ["DEV_SEED_ENABLED", "DEV_FIXTURE_RUNTIME", "DEV_FIXTURE_SECRET"]) assert.throws(() => assertHostedEnvironment(`SITE_URL\n${key}\n`), /local-only/);
  assert.throws(() => assertHostedEnvironment("could not contact deployment"), /refusing deployment/);
});

test("anonymous launcher rejects inherited and file-based cloud or self-hosted targets", () => {
  assert.doesNotThrow(() => assertAnonymousLaunch({}, {}));
  assert.doesNotThrow(() => assertAnonymousLaunch({}, { CONVEX_DEPLOYMENT: "anonymous:test" }));
  for (const override of [{ CONVEX_DEPLOY_KEY: "prod:key" }, { CONVEX_SELF_HOSTED_URL: "http://localhost:3210" }, { CONVEX_SELF_HOSTED_ADMIN_KEY: "key" }, { CONVEX_DEPLOYMENT: "prod:hosted" }, { CONVEX_DEPLOYMENT: "anonymous:../../escape" }]) {
    assert.throws(() => assertAnonymousLaunch(override, {}));
    assert.throws(() => assertAnonymousLaunch({}, override));
  }
});

test("provisioning binds to the named local runtime and its exact ports", () => {
  const env = { CONVEX_DEPLOYMENT: "anonymous:test", CONVEX_URL: "http://127.0.0.1:3210", CONVEX_SITE_URL: "http://127.0.0.1:3211" };
  const config = { deploymentName: "test", adminKey: "private-local-key", ports: { cloud: 3210, site: 3211 } };
  assert.deepEqual(anonymousTarget(env, config), { CONVEX_SELF_HOSTED_URL: env.CONVEX_URL, CONVEX_SELF_HOSTED_ADMIN_KEY: config.adminKey });
  assert.throws(() => anonymousTarget(env, { ...config, deploymentName: "another" }));
  assert.throws(() => anonymousTarget(env, { ...config, adminKey: "" }));
  for (const url of ["https://hosted.convex.cloud", "http://127.0.0.1:9999", "http://127.0.0.1:3210/path", "http://user@127.0.0.1:3210"]) assert.throws(() => anonymousTarget({ ...env, CONVEX_URL: url }, config));
});

test("fixture provisioning uses a private secret file and stdin, reuses only the same target, fails closed", t => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "local-fixture-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "fixture.env");
  const calls: { args: string[]; input?: string }[] = [];
  const command = (args: string[], input?: string) => { calls.push({ args, input }); return ""; };
  provisionFixtures(command, "anonymous", file, "http://127.0.0.1:3211");
  const original = parseEnv(fs.readFileSync(file, "utf8"));
  assert.match(original.DEV_FIXTURE_SECRET!, /^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(calls[0].args, ["env", "set", "--force"]);
  assert.equal(parseEnv(calls[0].input!).DEV_FIXTURE_SECRET, original.DEV_FIXTURE_SECRET);
  provisionFixtures(command, "anonymous", file, "http://127.0.0.1:3211");
  assert.equal(parseEnv(fs.readFileSync(file, "utf8")).DEV_FIXTURE_SECRET, original.DEV_FIXTURE_SECRET);
  provisionFixtures(command, "anonymous", file, "http://127.0.0.1:3213");
  const rotated = fs.readFileSync(file, "utf8");
  assert.notEqual(parseEnv(rotated).DEV_FIXTURE_SECRET, original.DEV_FIXTURE_SECRET);
  assert.throws(() => provisionFixtures(() => { throw new Error("backend unavailable"); }, "anonymous", file, "http://127.0.0.1:3215"));
  assert.equal(fs.readFileSync(file, "utf8"), rotated);
});

test("hosted command checks only the explicit deployment key, captures failures and never prints credentials", async t => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const directory = fs.mkdtempSync(path.join(tmpdir(), "hosted-fixture-command-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const backend = path.join(directory, "packages/backend");
  fs.mkdirSync(path.join(backend, "node_modules/.bin"), { recursive: true });
  fs.writeFileSync(path.join(backend, ".env.local"), "CONVEX_DEPLOY_KEY=wrong-development-key\n");
  fs.writeFileSync(path.join(backend, "node_modules/.bin/convex"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const envFile = args[args.indexOf('--env-file') + 1];
const target = fs.readFileSync(envFile, 'utf8');
if (args.slice(0,3).join(' ') !== 'env list --names-only' || !target.includes('explicit-hosted-key') || target.includes('wrong-development-key') || process.env.CONVEX_DEPLOYMENT || process.env.CONVEX_SELF_HOSTED_URL) process.exit(73);
fs.writeFileSync(process.env.MOCK_CAPTURE, envFile);
if (process.env.MOCK_FAILURE) { console.error('synthetic-sensitive-error'); process.exit(71); }
process.stdout.write(process.env.MOCK_NAMES || '');
`, { mode: 0o755 });
  const entry = fileURLToPath(new URL("../local-fixtures.ts", import.meta.url));
  const capture = path.join(directory, "capture");
  const environment = { ...process.env, CONVEX_DEPLOY_KEY: "explicit-hosted-key", CONVEX_DEPLOYMENT: "prod:unrelated", CONVEX_SELF_HOSTED_URL: "https://unrelated.example.test", MOCK_CAPTURE: capture };
  for (const names of ["SITE_URL\nBETTER_AUTH_SECRET\n", "", "SITE_URL\nDEV_SEED_ENABLED\n", "DEV_FIXTURE_SECRET\n", "error: unauthorized"]) {
    const result = spawnSync(process.execPath, [entry, "check-hosted"], { cwd: directory, env: { ...environment, MOCK_NAMES: names }, encoding: "utf8" });
    assert.equal(result.status, names.includes("DEV_") || names.includes("error:") ? 1 : 0, result.stderr);
    assert.equal(fs.existsSync(fs.readFileSync(capture, "utf8")), false, "temporary credentials are removed");
    assert.doesNotMatch(result.stdout + result.stderr, /explicit-hosted-key|wrong-development-key/);
  }
  const failure = spawnSync(process.execPath, [entry, "check-hosted"], { cwd: directory, env: { ...environment, MOCK_FAILURE: "true" }, encoding: "utf8" });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /verify target access/);
  assert.doesNotMatch(failure.stderr + failure.stdout, /synthetic-sensitive-error/);
});
