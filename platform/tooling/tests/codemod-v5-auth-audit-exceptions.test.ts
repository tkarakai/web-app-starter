import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { migrate, migrateContent } from "../codemods/v5-auth-audit-exceptions.ts";
import { parseExceptions } from "../dependency-audit.ts";

const entry = (advisory: string, pkg = "better-auth") => ({
  advisory, package: pkg, expires: "2026-11-12", reason: "Reviewed.", ticket: "https://example.test/issues/1",
});
const held = JSON.stringify({ exceptions: [entry("GHSA-965c-763c-88jm"), entry("GHSA-r4xp-prcw-77qf"), entry("GHSA-q84f-53jg-9ppm")] }, null, 2) + "\n";

test("removes the three fixed better-auth exceptions and keeps the file's shape", () => {
  const migrated = migrateContent(held);
  assert.deepEqual(JSON.parse(migrated), { exceptions: [] });
  assert.deepEqual(parseExceptions(migrated), []);
  assert.equal(migrateContent(migrated), migrated);
});

test("keeps the app's other exceptions, including the same advisory on another package", () => {
  const own = entry("GHSA-aaaa-bbbb-cccc", "some-package");
  const other = entry("GHSA-965c-763c-88jm", "not-better-auth");
  const source = JSON.stringify({ exceptions: [own, entry("GHSA-965c-763c-88jm"), other] }, null, 2) + "\n";
  assert.deepEqual(JSON.parse(migrateContent(source)).exceptions, [own, other]);
  const untouched = JSON.stringify({ exceptions: [own] });
  assert.equal(migrateContent(untouched), untouched);
});

test("check is read-only, migration is idempotent and a missing file is fine", t => {
  const root = mkdtempSync(join(process.cwd(), ".v5-auth-audit-exceptions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(migrate(root), []);
  const file = join(root, "dependency-audit-exceptions.json");
  writeFileSync(file, held);
  assert.deepEqual(migrate(root, true), ["dependency-audit-exceptions.json"]);
  assert.equal(readFileSync(file, "utf8"), held);
  assert.deepEqual(migrate(root), ["dependency-audit-exceptions.json"]);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { exceptions: [] });
  assert.deepEqual(migrate(root), []);
});
