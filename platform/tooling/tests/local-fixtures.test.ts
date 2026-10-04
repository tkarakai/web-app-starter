import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  for (const override of [{ CONVEX_DEPLOY_KEY: "prod:key" }, { CONVEX_DEPLOYMENT_TOKEN: "prod:key" }, { CONVEX_SELF_HOSTED_URL: "http://localhost:3210" }, { CONVEX_SELF_HOSTED_ADMIN_KEY: "key" }, { CONVEX_DEPLOYMENT: "prod:hosted" }, { CONVEX_DEPLOYMENT: "anonymous:../../escape" }]) {
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
  fs.writeFileSync(path.join(backend, "node_modules/.bin/bunx"), `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] !== "convex@1.46.0") process.exit(74);
const args = process.argv.slice(3);
const envFile = args[args.indexOf('--env-file') + 1];
const target = fs.readFileSync(envFile, 'utf8');
if (args.slice(0,3).join(' ') !== 'env list --names-only' || !target.includes('explicit-hosted-key') || target.includes('wrong-development-key') || process.env.CONVEX_DEPLOYMENT || process.env.CONVEX_SELF_HOSTED_URL || process.env.CONVEX_DEPLOYMENT_TOKEN) process.exit(73);
fs.writeFileSync(process.env.MOCK_CAPTURE, envFile);
if (process.env.MOCK_FAILURE) { console.error('synthetic-sensitive-error'); process.exit(71); }
process.stdout.write(process.env.MOCK_NAMES || '');
`, { mode: 0o755 });
  const entry = fileURLToPath(new URL("../local-fixtures.ts", import.meta.url));
  const capture = path.join(directory, "capture");
  const environment = { ...process.env, PATH: path.join(backend, "node_modules/.bin") + path.delimiter + process.env.PATH, TMPDIR: directory, CONVEX_DEPLOY_KEY: "explicit-hosted-key", CONVEX_DEPLOYMENT_TOKEN: "wrong-token", CONVEX_DEPLOYMENT: "prod:unrelated", CONVEX_SELF_HOSTED_URL: "https://unrelated.example.test", MOCK_CAPTURE: capture };
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

function localCommand(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".local-fixtures-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const backend = path.join(directory, "packages/backend");
  const home = path.join(directory, "home");
  fs.mkdirSync(path.join(backend, "node_modules/.bin"), { recursive: true });
  fs.mkdirSync(home);
  const capture = path.join(directory, "capture.json");
  fs.writeFileSync(path.join(backend, "node_modules/.bin/convex"), `#!/usr/bin/env node
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const args = process.argv.slice(2);
const target = parseEnv(fs.readFileSync(args[args.indexOf('--env-file') + 1], 'utf8'));
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN', 'CONVEX_DEPLOYMENT', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY', 'CONVEX_AGENT_MODE'].includes(key)));
fs.writeFileSync(process.env.MOCK_CAPTURE, JSON.stringify({args: args.slice(0, 3), target, inherited, input: parseEnv(fs.readFileSync(0, 'utf8'))}));
`, { mode: 0o755 });
  const environment: Record<string, string | undefined> = { ...process.env, HOME: home, TMPDIR: directory, MOCK_CAPTURE: capture };
  for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_DEPLOYMENT", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"]) delete environment[key];
  const entry = fileURLToPath(new URL("../local-fixtures.ts", import.meta.url));
  const run = (mode: string, env = {}) => {
    fs.rmSync(capture, { force: true });
    return spawnSync(process.execPath, [entry, mode], { cwd: directory, env: { ...environment, ...env }, encoding: "utf8" });
  };
  return { directory, backend, home, capture, run };
}

