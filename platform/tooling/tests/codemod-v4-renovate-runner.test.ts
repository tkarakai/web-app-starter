import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate, migrateContent } from "../codemods/v4-renovate-runner.ts";

const stock = `name: Renovate\n\njobs:\n  renovate:\n    runs-on: ubuntu-latest\n    steps: []\n`;

test("stock Renovate runner gains the fail-closed auxiliary route", () => {
  const migrated = migrateContent(stock);
  assert.match(migrated, /PLATFORM_CI_AUX_RUNNER/);
  assert.match(migrated, /starter-local-only-unconfigured/);
  assert.equal(migrateContent(migrated), migrated);
});

test("custom Renovate runner remains app-owned", () => {
  const custom = stock.replace("ubuntu-latest", "self-hosted");
  assert.equal(migrateContent(custom), custom);
});

test("check is read-only and migration is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "v4-renovate-runner-"));
  const workflow = join(root, ".github/workflows/renovate.yml");
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(workflow, stock);
  assert.deepEqual(migrate(root, true), [".github/workflows/renovate.yml"]);
  assert.equal(readFileSync(workflow, "utf8"), stock);
  assert.deepEqual(migrate(root), [".github/workflows/renovate.yml"]);
  assert.deepEqual(migrate(root), []);
});
