import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import rawAppConfig from "../../../app.config.ts";
import { copyConfiguredIcons } from "./icon-fixture.ts";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const apps = ["apps/web", "platform/apps/admin", "apps/landing", "apps/landing-static", "platform/apps/storybook"];
const assets = { svg: "icon.svg", ico: "favicon.ico", appleTouchIcon: "apple-touch-icon.png" };

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
  copyConfiguredIcons(root, repo);
  const expected = Object.fromEntries(Object.entries(assets).map(([key, asset]) => [
    asset, readFileSync(join(root, rawAppConfig.brand.icons[key as keyof typeof assets])),
  ]));
  for (const app of apps) write(`${app}/package.json`, "{}");
  const run = () => spawnSync("bash", [join(root, "platform/tooling/copy-shared-assets.sh")], { encoding: "utf8", timeout: 10_000 });
  const read = (name: string) => readFileSync(join(root, name), "utf8");
  const configure = (icons: Partial<typeof rawAppConfig.brand.icons>) => {
    write("app.config.ts", `export default ${JSON.stringify({
      ...rawAppConfig, brand: { ...rawAppConfig.brand, icons: { ...rawAppConfig.brand.icons, ...icons } },
    })};\n`);
  };
  return { root, write, run, read, configure, expected };
}

test("apps receive the configured icons, repeat runs are no-ops, demo stays application-owned", (t) => {
  const f = fixture(t);
  f.write("apps/demo/public/icon.svg", "demo");
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  for (const app of apps) for (const asset of Object.values(assets)) assert.deepEqual(readFileSync(join(f.root, app, "public", asset)), f.expected[asset]);
  const before = statSync(join(f.root, "apps/web/public/icon.svg")).mtimeMs;
  const repeat = f.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /already up to date/);
  assert.equal(statSync(join(f.root, "apps/web/public/icon.svg")).mtimeMs, before);
  assert.equal(f.read("apps/demo/public/icon.svg"), "demo");
  assert.equal(existsSync(join(f.root, "apps/demo/public/favicon.ico")), false);
});

test("app-owned nested icons named in app.config.ts replace the starter's", (t) => {
  const f = fixture(t);
  const icons = { svg: "branding/nested/acme.svg", ico: "branding/nested/site.ico", appleTouchIcon: "branding/nested/touch.png" };
  for (const [key, source] of Object.entries(icons)) f.write(source, `custom:${key}`);
  f.configure(icons);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  for (const app of apps) for (const [key, asset] of Object.entries(assets)) {
    assert.equal(f.read(`${app}/public/${asset}`), `custom:${key}`);
  }
});

for (const key of Object.keys(assets) as (keyof typeof assets)[]) {
  test(`a missing ${key} source fails before any app output changes`, (t) => {
    const f = fixture(t);
    f.write("apps/web/public/icon.svg", "preserved");
    rmSync(join(f.root, rawAppConfig.brand.icons[key]));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`Source asset not found: ${rawAppConfig.brand.icons[key]}`));
    assert.equal(f.read("apps/web/public/icon.svg"), "preserved");
    assert.equal(existsSync(join(f.root, "platform/apps/admin/public/icon.svg")), false);
  });

  test(`an invalid ${key} path in app.config.ts stops the copy`, (t) => {
    const f = fixture(t);
    f.configure({ [key]: "../outside.svg" });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`brand.icons.${key}`));
    assert.equal(existsSync(join(f.root, "apps/web/public/icon.svg")), false);
  });
}

test("an app removed at adoption gets no assets", (t) => {
  const f = fixture(t);
  rmSync(join(f.root, "apps/landing"), { recursive: true, force: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(f.root, "apps/landing")), false);
  for (const asset of Object.values(assets)) {
    assert.deepEqual(readFileSync(join(f.root, "apps/web/public", asset)), f.expected[asset]);
  }
});