test("anonymous command selects project-local state before legacy, rejects mismatches and supports legacy identity", t => {
  const { directory, backend, home, capture, run } = localCommand(t);
  fs.writeFileSync(path.join(backend, ".env.local"), "CONVEX_DEPLOYMENT=anonymous:test\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_SITE_URL=http://127.0.0.1:3211\n");
  const project = path.join(backend, ".convex/local/default");
  const legacy = path.join(home, ".convex/anonymous-convex-backend-state/test");
  fs.mkdirSync(project, { recursive: true });
  const config = { deploymentName: "test", adminKey: "project-key", ports: { cloud: 3210, site: 3211 } };
  fs.writeFileSync(path.join(project, "config.json"), JSON.stringify(config));
  const verify = (key: string) => {
    const result = run("anonymous", { CONVEX_AGENT_MODE: "anonymous" });
    assert.equal(result.status, 0, result.stderr);
    const call = JSON.parse(fs.readFileSync(capture, "utf8"));
    assert.deepEqual(call.args, ["env", "set", "--force"]);
    assert.deepEqual(call.target, { CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210", CONVEX_SELF_HOSTED_ADMIN_KEY: key });
    assert.deepEqual(call.inherited, {});
    assert.equal(call.input.DEV_FIXTURE_RUNTIME, "anonymous");
    assert.equal(call.input.DEV_SEED_ENABLED, "true");
    const fixture = parseEnv(fs.readFileSync(path.join(directory, ".env.e2e.local"), "utf8"));
    assert.equal(call.input.DEV_FIXTURE_SECRET, fixture.DEV_FIXTURE_SECRET);
    assert.match(fixture.DEV_FIXTURE_SECRET!, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(result.stdout + result.stderr, /project-key|legacy-key|DEV_FIXTURE_SECRET/);
  };
  verify("project-key");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "config.json"), JSON.stringify({ adminKey: "legacy-key", ports: config.ports }));
  verify("project-key");
  for (const invalid of [{ ...config, deploymentName: "another" }, { ...config, ports: { cloud: 9999, site: 3211 } }, { ...config, ports: { cloud: 3210, site: 9999 } }, { ...config, deploymentName: undefined }]) {
    fs.writeFileSync(path.join(project, "config.json"), JSON.stringify(invalid));
    assert.equal(run("anonymous").status, 1);
    assert.equal(fs.existsSync(capture), false);
  }
  fs.rmSync(path.join(project, "config.json"));
  verify("legacy-key");
  fs.writeFileSync(path.join(legacy, "config.json"), JSON.stringify({ ...config, deploymentName: "another" }));
  assert.equal(run("anonymous").status, 1);
  assert.equal(fs.existsSync(capture), false);
});

test("launch and anonymous commands reject every credential source independently", t => {
  const { directory, backend, capture, run } = localCommand(t);
  assert.equal(run("check-launch").status, 0);
  const files = [path.join(directory, ".env.local"), path.join(backend, ".env.local"), path.join(backend, ".env")];
  for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_DEPLOYMENT"]) {
    for (const mode of ["check-launch", "anonymous"]) {
      const result = run(mode, { [key]: "prod:sensitive" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /refuses|refusing/);
      assert.doesNotMatch(result.stderr, /sensitive/);
      assert.equal(fs.existsSync(capture), false);
    }
    for (const file of files) {
      for (const sibling of files) fs.writeFileSync(sibling, `${key}=\n`);
      fs.writeFileSync(file, `export ${key}="prod:sensitive"\n`);
      for (const mode of ["check-launch", "anonymous"]) {
        const result = run(mode, { [key]: "" });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /refuses|refusing/);
        assert.doesNotMatch(result.stderr, /sensitive/);
        assert.equal(fs.existsSync(capture), false);
      }
    }
    for (const file of files) fs.rmSync(file);
  }
  fs.writeFileSync(files[0], "CONVEX_DEPLOYMENT=prod:masked\n");
  fs.writeFileSync(files[1], "CONVEX_DEPLOYMENT=anonymous:test\n");
  assert.equal(run("check-launch").status, 1);
});

test("local AWS command provisions its dedicated target and refuses deploy keys from env and files", t => {
  const { directory, backend, capture, run } = localCommand(t);
  const state = path.join(directory, "infra/aws/local/.state");
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, "convex-admin-key"), "aws-local-key\n");
  const env = { CONVEX_SELF_HOSTED_URL: "http://convex.localhost.floci.io:3310", CONVEX_SELF_HOSTED_ADMIN_KEY: "aws-local-key", CONVEX_DEPLOYMENT: "anonymous:unrelated" };
  const result = run("local-aws", env);
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(fs.readFileSync(capture, "utf8"));
  assert.deepEqual(call.target, { CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3310", CONVEX_SELF_HOSTED_ADMIN_KEY: "aws-local-key" });
  assert.deepEqual(call.inherited, {});
  assert.equal(call.input.DEV_FIXTURE_RUNTIME, "local-aws");
  assert.match(parseEnv(fs.readFileSync(path.join(state, "fixture.env"), "utf8")).DEV_FIXTURE_SECRET!, /^[a-f0-9]{64}$/);
  for (const override of [{ CONVEX_SELF_HOSTED_URL: "https://hosted.example.test" }, { CONVEX_SELF_HOSTED_ADMIN_KEY: "wrong" }, { CONVEX_DEPLOY_KEY: "prod:key" }, { CONVEX_DEPLOYMENT_TOKEN: "prod:token" }]) {
    assert.equal(run("local-aws", { ...env, ...override }).status, 1);
    assert.equal(fs.existsSync(capture), false);
  }
  for (const file of [path.join(directory, ".env.local"), path.join(backend, ".env.local"), path.join(backend, ".env")]) {
    for (const key of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"]) {
      fs.writeFileSync(file, `${key}=prod:key\n`);
      assert.equal(run("local-aws", env).status, 1);
      assert.equal(fs.existsSync(capture), false);
    }
    fs.rmSync(file);
  }
});

