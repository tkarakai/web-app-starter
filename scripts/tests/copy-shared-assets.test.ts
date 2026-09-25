import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

const apps = ["web", "admin", "landing", "landing-static", "storybook"];
const assets = ["icon.svg", "favicon.ico", "apple-touch-icon.png"];
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "starter branding "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  copyFileSync(new URL("../copy-shared-assets.sh", import.meta.url), join(root, "scripts/copy-shared-assets.sh"));
  const write = (name: string, contents: string) => {
    const file = join(root, name);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, contents);
  };
  for (const asset of assets) write(`packages/design-system/assets/${asset}`, `shared:${asset}`);
  const run = () => spawnSync("bash", [join(root, "scripts/copy-shared-assets.sh")], { encoding: "utf8", timeout: 5000 });
  const read = (name: string) => readFileSync(join(root, name), "utf8");
  return { root, write, run, read };
}

test("default apps receive shared assets, repeat runs are no-ops, demo stays application-owned", t => {
  const f = fixture(t);
  f.write("apps/demo/public/icon.svg", "demo");
  assert.equal(f.run().status, 0);
  for (const app of apps) for (const asset of assets) assert.equal(f.read(`apps/${app}/public/${asset}`), `shared:${asset}`);
  const before = statSync(join(f.root, "apps/web/public/icon.svg")).mtimeMs;
  const repeat = f.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /already up to date/);
  assert.equal(statSync(join(f.root, "apps/web/public/icon.svg")).mtimeMs, before);
  assert.equal(f.read("apps/demo/public/icon.svg"), "demo");
  assert.equal(existsSync(join(f.root, "apps/demo/public/favicon.ico")), false);
});

test("app-owned overrides survive shared updates, with per-file fallback and app isolation", t => {
  const f = fixture(t);
  f.write("apps/web/branding/icon.svg", "business icon");
  assert.equal(f.run().status, 0);
  assert.equal(f.read("apps/web/public/icon.svg"), "business icon");
  assert.equal(f.read("apps/web/public/favicon.ico"), "shared:favicon.ico");
  assert.equal(f.read("apps/admin/public/icon.svg"), "shared:icon.svg");
  f.write("packages/design-system/assets/icon.svg", "new shared icon");
  assert.equal(f.run().status, 0);
  assert.equal(f.read("apps/web/public/icon.svg"), "business icon");
  assert.equal(f.read("apps/web/branding/icon.svg"), "business icon");
  assert.equal(f.read("apps/admin/public/icon.svg"), "new shared icon");
  f.write("apps/web/branding/icon.svg", "new business icon");
  assert.equal(f.run().status, 0);
  assert.equal(f.read("apps/web/public/icon.svg"), "new business icon");
  rmSync(join(f.root, "apps/web/branding/icon.svg"));
  assert.equal(f.run().status, 0);
  assert.equal(f.read("apps/web/public/icon.svg"), "new shared icon");
});

test("invalid override fails preflight without modifying any app output", t => {
  const f = fixture(t);
  f.write("apps/web/public/icon.svg", "preserved");
  mkdirSync(join(f.root, "apps/storybook/branding/icon.svg"), { recursive: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /branding/);
  assert.equal(f.read("apps/web/public/icon.svg"), "preserved");
  assert.equal(existsSync(join(f.root, "apps/admin/public/icon.svg")), false);
});

for (const kind of ["file-directory", "linked-directory", "linked-file", "dangling-link"] as const) {
  test(`invalid branding ${kind} is refused before copying`, t => {
    const f = fixture(t);
    f.write("apps/web/public/icon.svg", "preserved");
    const branding = join(f.root, "apps/web/branding");
    if (kind === "file-directory") f.write("apps/web/branding", "not a directory");
    else if (kind === "linked-directory") symlinkSync(join(f.root, "packages/design-system/assets"), branding);
    else {
      mkdirSync(branding);
      symlinkSync(join(f.root, kind === "linked-file" ? "packages/design-system/assets/icon.svg" : "absent"), join(branding, "icon.svg"));
    }
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /branding/);
    assert.equal(f.read("apps/web/public/icon.svg"), "preserved");
  });
}
