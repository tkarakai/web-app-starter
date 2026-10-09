import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { migrate, migrateContent } from "../codemods/v5-public-hosted-runners.ts";
import { evaluator, localSignals, parseWorkflow } from "./workflow-runners.ts";

const route = "vars.PLATFORM_CI_AUX_RUNNER || vars.PLATFORM_CI_RUNNER || ((vars.PLATFORM_CI_LOCAL_ONLY == 'true' || vars.PLATFORM_CI_WORKER_POOL != '' || vars.PLATFORM_CI_AUX_RUNNER != '' || vars.PLATFORM_CI_RUNNER != '' || vars.PLATFORM_UPDATE_RUNNER != '' || vars.PLATFORM_UPDATE_DELIVERY_RUNNER != '') && 'starter-local-only-unconfigured' || 'ubuntu-latest')";
const stock = `name: Example\njobs:\n  example:\n    runs-on: \${{ ${route} }}\n    steps: []\n`;

test("migration forces public hosted while preserving private meaning for every routing combination", () => {
  for (const original of [stock, stock.replace(`\${{ ${route} }}`, `\${{ fromJSON(format('["{0}"]', ${route})) }}`)]) {
    const after = migrateContent(original);
    assert.notEqual(after, original);
    const beforeJob = parseWorkflow(original).jobs.example, afterJob = parseWorkflow(after).jobs.example;
    for (let mask = 0; mask < 64; mask++) {
      const vars = Object.fromEntries(Object.entries(localSignals).filter((_, index) => mask & (1 << index)));
      assert.deepEqual(evaluator(false, vars).runners(afterJob["runs-on"]!), ["ubuntu-latest"]);
      const privateEvaluation = evaluator(true, vars);
      const previous = privateEvaluation.runners(beforeJob["runs-on"]!);
      assert.deepEqual(privateEvaluation.runners(afterJob["runs-on"]!), mask ? ["self-hosted", ...previous] : previous);
    }
    assert.equal(migrateContent(after), after);
  }
});

test("stock CI diagnostic migration skips public local jobs and emits an explicit hosted rejection", () => {
  const original = `jobs:\n  worker-first:\n    name: Worker isolation 1\n    if: inputs.worker_check && inputs.worker_pool != ''\n    runs-on: \${{ fromJSON(format('["self-hosted","{0}"]', inputs.worker_pool)) }}\n  worker-second:\n    name: Worker isolation 2\n    needs: worker-first\n    runs-on: \${{ fromJSON(format('["self-hosted","{0}"]', inputs.worker_pool)) }}\n`;
  const migrated = migrateContent(original), workflow = parseWorkflow(migrated);
  for (const privacy of [false, true]) {
    const evaluate = evaluator(privacy);
    assert.equal(evaluate.value(workflow.jobs["reject-public-workers"].if!), !privacy);
    for (const id of ["worker-first", "worker-second"]) {
      assert.equal(evaluate.value(workflow.jobs[id].if!), privacy);
      assert.deepEqual(evaluate.runners(workflow.jobs[id]["runs-on"]!), privacy ? ["self-hosted", "starter-diagnostic"] : ["ubuntu-latest"]);
    }
  }
  const rejection = spawnSync("bash", ["-e", "-c", workflow.jobs["reject-public-workers"].steps![0].run!]);
  assert.equal(rejection.status, 1);
  assert.equal(migrateContent(migrated), migrated);
});

test("custom runner selectors and script text remain app-owned", () => {
  for (const selector of ["self-hosted", "${{ matrix.os }}", "${{ vars.CUSTOM_RUNNER }}"]) {
    const original = `jobs:\n  custom:\n    runs-on: ${selector}\n    steps:\n      - run: |\n          runs-on: \${{ ${route} }}\n`;
    assert.equal(migrateContent(original), original);
  }
});

test("CLI check is read-only, reports each file/count and migration is idempotent at an explicit directory", t => {
  const root = mkdtempSync(path.join(process.cwd(), ".public-runner-migration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "custom"));
  const file = path.join(root, "custom/ci.yaml");
  writeFileSync(file, stock);
  const cli = new URL("../codemods/v5-public-hosted-runners.ts", import.meta.url).pathname;
  const checked = spawnSync(process.execPath, [cli, "--check", root, "custom"], { encoding: "utf8" });
  assert.equal(checked.status, 1, checked.stderr);
  assert.match(checked.stdout, /Would update custom\/ci.yaml/);
  assert.match(checked.stdout, /1 file\(s\) need migration/);
  assert.equal(readFileSync(file, "utf8"), stock);
  assert.deepEqual(migrate(root, false, "custom"), ["custom/ci.yaml"]);
  assert.deepEqual(evaluator(false, localSignals).runners(parseWorkflow(readFileSync(file, "utf8")).jobs.example["runs-on"]!), ["ubuntu-latest"]);
  assert.deepEqual(migrate(root, false, "custom"), []);
  assert.equal(spawnSync(process.execPath, [cli, "--check", root, "custom"]).status, 0);
});

test("migration refuses symlink targets and directories outside the app root without modifying them", t => {
  const root = mkdtempSync(path.join(process.cwd(), ".public-runner-migration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "workflows"));
  writeFileSync(path.join(root, "outside.yml"), stock);
  symlinkSync(path.join(root, "outside.yml"), path.join(root, "workflows/ci.yml"));
  assert.throws(() => migrate(root, false, "workflows"));
  assert.equal(readFileSync(path.join(root, "outside.yml"), "utf8"), stock);
  assert.throws(() => migrate(root, false, ".."), /inside the app root/);
});
