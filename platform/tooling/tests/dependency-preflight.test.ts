import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";
import { checkWorkspace, developmentBinary } from "../local-dev-deps.ts";
import { realpathSync } from "node:fs";

const helper = new URL("../ensure-local-deps.sh", import.meta.url);
test("development preflight rejects ancestor binaries and external config plugins", t => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "local-dev-deps-")));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "checkout"), app = join(root, "apps/web");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "package.json"), '{"dependencies":{"next":"1","next-intl":"1"}}');
  const next = join(parent, "node_modules/next");
  mkdirSync(next, { recursive: true });
  writeFileSync(join(next, "package.json"), '{"name":"next","bin":"cli.cjs"}');
  writeFileSync(join(next, "cli.cjs"), "throw new Error('ancestor executable must never run');");
  assert.throws(() => developmentBinary(root, app, "next"), /outside this checkout/);
  mkdirSync(join(root, "node_modules"));
  symlinkSync(next, join(root, "node_modules/next"));
  assert.throws(() => developmentBinary(root, app, "next"), /outside this checkout/);
  rmSync(join(root, "node_modules/next"));
  mkdirSync(join(root, "node_modules/next"));
  copyFileSync(join(next, "package.json"), join(root, "node_modules/next/package.json"));
  writeFileSync(join(root, "node_modules/next/cli.cjs"), "console.log('local');");
  const intl = join(root, "node_modules/next-intl");
  mkdirSync(intl);
  writeFileSync(join(parent, "plugin.cjs"), "module.exports={};");
  writeFileSync(join(intl, "package.json"), '{"name":"next-intl","exports":{"./plugin":"./plugin.cjs"}}');
  symlinkSync(join(parent, "plugin.cjs"), join(intl, "plugin.cjs"));
  assert.throws(() => checkWorkspace(root, app), /outside this checkout/);
  rmSync(join(intl, "plugin.cjs"));
  writeFileSync(join(intl, "plugin.cjs"), "module.exports={};");
  // A fresh launcher process discards Node's cached realpath from the rejected plugin.
  const checked = spawnSync(process.execPath, ["--input-type=module", "-e", `import {checkWorkspace} from ${JSON.stringify(new URL("../local-dev-deps.ts", import.meta.url).href)}; checkWorkspace(${JSON.stringify(root)}, ${JSON.stringify(app)});`], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(developmentBinary(root, app, "next"), join(root, "node_modules/next/cli.cjs"));
});
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
