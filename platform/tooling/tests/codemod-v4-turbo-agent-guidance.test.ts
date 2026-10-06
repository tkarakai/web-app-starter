import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { migrate, migrateContent } from "../codemods/v4-turbo-agent-guidance.ts";

const original = "# App instructions\n\nKeep this content.\n";

function fixture(t: TestContext): string {
  const root = mkdtempSync(join(process.cwd(), ".v4-turbo-guidance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("Turbo's managed guidance is appended without changing app instructions", () => {
  const migrated = migrateContent(original);
  assert.ok(migrated.startsWith(original));
  assert.match(migrated, /BEGIN:turborepo-agent-rules/);
  assert.match(migrated, /docs\/README\.md/);
  assert.equal(migrateContent(migrated), migrated);
});

test("check is read-only and migration is idempotent", t => {
  const root = fixture(t);
  const agents = join(root, "AGENTS.md");
  writeFileSync(agents, original);
  assert.deepEqual(migrate(root, true), ["AGENTS.md"]);
  assert.equal(readFileSync(agents, "utf8"), original);
  assert.deepEqual(migrate(root), ["AGENTS.md"]);
  assert.deepEqual(migrate(root), []);
});

test("a missing AGENTS.md is reported in check mode and created only during migration", t => {
  const root = fixture(t);
  mkdirSync(root, { recursive: true });
  assert.deepEqual(migrate(root, true), ["AGENTS.md"]);
  assert.equal(existsSync(join(root, "AGENTS.md")), false);
  assert.deepEqual(migrate(root), ["AGENTS.md"]);
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /BEGIN:turborepo-agent-rules/);
});

test("migration canonicalizes CRLF and stale managed ranges while preserving surrounding bytes", t => {
  const block = migrateContent("").trimEnd();
  const prefix = "# App instructions\r\nKeep trailing spaces.  \r\n\r\n";
  const suffix = "\r\n\r\n<!-- BEGIN:other-tool -->\r\nKeep me.\r\n<!-- END:other-tool -->\r\n";
  for (const previous of [block.replaceAll("\n", "\r\n"), "<!-- BEGIN:turborepo-agent-rules -->\nold\n<!-- END:turborepo-agent-rules -->"]) {
    const root = fixture(t);
    const agents = join(root, "AGENTS.md");
    const before = prefix + previous + suffix;
    writeFileSync(agents, before);
    assert.deepEqual(migrate(root, true), ["AGENTS.md"]);
    assert.equal(readFileSync(agents, "utf8"), before);
    assert.deepEqual(migrate(root), ["AGENTS.md"]);
    assert.equal(readFileSync(agents, "utf8"), prefix + block + suffix);
    assert.deepEqual(migrate(root, true), []);
    assert.deepEqual(migrate(root), []);
  }
});

test("app-owned whitespace is retained when appending guidance", () => {
  for (const before of ["Keep spaces.  ", "Keep spaces.  \r\n", "Keep blank lines.\n\n\n"]) {
    const after = migrateContent(before);
    assert.ok(after.startsWith(before));
    assert.equal(migrateContent(after), after);
  }
});

test("malformed managed ranges fail without changing app instructions", t => {
  for (const before of [
    "<!-- BEGIN:turborepo-agent-rules -->",
    "<!-- END:turborepo-agent-rules -->",
    "<!-- END:turborepo-agent-rules --><!-- BEGIN:turborepo-agent-rules -->",
    migrateContent("") + migrateContent(""),
  ]) {
    const root = fixture(t);
    const agents = join(root, "AGENTS.md");
    writeFileSync(agents, before);
    for (const check of [true, false]) {
      assert.throws(() => migrate(root, check), /Malformed/);
      assert.equal(readFileSync(agents, "utf8"), before);
    }
  }
});

test("check and migration reject symlinks without modifying their targets", t => {
  for (const destination of ["CLAUDE.md", "../outside.md", "missing.md"]) {
    const parent = fixture(t);
    const root = join(parent, "app");
    mkdirSync(root);
    const target = join(root, destination);
    if (destination !== "missing.md") writeFileSync(target, original);
    const agents = join(root, "AGENTS.md");
    symlinkSync(destination, agents);
    for (const check of [true, false]) {
      assert.throws(() => migrate(root, check));
      assert.ok(lstatSync(agents).isSymbolicLink());
      if (destination === "missing.md") assert.equal(existsSync(target), false);
      else assert.equal(readFileSync(target, "utf8"), original);
    }
  }
});

test("check and migration reject a directory target", t => {
  const root = fixture(t);
  const agents = join(root, "AGENTS.md");
  mkdirSync(agents);
  for (const check of [true, false]) {
    assert.throws(() => migrate(root, check));
    assert.ok(lstatSync(agents).isDirectory());
  }
});
