import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const apps = ["apps/web", "platform/apps/admin", "apps/landing", "apps/landing-static", "platform/apps/storybook"];
const assets = ["icon.svg", "favicon.ico", "apple-touch-icon.png"];

/** A disposable checkout with the real script, config reader and config. */
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "starter branding "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name: string, contents: string) => {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  };
  for (const name of [
    "platform/tooling/copy-shared-assets.sh",
    "platform/tooling/node-ts.sh",
    "platform/tooling/app-config.ts",
    "app.config.ts",
    "platform/packages/app-config/src/schema.ts",
    "package.json",
  ]) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    copyFileSync(join(repo, name), join(root, name));
  }
  for (const asset of assets) write(`platform/packages/design-system/assets/${asset}`, `shared:${asset}`);
  const run = () => spawnSync("bash", [join(root, "platform/tooling/copy-shared-assets.sh")], { encoding: "utf8", timeout: 10_000 });
  const read = (name: string) => readFileSync(join(root, name), "utf8");
  const configure = (from: string, to: string) => {
    const config = read("app.config.ts");
    assert.ok(config.includes(from), `app.config.ts has ${from}`);
    write("app.config.ts", config.replace(from, to));
  };
  return { root, write, run, read, configure };
}

test("apps receive the configured icons, repeat runs are no-ops, demo stays application-owned", (t) => {
  const f = fixture(t);
  f.write("apps/demo/public/icon.svg", "demo");
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  for (const app of apps) for (const asset of assets) assert.equal(f.read(`${app}/public/${asset}`), `shared:${asset}`);
  const before = statSync(join(f.root, "apps/web/public/icon.svg")).mtimeMs;
  const repeat = f.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /already up to date/);
  assert.equal(statSync(join(f.root, "apps/web/public/icon.svg")).mtimeMs, before);
  assert.equal(f.read("apps/demo/public/icon.svg"), "demo");
  assert.equal(existsSync(join(f.root, "apps/demo/public/favicon.ico")), false);
});

test("an app-owned icon named in app.config.ts replaces the starter's", (t) => {
  const f = fixture(t);
  f.write("branding/acme.svg", "acme icon");
  f.configure('svg: "platform/packages/design-system/assets/icon.svg"', 'svg: "branding/acme.svg"');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  for (const app of apps) {
    assert.equal(f.read(`${app}/public/icon.svg`), "acme icon");
    assert.equal(f.read(`${app}/public/favicon.ico`), "shared:favicon.ico");
  }
});

test("a missing icon source fails before any app output changes", (t) => {
  const f = fixture(t);
  f.write("apps/web/public/icon.svg", "preserved");
  f.configure('svg: "platform/packages/design-system/assets/icon.svg"', 'svg: "branding/missing.svg"');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /branding\/missing\.svg/);
  assert.equal(f.read("apps/web/public/icon.svg"), "preserved");
  assert.equal(existsSync(join(f.root, "platform/apps/admin/public/icon.svg")), false);
});

test("an invalid app.config.ts stops the copy", (t) => {
  const f = fixture(t);
  f.configure('svg: "platform/packages/design-system/assets/icon.svg"', 'svg: "../outside.svg"');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /brand\.icons\.svg/);
  assert.equal(existsSync(join(f.root, "apps/web/public/icon.svg")), false);
});
