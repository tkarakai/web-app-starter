import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BASE_FILE, SEAM_HOOKS, checkZone, isZonePath, main, parseBase } from "../check-zone.ts";

function write(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" }).trim();
}

// A repository at a platform release commit: seams with their hooks, and some zone files.
function release(): { root: string; commit: string } {
  const root = mkdtempSync(path.join(tmpdir(), "zone-"));
  git(root, "init", "-q");
  const seams = new Map<string, string[]>();
  for (const { file, hook } of SEAM_HOOKS) seams.set(file, [...(seams.get(file) ?? []), hook]);
  for (const [file, hooks] of seams) write(root, file, `// seam\n${hooks.join("\n")}\n`);
  write(root, "platform/packages/auth/src/cookies.ts", "export const prefix = \"app\";\n");
  write(root, "packages/backend/convex/platform/users.ts", "export const users = 1;\n");
  write(root, ".github/workflows/platform-ci.yml", "name: ci\n");
  write(root, "apps/web/src/page.tsx", "export default 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "release");
  return { root, commit: git(root, "rev-parse", "HEAD") };
}

function adopt(root: string, commit: string, patches: { path: string; reason: string }[] = []): void {
  write(root, BASE_FILE, JSON.stringify({ version: "2.0.0", commit, patches }));
}

test("isZonePath: platform directories and platform-* names", () => {
  for (const file of ["platform/VERSION", "packages/backend/convex/platform/users.ts", ".github/workflows/platform-ci.yml",
    ".claude/skills/platform-deps", ".agents/skills/platform-deps/SKILL.md"]) assert.equal(isZonePath(file), true, file);
  for (const file of ["apps/web/src/page.tsx", "platform", ".platform-base.json", "renovate.json", "apps/web/src/platformish.ts"]) {
    assert.equal(isZonePath(file), false, file);
  }
});

test("parseBase rejects a missing commit or a patch without a reason", () => {
  assert.match(parseBase("{\"version\":\"2.0.0\"}") as string, /commit/);
  assert.match(parseBase("{\"version\":\"2.0.0\",\"commit\":\"abcdef1\",\"patches\":[{\"path\":\"platform/x\"}]}") as string, /reason/);
  assert.deepEqual(parseBase("{\"version\":\"2.0.0\",\"commit\":\"abcdef1\"}"), { version: "2.0.0", commit: "abcdef1", patches: [] });
});

test("product repo: passes, and fails when app code carries a patch marker", () => {
  const { root } = release();
  assert.deepEqual(checkZone(root).errors, []);
  write(root, "apps/web/src/page.tsx", "// PLATFORM-PATCH: nope\nexport default 1;\n");
  git(root, "add", "-A");
  assert.match(checkZone(root).errors.join("\n"), /apps\/web\/src\/page\.tsx: carries a PLATFORM-PATCH: marker/);
});

test("adopted app: app edits pass; an unrecorded platform-zone edit fails", () => {
  const { root, commit } = release();
  adopt(root, commit);
  write(root, "apps/web/src/page.tsx", "export default 2;\n");
  assert.deepEqual(checkZone(root).errors, []);
  write(root, "platform/packages/auth/src/cookies.ts", "export const prefix = \"mine\";\n");
  write(root, "packages/backend/convex/platform/users.ts", "export const users = 2;\n");
  const errors = checkZone(root).errors.join("\n");
  assert.match(errors, /platform\/packages\/auth\/src\/cookies\.ts: platform-zone edit is not a recorded patch/);
  assert.match(errors, /convex\/platform\/users\.ts: platform-zone edit is not a recorded patch/);
});

test("adopted app: a recorded, marked patch passes and is listed", () => {
  const { root, commit } = release();
  write(root, "platform/packages/auth/src/cookies.ts", "// PLATFORM-PATCH: keep our cookie prefix\nexport const prefix = \"mine\";\n");
  adopt(root, commit, [{ path: "platform/packages/auth/src/cookies.ts", reason: "keep our cookie prefix" }]);
  const lines: string[] = [];
  assert.equal(main([root], (line) => lines.push(line)), 0);
  assert.ok(lines.includes("Recorded platform patches (1):"), lines.join("\n"));
  assert.ok(lines.includes("  platform/packages/auth/src/cookies.ts: keep our cookie prefix"));
});

test("adopted app: a recorded patch without a marker fails; a stale record warns", () => {
  const { root, commit } = release();
  write(root, "platform/packages/auth/src/cookies.ts", "export const prefix = \"mine\";\n");
  adopt(root, commit, [
    { path: "platform/packages/auth/src/cookies.ts", reason: "prefix" },
    { path: ".github/workflows/platform-ci.yml", reason: "old" },
  ]);
  const result = checkZone(root);
  assert.match(result.errors.join("\n"), /cookies\.ts: recorded patch has no "PLATFORM-PATCH: <reason>" comment/);
  assert.match(result.warnings.join("\n"), /platform-ci\.yml: recorded patch no longer differs/);
});

test("adopted app: an unknown base commit fails with how to fetch it", () => {
  const { root } = release();
  adopt(root, "0123456789abcdef0123456789abcdef01234567");
  assert.match(checkZone(root).errors.join("\n"), /is not in this clone/);
});

test("a seam without its platform hook fails", () => {
  const { root } = release();
  write(root, "packages/backend/convex/schema.ts", "export default {};\n");
  assert.match(checkZone(root).errors.join("\n"), /schema\.ts: keep "\.\.\.platformTables"/);
});
