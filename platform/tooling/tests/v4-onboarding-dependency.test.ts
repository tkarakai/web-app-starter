import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { migrate } from "../codemods/v4-onboarding-dependency.ts";

test("older app upgrades install without adopting reference onboarding; custom packages survive", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v4-onboarding-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "old-app", private: true, workspaces: ["apps/*", "packages/*"] }));
  for (const app of ["web", "landing"]) {
    fs.mkdirSync(path.join(root, "apps", app), { recursive: true });
    fs.writeFileSync(path.join(root, "apps", app, "package.json"), JSON.stringify({ name: app, dependencies: { "@repo/onboarding": "workspace:*" } }));
    fs.writeFileSync(path.join(root, "apps", app, "next.config.ts"), 'export default { transpilePackages: ["@repo/onboarding", "custom-package"] };\n');
  }
  const install = () => spawnSync("bun", ["install", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
  const before = install(); assert.notEqual(before.status, 0); assert.match(before.stderr, /Workspace dependency "@repo\/onboarding" not found/);
  const manifest = path.join(root, "apps/web/package.json"), original = fs.readFileSync(manifest, "utf8");
  assert.equal(migrate(root, true).length, 4); assert.equal(fs.readFileSync(manifest, "utf8"), original);
  assert.equal(migrate(root).length, 4);
  const after = install(); assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.match(fs.readFileSync(path.join(root, "apps/web/next.config.ts"), "utf8"), /\["custom-package"\]/);
  assert.deepEqual(migrate(root), []); assert.deepEqual(migrate(root, true), []);
  fs.mkdirSync(path.join(root, "packages/onboarding"), { recursive: true });
  const custom = '{"name":"@repo/onboarding","private":true,"exports":{"./styles.css":"./custom.css"}}';
  fs.writeFileSync(path.join(root, "packages/onboarding/package.json"), custom);
  fs.writeFileSync(path.join(root, "packages/onboarding/custom.css"), "/* app branding */");
  fs.writeFileSync(manifest, original);
  assert.deepEqual(migrate(root), []); assert.equal(fs.readFileSync(manifest, "utf8"), original);
  assert.equal(fs.readFileSync(path.join(root, "packages/onboarding/package.json"), "utf8"), custom);
  assert.equal(install().status, 0);
});

test("missing consumers are optional and invalid targets fail before any writes", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v4-onboarding-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(migrate(root), []);
  fs.mkdirSync(path.join(root, "apps/web"), { recursive: true });
  const manifest = path.join(root, "apps/web/package.json"), original = '{"dependencies":{"@repo/onboarding":"workspace:*"}}';
  fs.writeFileSync(manifest, original);
  fs.symlinkSync(manifest, path.join(root, "apps/web/next.config.ts"));
  assert.throws(() => migrate(root)); assert.equal(fs.readFileSync(manifest, "utf8"), original);
});