test("trusted deploy action checks historical source before deployment using a compatible isolated CLI", t => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".fixture-rollback-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const selected = path.join(directory, "selected");
  // Model selected source predating the helper without requiring starter Git history.
  fs.mkdirSync(path.join(selected, "packages/backend"), { recursive: true });
  fs.mkdirSync(path.join(selected, "platform/tooling"), { recursive: true });
  fs.writeFileSync(path.join(selected, "package.json"), JSON.stringify({ private: true, type: "module" }));
  fs.writeFileSync(path.join(selected, "packages/backend/package.json"), JSON.stringify({ dependencies: { convex: "1.25.4" } }));
  assert.equal(fs.existsSync(path.join(selected, "platform/tooling/local-fixtures.ts")), false);
  const trusted = path.join(selected, ".ops-workflow/.github/actions/deploy-convex");
  fs.mkdirSync(trusted, { recursive: true });
  fs.cpSync(path.resolve(".github/actions/deploy-convex"), trusted, { recursive: true });
  const model = spawnSync("bun", ["--eval", 'import { YAML } from "bun"; import { readFileSync } from "node:fs"; process.stdout.write(JSON.stringify(YAML.parse(readFileSync(process.argv[1], "utf8"))));', path.join(trusted, "action.yml")], { encoding: "utf8" });
  assert.equal(model.status, 0, model.stderr);
  const action = JSON.parse(model.stdout) as { runs: { using: string; steps: { run: string; env?: Record<string, string>; shell: string }[] } };
  assert.equal(action.runs.using, "composite");
  const bin = path.join(directory, "node_modules/.bin");
  fs.mkdirSync(bin, { recursive: true });
  const events = path.join(directory, "events");
  fs.writeFileSync(path.join(selected, "platform/tooling/node-ts.sh"), '#!/bin/bash\nset -e\nprintf "migration-check\\n" >> "$MOCK_EVENTS"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "bunx"), `#!/usr/bin/env node
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const args = process.argv.slice(2);
if (args[0] === 'convex@1.46.0') {
  const file = args[args.indexOf('--env-file') + 1];
  const target = parseEnv(fs.readFileSync(file, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (manifest.dependencies.convex !== '1.46.0') process.exit(76);
  if (args.slice(1,4).join(' ') !== 'env list --names-only' || target.CONVEX_DEPLOY_KEY !== 'exact-target-key' || Object.keys(target).length !== 1 || process.env.CONVEX_DEPLOYMENT_TOKEN || process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_DEPLOYMENT || process.env.CONVEX_SELF_HOSTED_URL || process.env.CONVEX_SELF_HOSTED_ADMIN_KEY) process.exit(73);
  fs.appendFileSync(process.env.MOCK_EVENTS, 'fixture-check\\n');
  if (process.env.MOCK_FAILURE) { console.error('captured-sensitive-failure'); process.exit(71); }
  process.stdout.write(process.env.MOCK_NAMES || '');
} else {
  if (args[0] !== 'convex' || process.env.CONVEX_DEPLOY_KEY !== 'exact-target-key') process.exit(74);
  if (args[1] === 'env') { console.error('historical CLI does not support --names-only'); process.exit(75); }
  fs.appendFileSync(process.env.MOCK_EVENTS, args[1] === 'deploy' ? 'deploy\\n' : 'migrate\\n');
}
`, { mode: 0o755 });
  const bindings: Record<string, string> = { "github.action_path": trusted, "inputs.deploy-key": "exact-target-key", "inputs.environment": "production", "github.sha": "selected-source-fixture" };
  const render = (value: string) => value.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_match: string, key: string) => {
    assert.ok(Object.hasOwn(bindings, key), `unsupported action expression: ${key}`);
    return bindings[key];
  });
  for (const scenario of [
    { names: "SITE_URL\nBETTER_AUTH_SECRET\n", denied: false },
    { names: "", denied: false },
    { names: "DEV_SEED_ENABLED\n", denied: true },
    { names: "DEV_FIXTURE_RUNTIME\n", denied: true },
    { names: "DEV_FIXTURE_SECRET\n", denied: true },
    { names: "captured-sensitive-parse-error!", denied: true },
    { names: "", failure: "true", denied: true },
  ]) {
    fs.writeFileSync(events, "");
    let status = 0;
    let output = "";
    for (const step of action.runs.steps) {
      assert.equal(step.shell, "bash");
      const env = Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, render(value)]));
      const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", render(step.run)], {
        cwd: selected,
        env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, TMPDIR: directory, CONVEX_DEPLOYMENT: "prod:unrelated", CONVEX_DEPLOYMENT_TOKEN: "sensitive-wrong-token", CONVEX_SELF_HOSTED_URL: "https://unrelated.example.test", CONVEX_SELF_HOSTED_ADMIN_KEY: "sensitive-wrong-admin", ...env, MOCK_EVENTS: events, MOCK_NAMES: scenario.names, MOCK_FAILURE: scenario.failure ?? "", GITHUB_STEP_SUMMARY: path.join(directory, "summary") },
        encoding: "utf8",
      });
      status = result.status ?? 1;
      output += result.stdout + result.stderr;
      if (status !== 0) break;
    }
    assert.equal(status, scenario.denied ? 1 : 0, output);
    assert.deepEqual(fs.readFileSync(events, "utf8").trim().split("\n"), scenario.denied ? ["fixture-check"] : ["fixture-check", "migration-check", "deploy", "migrate"]);
    assert.doesNotMatch(output, /exact-target-key|sensitive|parse-error|does not support/);
  }
});
