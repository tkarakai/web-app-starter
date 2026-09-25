/** Release operations run only in isolated Git repos; never tag this checkout. */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve("scripts/release.ts");
let repo: string;
function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function write(file: string, value: string): void { writeFileSync(path.join(repo, file), value); }
function read(file: string): string { return readFileSync(path.join(repo, file), "utf8"); }
function commit(): void { git("add", "."); git("commit", "-qm", "fixture"); }
function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8" });
}
function passes(...args: string[]): string {
  const result = run(...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function fails(pattern: RegExp, ...args: string[]): void {
  const result = run(...args);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}
function prepare(): void { passes("1.0.0"); commit(); }

beforeEach(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), "starter-release-"));
  git("init", "-qb", "release-pr");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release@example.com");
  write("package.json", '{"name":"starter","version":"0.1.0","private":true}\n');
  write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\nInitial starter.\n\n### Added\n\n- Starter baseline.\n");
  commit();
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("prepares on a PR branch without creating commits or tags, then verifies exact metadata", () => {
  const head = git("rev-parse", "HEAD");
  passes("1.0.0", "--dry-run");
  assert.equal(git("status", "--porcelain"), "");
  passes("1.0.0");
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("tag", "-l"), "");
  assert.equal(JSON.parse(read("package.json")).version, "1.0.0");
  assert.match(read("CHANGELOG.md"), /## \[Unreleased\]\s+## \[1\.0\.0\] - \d{4}-\d{2}-\d{2}/);
  commit();
  passes("1.0.0", "--check");
  assert.equal(passes("1.0.0", "--notes"), "Initial starter.\n\n### Added\n\n- Starter baseline.\n");
});

test("rejects dirty trees, invalid versions and obsolete bypass flags", () => {
  for (const version of ["01.0.0", "v1.0.0", "1.0", "1.0.0-beta", "1.0.0;echo bad"]) {
    fails(/version must/, version);
  }
  fails(/unknown flag/, "1.0.0", "--allow-unpublished");
  fails(/unknown flag/, "1.0.0", "--allow-branch");
  write("untracked", "unfinished");
  fails(/dirty/, "1.0.0");
});

test("requires matching package, dated notes and empty Unreleased when checking", () => {
  fails(/version does not match/, "1.0.0", "--check");
  prepare();
  write("CHANGELOG.md", read("CHANGELOG.md").replace("## [Unreleased]", "## [Unreleased]\n\nUntested change."));
  commit();
  fails(/Unreleased is not empty/, "1.0.0", "--check");
});

test("rejects empty preparation and duplicate release sections", () => {
  write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n");
  commit();
  fails(/Unreleased is empty/, "1.0.0");
  write("CHANGELOG.md", "## [Unreleased]\n\nChanges\n\n## [1.0.0] - 2026-01-01\n\nAlready prepared\n");
  commit();
  fails(/already exists/, "1.0.0");
});

test("checks main identity, refuses divergent tags and allows retry of the same immutable tag", () => {
  prepare();
  fails(/origin\/main/, "1.0.0", "--check", "--require-main");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  passes("1.0.0", "--check", "--require-main");
  git("tag", "-a", "v1.0.0", "-m", "first release");
  passes("1.0.0", "--check", "--require-main");
  const tagCommit = git("rev-parse", "v1.0.0^{commit}");
  write("business.txt", "later work"); commit();
  fails(/origin\/main tip/, "1.0.0", "--check", "--require-main");
  fails(/already names another commit/, "1.0.0", "--check");
  assert.equal(git("rev-parse", "v1.0.0^{commit}"), tagCommit);
});

test("requires major actions, compares numeric versions and ignores deploy tags", () => {
  git("tag", "v1.9.0"); git("tag", "deploy/staging/999");
  fails(/must follow/, "1.8.0");
  fails(/Action required/, "2.0.0");
  passes("1.10.0", "--dry-run");
  write("CHANGELOG.md", read("CHANGELOG.md") + "\n### Action required\n\nMigrate the old API; run app tests.\n");
  commit();
  passes("2.0.0"); commit();
  passes("2.0.0", "--check");
});

test("release notes exclude older releases and comparison links", () => {
  git("tag", "v0.9.0");
  write("CHANGELOG.md", read("CHANGELOG.md") + "\n## [0.9.0] - 2026-01-01\n\nOlder notes\n\n[Unreleased]: https://example.com/old\n[0.9.0]: https://example.com/older\n");
  commit();
  // This is a major transition, so the action note must be in the new section.
  fails(/Action required/, "1.0.0");
  write("CHANGELOG.md", read("CHANGELOG.md").replace("### Added", "### Action required\n\nVerify existing apps.\n\n### Added"));
  commit(); prepare();
  const notes = passes("1.0.0", "--notes");
  assert.doesNotMatch(notes, /Older notes|https:/);
  assert.match(read("CHANGELOG.md"), /compare\/v0\.9\.0\.\.\.v1\.0\.0/);
});

test("downstream discovery preserves the app's own v1.0.0 tag and merges the starter source", () => {
  const base = git("rev-parse", "HEAD");
  prepare();
  write("platform-fix.txt", "starter security fix\n"); commit();
  git("branch", "main");
  git("tag", "-a", "v1.0.0", "-m", "verified fixture release");
  const target = git("rev-parse", "HEAD");
  const app = mkdtempSync(path.join(os.tmpdir(), "starter-downstream-"));
  const appGit = (...args: string[]): string => execFileSync("git", ["-C", app, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    appGit("init", "-qb", "main");
    appGit("config", "user.name", "Business App");
    appGit("config", "user.email", "app@example.com");
    appGit("remote", "add", "upstream", repo);
    appGit("fetch", "--no-tags", "upstream", base);
    appGit("merge", "--ff-only", "FETCH_HEAD");
    writeFileSync(path.join(app, "orders.txt"), "business rules and configuration\n");
    appGit("add", "."); appGit("commit", "-qm", "customize app");
    appGit("tag", "v1.0.0");
    const appVersion = appGit("rev-parse", "v1.0.0");
    appGit("fetch", "upstream", "--no-tags", "refs/heads/main:refs/remotes/upstream/main", "refs/tags/v*:refs/tags/starter/v*");
    assert.equal(appGit("rev-parse", "refs/tags/starter/v1.0.0^{commit}"), target);
    assert.equal(appGit("rev-parse", "v1.0.0"), appVersion);
    appGit("merge", "--no-edit", "refs/tags/starter/v1.0.0");
    assert.equal(readFileSync(path.join(app, "orders.txt"), "utf8"), "business rules and configuration\n");
    assert.equal(readFileSync(path.join(app, "platform-fix.txt"), "utf8"), "starter security fix\n");
    assert.equal(appGit("status", "--porcelain"), "");
  } finally { rmSync(app, { recursive: true, force: true }); }
});
