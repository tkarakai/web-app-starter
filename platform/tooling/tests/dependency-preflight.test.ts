import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";

const helper = new URL("../ensure-local-deps.sh", import.meta.url);
for (const state of ["fresh", "stale", "broken", "symlinked"]) test(`frozen preflight repairs ${state} workspace installation without changing the lock`, t => {
  const root = mkdtempSync(join(tmpdir(), "dependency-preflight-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "platform/tooling"), { recursive: true }); copyFileSync(helper, join(root, "platform/tooling/ensure-local-deps.sh"));
  mkdirSync(join(root, "packages/library"), { recursive: true }); mkdirSync(join(root, "apps/web"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, packageManager: "bun@1.4.2", workspaces: ["apps/*", "packages/*"] }));
  writeFileSync(join(root, "packages/library/package.json"), '{"name":"@repo/library","exports":{"./styles.css":"./styles.css"}}');
  writeFileSync(join(root, "packages/library/styles.css"), ".proof {}");
  writeFileSync(join(root, "apps/web/package.json"), '{"name":"@repo/web"}');
  execFileSync("bun", ["install"], { cwd: root, stdio: "pipe" });
  writeFileSync(join(root, "apps/web/package.json"), '{"name":"@repo/web","dependencies":{"@repo/library":"workspace:*"}}');
  execFileSync("bun", ["install", "--lockfile-only"], { cwd: root, stdio: "pipe" });
  const lock = readFileSync(join(root, "bun.lock"), "utf8"), link = join(root, "apps/web/node_modules/@repo/library");
  if (state === "fresh") rmSync(join(root, "node_modules"), { recursive: true, force: true });
  if (state === "broken") { mkdirSync(join(root, "apps/web/node_modules/@repo"), { recursive: true }); symlinkSync("/missing-preflight-fixture", link); }
  if (state === "symlinked") { const foreign = join(root, "foreign-install"); mkdirSync(foreign); writeFileSync(join(foreign, "keep"), "safe"); rmSync(join(root, "node_modules"), { recursive: true, force: true }); symlinkSync(foreign, join(root, "node_modules")); }
  const result = spawnSync("bash", [join(root, "platform/tooling/ensure-local-deps.sh"), "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(createRequire(join(root, "apps/web/package.json")).resolve("@repo/library/styles.css"));
  assert.equal(readFileSync(join(root, "bun.lock"), "utf8"), lock);
  if (state === "symlinked") assert.equal(readFileSync(join(root, "foreign-install/keep"), "utf8"), "safe");
  // Warm cache and unchanged manifests remain a valid frozen install.
  assert.equal(spawnSync("bun", ["install", "--offline", "--frozen-lockfile"], { cwd: root }).status, 0);
  writeFileSync(join(root, "apps/web/package.json"), '{"name":"@repo/web","dependencies":{"@repo/library":"workspace:*","does-not-exist-preflight-fixture":"1.0.0"}}');
  const failed = spawnSync("bash", [join(root, "platform/tooling/ensure-local-deps.sh"), "--quiet"], { cwd: root, encoding: "utf8", timeout: 10_000 });
  assert.notEqual(failed.status, 0);
  assert.equal(readFileSync(join(root, "bun.lock"), "utf8"), lock);
  assert.equal(existsSync(join(root, ".dev-pids")), false);
});
