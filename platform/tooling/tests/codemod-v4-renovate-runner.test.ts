import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { evaluator, localSignals, parseWorkflow } from "./workflow-runners.ts";
import { migrate, migrateContent } from "../codemods/v4-renovate-runner.ts";

const stock = `name: Renovate\n\njobs:\n  renovate:\n    runs-on: ubuntu-latest\n    steps: []\n`;

function assertRouting(content: string): void {
  const selector = parseWorkflow(content).jobs.renovate["runs-on"]!;
  const entries = Object.entries(localSignals);
  for (let mask = 0; mask < 64; mask++) {
    const vars = Object.fromEntries(entries.filter((_, index) => mask & (1 << index)));
    const expected = mask ? ["self-hosted", vars.PLATFORM_CI_AUX_RUNNER || vars.PLATFORM_CI_RUNNER || "starter-local-only-unconfigured"] : ["ubuntu-latest"];
    assert.deepEqual(evaluator(true, vars).runners(selector), expected, JSON.stringify(vars));
    assert.deepEqual(evaluator(false, vars).runners(selector), ["ubuntu-latest"], JSON.stringify(vars));
  }
  assert.deepEqual(evaluator(true, { PLATFORM_CI_LOCAL_ONLY: "false" }).runners(selector), ["ubuntu-latest"]);
}

test("stock Renovate runner gains the fail-closed auxiliary route", () => {
  const migrated = migrateContent(stock);
  assertRouting(migrated);
  assert.equal(migrateContent(migrated), migrated);
});

test("custom Renovate runner remains app-owned", () => {
  const custom = stock.replace("ubuntu-latest", "self-hosted");
  assert.equal(migrateContent(custom), custom);
});

test("check is read-only and migration is idempotent", t => {
  const root = mkdtempSync(join(process.cwd(), ".v4-renovate-runner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workflow = join(root, ".github/workflows/renovate.yml");
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(workflow, stock);
  assert.deepEqual(migrate(root, true), [".github/workflows/renovate.yml"]);
  assert.equal(readFileSync(workflow, "utf8"), stock);
  assert.deepEqual(migrate(root), [".github/workflows/renovate.yml"]);
  assertRouting(readFileSync(workflow, "utf8"));
  assert.deepEqual(migrate(root), []);
});

test("migration writes to the opened workflow when its path is replaced after reading", t => {
  const root = mkdtempSync(join(process.cwd(), ".v4-renovate-runner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workflow = join(root, ".github/workflows/renovate.yml");
  const original = join(root, "original.yml");
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(workflow, stock);
  const read = fs.readFileSync;
  const mockedRead = t.mock.method(fs, "readFileSync", (...args: Parameters<typeof read>) => {
    const result = read(...args);
    fs.renameSync(workflow, original);
    writeFileSync(workflow, "replacement workflow\n");
    return result;
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(migrate(root), [".github/workflows/renovate.yml"]);
  } finally {
    mockedRead.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(readFileSync(workflow, "utf8"), "replacement workflow\n");
  assert.equal(readFileSync(original, "utf8"), migrateContent(stock));
});
