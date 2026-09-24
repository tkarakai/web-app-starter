/**
 * Run with: bun run test:dev-scripts
 *
 * Exercises scripts/resolve-i18n-conflicts.ts against real git merge conflicts in
 * real locale files, because the failure it exists to prevent — "keep both sides"
 * producing invalid JSON — is only visible in a genuine three-stage merge.
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { conflictedMessageFiles, main } from "../resolve-i18n-conflicts.ts";

type Messages = Record<string, Record<string, string>>;

const MESSAGES = "packages/i18n/messages";
const BASE: Messages = {
  common: { appName: "Web App Starter", save: "Save", note: "Note" },
  auth: { signIn: "Sign in" },
};

let repo: string, locale: string;
const cwd = process.cwd();

function write(file: string, data: Messages): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function copy(data: Messages): Messages {
  return JSON.parse(JSON.stringify(data)) as Messages;
}
function mergeUpstream(): void {
  const result = spawnSync("git", ["-C", repo, "merge", "upstream"], { encoding: "utf8" });
  assert.notEqual(result.status, 0, "expected the locale file to conflict");
}

// Builds a two-branch repo whose locale file conflicts.
beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "i18n-merge-")));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");

  locale = path.join(repo, MESSAGES, "en.json");
  write(locale, BASE);
  git("add", "-A");
  git("commit", "-qm", "base");

  // upstream: a new platform namespace and a new key inside `common`
  git("checkout", "-q", "-b", "upstream");
  const theirs = copy(BASE);
  theirs.common.securityNotice = "Security";
  theirs.security = { title: "Security", revoke: "Revoke" };
  write(locale, theirs);
  git("commit", "-qam", "upstream keys");

  // downstream: its own namespace, its own key, and a rebrand
  git("checkout", "-q", "main");
  const ours = copy(BASE);
  ours.common.appName = "Northwind Fleet";
  ours.common.depot = "Depot";
  ours.fleet = { title: "Fleet", vehicles: "Vehicles" };
  write(locale, ours);
  git("commit", "-qam", "app keys");

  process.chdir(repo);
});

afterEach(() => {
  process.chdir(cwd);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("merges both sides and keeps the file valid JSON", () => {
  mergeUpstream();

  assert.deepEqual(conflictedMessageFiles(), [`${MESSAGES}/en.json`]);
  assert.equal(main([]), 0);

  const merged = JSON.parse(fs.readFileSync(locale, "utf8")) as Messages; // the whole point: still JSON

  // additions from both sides survive
  assert.deepEqual(merged.fleet, { title: "Fleet", vehicles: "Vehicles" });
  assert.deepEqual(merged.security, { title: "Security", revoke: "Revoke" });
  assert.equal(merged.common.depot, "Depot");
  assert.equal(merged.common.securityNotice, "Security");

  // a value only the app changed stays the app's
  assert.equal(merged.common.appName, "Northwind Fleet");

  // untouched keys are untouched
  assert.deepEqual(merged.auth, { signIn: "Sign in" });

  // and the file is staged, so `git commit` completes the merge
  assert.match(git("diff", "--name-only", "--cached"), new RegExp(`${MESSAGES}/en.json`));
});

test("reports keys both sides changed and keeps ours", () => {
  // upstream edits a key the app also rebranded
  git("checkout", "-q", "upstream");
  const theirs = JSON.parse(fs.readFileSync(locale, "utf8")) as Messages;
  theirs.common.appName = "Web App Starter Platform";
  write(locale, theirs);
  git("commit", "-qam", "upstream rebrand");
  git("checkout", "-q", "main");

  mergeUpstream();
  assert.equal(main([]), 1); // needs a human

  const merged = JSON.parse(fs.readFileSync(locale, "utf8")) as Messages;
  assert.equal(merged.common.appName, "Northwind Fleet");
});

test("check mode writes nothing", () => {
  mergeUpstream();
  const before = fs.readFileSync(locale, "utf8");

  assert.equal(main(["--check"]), 0);
  assert.equal(fs.readFileSync(locale, "utf8"), before);
  assert.ok(before.includes("<<<<<<<"));
});

test("is a no-op outside a merge", () => {
  assert.deepEqual(conflictedMessageFiles(), []);
  assert.equal(main([]), 0);
});
