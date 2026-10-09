import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { adoptionRelease, commandAt, type Command } from "../adopt-release.ts";
import { adopt } from "../adopt.ts";

test("adoption verifies remote publication, rejects arbitrary HEAD, and accepts an intact merged release", t => {
  const root = mkdtempSync(path.join(tmpdir(), "adopt-release-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim();
  mkdirSync(path.join(root, "platform"));
  writeFileSync(path.join(root, "platform/VERSION"), "2.0.1\n");
  git("init", "-q"); git("add", "."); git("commit", "-qm", "release");
  const commit = git("rev-parse", "HEAD");
  let published = true;
  const run: Command = (command, args) => {
    if (command === "gh") return JSON.stringify({ draft: !published, prerelease: false, tag_name: "v2.0.1" });
    if (args[0] === "ls-remote") return `${"f".repeat(40)}\trefs/tags/v2.0.1\n${commit}\trefs/tags/v2.0.1^{}`;
    return commandAt(root)(command, args);
  };
  assert.deepEqual(adoptionRelease(root, undefined, run), { version: "2.0.1", commit });
  published = false;
  assert.throws(() => adoptionRelease(root, undefined, run), /Cannot verify published release/);
  published = true;
  writeFileSync(path.join(root, "app.txt"), "existing app\n");
  git("add", "."); git("commit", "-qm", "app history");
  assert.throws(() => adoptionRelease(root, undefined, run), /HEAD is not the published/);
  assert.deepEqual(adoptionRelease(root, "v2.0.1", run), { version: "2.0.1", commit });
  assert.throws(() => adoptionRelease(root, "v2.0.0", run), /matching platform\/VERSION/);
  writeFileSync(path.join(root, "platform/extra.ts"), "local platform change");
  git("add", "."); git("commit", "-qm", "invalid source");
  assert.throws(() => adoptionRelease(root, "v2.0.1", run), /Platform source differs/);
});

test("adoption rejects a rename out of the platform zone before changing app files", t => {
  const root = mkdtempSync(path.join(tmpdir(), "adopt-release-rename-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim();
  mkdirSync(path.join(root, "platform"));
  mkdirSync(path.join(root, "apps/landing"), { recursive: true });
  writeFileSync(path.join(root, "platform/VERSION"), "2.0.1\n");
  writeFileSync(path.join(root, "platform/owned.ts"), "export const required = true;\n");
  writeFileSync(path.join(root, "apps/landing/package.json"), "{}\n");
  const config = readFileSync(new URL("./fixtures/adopt/app.config.ts.txt", import.meta.url), "utf8");
  writeFileSync(path.join(root, "app.config.ts"), config);
  writeFileSync(path.join(root, "README.md"), "Existing app documentation\n");
  git("init", "-q"); git("config", "diff.renames", "true");
  git("add", "."); git("commit", "-qm", "release");
  const commit = git("rev-parse", "HEAD");
  git("mv", "platform/owned.ts", "app-owned.ts"); git("commit", "-qm", "move out of platform");
  assert.equal(git("diff", "--name-only", "-z", commit, "HEAD"), "app-owned.ts\0");
  const run: Command = (command, args) => {
    if (command === "gh") return JSON.stringify({ draft: false, prerelease: false, tag_name: "v2.0.1" });
    if (args[0] === "ls-remote") return `${commit}\trefs/tags/v2.0.1`;
    return commandAt(root)(command, args);
  };
  git("switch", "-c", "adopt/acme");
  const preflight: Command = (command, args) => command === "gh"
    ? JSON.stringify({ full_name: "acme/app", default_branch: "main" }) : commandAt(root)(command, args);
  const lines: string[] = [];
  assert.throws(() => adopt(root, { name: "Acme", repo: "acme/app", fromRelease: "v2.0.1", install: false, build: false },
    line => lines.push(line), { release: (directory, from) => adoptionRelease(directory, from, run), command: preflight }),
  /Platform source differs from v2\.0\.1: platform\/owned\.ts/);
  assert.deepEqual(lines, []);
  assert.equal(readFileSync(path.join(root, "app.config.ts"), "utf8"), config);
  assert.equal(readFileSync(path.join(root, "README.md"), "utf8"), "Existing app documentation\n");
  assert.equal(existsSync(path.join(root, ".platform-base.json")), false);
  assert.equal(git("status", "--porcelain"), "");
});
