import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate, migrateContent } from "../codemods/v4-turbo-agent-guidance.ts";

const original = "# App instructions\n\nKeep this content.\n";

test("Turbo's managed guidance is appended without changing app instructions", () => {
  const migrated = migrateContent(original);
  assert.ok(migrated.startsWith(original));
  assert.match(migrated, /BEGIN:turborepo-agent-rules/);
  assert.match(migrated, /docs\/README\.md/);
  assert.equal(migrateContent(migrated), migrated);
});

test("check is read-only and migration is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "v4-turbo-guidance-"));
  const agents = join(root, "AGENTS.md");
  writeFileSync(agents, original);
  assert.deepEqual(migrate(root, true), ["AGENTS.md"]);
  assert.equal(readFileSync(agents, "utf8"), original);
  assert.deepEqual(migrate(root), ["AGENTS.md"]);
  assert.deepEqual(migrate(root), []);
});

test("a missing AGENTS.md is reported in check mode and created only during migration", () => {
  const root = mkdtempSync(join(tmpdir(), "v4-turbo-guidance-missing-"));
  mkdirSync(root, { recursive: true });
  assert.deepEqual(migrate(root, true), ["AGENTS.md"]);
  assert.equal(existsSync(join(root, "AGENTS.md")), false);
  assert.deepEqual(migrate(root), ["AGENTS.md"]);
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /BEGIN:turborepo-agent-rules/);
});
