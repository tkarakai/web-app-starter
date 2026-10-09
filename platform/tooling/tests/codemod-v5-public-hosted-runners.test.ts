import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { migrate, migrateContent } from "../codemods/v5-public-hosted-runners.ts";
import { evaluator, localSignals, parseWorkflow, source, verifiedSource } from "./workflow-runners.ts";

const route = "vars.PLATFORM_CI_AUX_RUNNER || vars.PLATFORM_CI_RUNNER || ((vars.PLATFORM_CI_LOCAL_ONLY == 'true' || vars.PLATFORM_CI_WORKER_POOL != '' || vars.PLATFORM_CI_AUX_RUNNER != '' || vars.PLATFORM_CI_RUNNER != '' || vars.PLATFORM_UPDATE_RUNNER != '' || vars.PLATFORM_UPDATE_DELIVERY_RUNNER != '') && 'starter-local-only-unconfigured' || 'ubuntu-latest')";
const stock = `name: Example\njobs:\n  example:\n    runs-on: \${{ ${route} }}\n    steps: []\n`;
const diagnostic = `format('["self-hosted","{0}","starter-source-{1}","starter-run-{2}"]', inputs.worker_pool, github.sha, github.run_id)`;
const diagnosticCaller = `name: Diagnostic\non:\n  workflow_dispatch:\n    inputs:\n      worker_check:\n        type: boolean\n      worker_pool:\n        type: string\njobs:\n  worker-first:\n    name: Worker isolation 1\n    if: inputs.worker_check && inputs.worker_pool != ''\n    runs-on: \${{ fromJSON(${diagnostic}) }}\n    steps:\n      - run: echo first\n  worker-second:\n    name: Worker isolation 2\n    needs: worker-first\n    runs-on: \${{ fromJSON(${diagnostic}) }}\n    steps:\n      - run: echo second\n`;

test("custom diagnostic conditions and selectors are preserved without duplicate YAML keys", () => {
  for (const original of [
    diagnosticCaller.replace("    needs: worker-first\n", "    needs: worker-first\n    if: ${{ !cancelled() }}\n"),
    diagnosticCaller.replace("if: inputs.worker_check && inputs.worker_pool != ''", "if: inputs.worker_check"),
    diagnosticCaller.replace(`runs-on: \${{ fromJSON(${diagnostic}) }}`, "runs-on: windows-latest"),
    diagnosticCaller.replace('    needs: worker-first\n', '    needs: worker-first\n  # Owner condition\n    if: ${{ !cancelled() }}\n'),
    diagnosticCaller.replace('  worker-second:', '  worker-second: # Custom job'),
  ]) {
    const review: string[] = [];
    assert.equal(migrateContent(original, review), original);
    assert.match(review.join('\n'), /Customized.*owner review/);
    const jobs = parseWorkflow(migrateContent(original)).jobs;
    assert.equal(jobs["worker-second"].if, parseWorkflow(original).jobs["worker-second"].if);
  }
});

