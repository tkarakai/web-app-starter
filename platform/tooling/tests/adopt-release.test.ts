import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { adoptionRelease, commandAt, type Command } from "../adopt-release.ts";

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