test('diagnostic migration passes a duplicate-key-rejecting Actions consumer when available', t => {
  const probe = spawnSync('actionlint', ['-version'], { encoding: 'utf8' });
  if ((probe.error as { code?: string } | undefined)?.code === 'ENOENT') { t.skip('actionlint is not installed; byte-preservation regression remains mandatory'); return; }
  assert.equal(probe.status, 0, probe.stderr);
  const custom = diagnosticCaller.replace('    needs: worker-first\n', '    needs: worker-first\n    if: ${{ !cancelled() }}\n');
  for (const original of [diagnosticCaller, custom]) {
    const checked = spawnSync('actionlint', ['-shellcheck=', '-pyflakes=', '-'], { input: migrateContent(original), encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  }
  const duplicate = custom.replace('    needs: worker-first\n', '    needs: worker-first\n    if: true\n');
  const rejected = spawnSync('actionlint', ['-shellcheck=', '-pyflakes=', '-'], { input: duplicate, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout + rejected.stderr, /key "if" is duplicated/);
});

test('CLI identifies customized diagnostic files for owner review without changing them', t => {
  const root = mkdtempSync(path.join(process.cwd(), '.public-runner-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  const file = path.join(root, '.github/workflows/ci-verify.yml');
  const original = diagnosticCaller.replace('    needs: worker-first\n', '    needs: worker-first\n    if: ${{ !cancelled() }}\n');
  writeFileSync(file, original);
  const cli = new URL('../codemods/v5-public-hosted-runners.ts', import.meta.url).pathname;
  for (const args of [[], ['--check']]) {
    const result = spawnSync(process.execPath, [cli, ...args, root], { encoding: 'utf8' });
    assert.equal(result.status, args.length ? 1 : 0, result.stderr);
    assert.match(result.stdout, /Owner review required: .github\/workflows\/ci-verify.yml: Customized/);
    assert.match(result.stdout, /0 file\(s\)/);
    assert.equal(readFileSync(file, 'utf8'), original);
  }
});

test("migration forces public hosted while preserving private meaning for every routing combination", () => {
  for (const original of [
    stock,
    stock.replace(route, `github.event.repository.private != true && 'ubuntu-latest' || (${route})`),
    stock.replace(route, `fromJSON(format('["{0}"]', ${route}))`),
    stock.replace(route, `fromJSON(github.event.repository.private != true && '["ubuntu-latest"]' || format('["{0}"]', ${route}))`),
  ]) {
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
  const original = `jobs:\n  worker-first:\n    name: Worker isolation 1\n    if: inputs.worker_check && inputs.worker_pool != ''\n    runs-on: \${{ fromJSON(${diagnostic}) }}\n  worker-second:\n    name: Worker isolation 2\n    needs: worker-first\n    runs-on: \${{ fromJSON(${diagnostic}) }}\n`;
  const migrated = migrateContent(original), workflow = parseWorkflow(migrated);
  for (const privacy of [false, true]) {
    const evaluate = evaluator(privacy);
    assert.equal(evaluate.value(workflow.jobs["reject-public-workers"].if!), !privacy);
    for (const id of ["worker-first", "worker-second"]) {
      assert.equal(evaluate.value(workflow.jobs[id].if!), privacy);
      assert.deepEqual(evaluate.runners(workflow.jobs[id]["runs-on"]!), privacy ? ["self-hosted", "starter-diagnostic", `starter-source-${source}`, "starter-run-123"] : ["ubuntu-latest"]);
    }
  }
  const rejection = spawnSync("bash", ["-e", "-c", workflow.jobs["reject-public-workers"].steps![0].run!]);
  assert.equal(rejection.status, 1);
  assert.equal(migrateContent(migrated), migrated);
});

test("custom runner selectors and script text remain app-owned", () => {
  const custom = [
    "vars.PLATFORM_CI_RUNNER || 'windows-latest'",
    "vars.PLATFORM_UPDATE_RUNNER || 'macos-latest'",
    "fromJSON(vars.PLATFORM_CI_RUNNER || '[\"windows-latest\"]')",
    "fromJSON(format('[\"self-hosted\",\"{0}\"]', inputs.worker_pool))",
    `fromJSON(format('["{0}"]', ${route}) || '["windows-latest"]')`,
    `fromJSON(format('["self-hosted","{0}","custom-role"]', vars.PLATFORM_CI_WORKER_POOL) || format('["{0}"]', ${route}))`,
  ];
  for (const expression of [...custom]) {
    custom.push(expression.startsWith("fromJSON(")
      ? `fromJSON(github.event.repository.private != true && '["windows-latest"]' || (${expression.slice(9, -1)}))`
      : `github.event.repository.private != true && 'windows-latest' || (${expression})`);
  }
  custom.push(`fromJSON(github.event.repository.private != true && '["ubuntu-latest"]' || (format('["{0}"]', ${route}) || '["windows-latest"]'))`);
  for (const selector of ["self-hosted", "${{ matrix.os }}", "${{ vars.CUSTOM_RUNNER }}", ...custom.map(expression => `\${{ ${expression} }}`)]) {
    const original = `jobs:\n  custom:\n    runs-on: ${selector}\n    steps:\n      - run: |\n          runs-on: \${{ ${route} }}\n`;
    assert.equal(migrateContent(original), original);
  }
});

test("stock source-bound routes preserve CI and updater labels across guarded and unguarded migrations", () => {
  const ci = `'["self-hosted","{0}","starter-source-{1}","starter-run-{2}"]'`;
  const cases: [string, string[]][] = [
    [`vars.PLATFORM_CI_WORKER_POOL != '' && format(${ci}, vars.PLATFORM_CI_WORKER_POOL, github.sha, github.run_id)`, ["starter-pool", `starter-source-${source}`, "starter-run-123"]],
    [`vars.PLATFORM_CI_WORKER_POOL != '' && github.event_name != 'schedule' && format(${ci}, vars.PLATFORM_CI_WORKER_POOL, github.sha, github.run_id)`, ["starter-pool", `starter-source-${source}`, "starter-run-123"]],
    [`startsWith(github.workflow, 'CI ') && vars.PLATFORM_CI_WORKER_POOL != '' && format(${ci}, vars.PLATFORM_CI_WORKER_POOL, inputs.git_sha || github.sha, github.run_id)`, ["starter-pool", `starter-source-${verifiedSource}`, "starter-run-123"]],
    ...([
      ["PLATFORM_UPDATE_RUNNER", "check", "github.sha", source, "starter-update"],
      ["PLATFORM_UPDATE_RUNNER", "verify", "needs.check.outputs.head", verifiedSource, "starter-update"],
      ["PLATFORM_UPDATE_DELIVERY_RUNNER", "deliver", "needs.check.outputs.head || github.sha", verifiedSource, "starter-delivery"],
    ] as const).map(([variable, role, shaExpression, sha, pool]): [string, string[]] => [
      `vars.${variable} != '' && format('["self-hosted","{0}","starter-source-{1}","starter-run-{2}","starter-attempt-{3}","starter-update-${role}"]', vars.${variable}, ${shaExpression}, github.run_id, github.run_attempt)`,
      [pool, `starter-source-${sha}`, "starter-run-123", "starter-attempt-2", `starter-update-${role}`],
    ]),
  ];
  for (const [prefix, labels] of cases) {
    const inner = `${prefix} || format('["{0}"]', ${route})`;
    for (const expression of [`fromJSON(${inner})`, `fromJSON(github.event.repository.private != true && '["ubuntu-latest"]' || (${inner}))`]) {
      const original = stock.replace(route, expression), after = migrateContent(original);
      assert.notEqual(after, original);
      const selector = parseWorkflow(after).jobs.example["runs-on"]!;
      assert.deepEqual(evaluator(true, localSignals).runners(selector), ["self-hosted", ...labels]);
      assert.deepEqual(evaluator(true).runners(selector), ["ubuntu-latest"]);
      assert.deepEqual(evaluator(true, { PLATFORM_CI_AUX_RUNNER: "starter-aux" }).runners(selector), ["self-hosted", "starter-aux"]);
      const beforeSelector = parseWorkflow(original).jobs.example["runs-on"]!;
      for (let mask = 0; mask < 64; mask++) {
        const vars = Object.fromEntries(Object.entries(localSignals).filter((_, index) => mask & (1 << index)));
        const previous = evaluator(true, vars).runners(beforeSelector);
        const expected = mask && previous[0] !== "self-hosted" ? ["self-hosted", ...previous] : previous;
        assert.deepEqual(evaluator(true, vars).runners(selector), expected);
        assert.deepEqual(evaluator(false, vars).runners(selector), ["ubuntu-latest"]);
      }
      for (const privacy of [false, undefined, null]) assert.deepEqual(evaluator(privacy, localSignals).runners(selector), ["ubuntu-latest"]);
      assert.equal(migrateContent(after), after);
    }
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
