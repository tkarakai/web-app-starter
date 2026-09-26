import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "ensure local deps "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "platform/tooling"), { recursive: true });
  mkdirSync(join(root, "bin"));
  for (const name of ["ensure-local-deps.sh", "setup-e2e.sh"]) {
    copyFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), join(root, "platform/tooling", name));
  }
  writeFileSync(join(root, "package.json"), '{"packageManager": "bun@1.4.2"}');
  writeFileSync(join(root, "bin/bun"), '#!/bin/bash\necho 1.4.2\n', { mode: 0o755 });
  // A package runner cannot resolve a workspace-only install from the root.
  writeFileSync(join(root, "bin/npx"), '#!/bin/bash\necho "playwright: command not found" >&2\nexit 127\n', { mode: 0o755 });
  symlinkSync(process.execPath, join(root, "bin/node"));
  return {
    root,
    install(location: string, source: string) {
      const cli = join(root, location, "node_modules/@playwright/test/cli.js");
      mkdirSync(dirname(cli), { recursive: true });
      writeFileSync(cli, source);
    },
    run(name = "setup-e2e.sh") {
      return spawnSync("/bin/bash", [join(root, "platform/tooling", name), ...(name === "ensure-local-deps.sh" ? ["--quiet"] : [])], {
        cwd: tmpdir(),
        env: { ...process.env, PATH: `${join(root, "bin")}:/usr/bin:/bin`, CI_BUN_VERSION_CHECKED: "1" },
        encoding: "utf8",
        timeout: 10_000,
      });
    },
  };
}

for (const location of ["apps/web", "platform/apps/admin", "apps/landing", "apps/landing-static", "platform/apps/storybook", "."]) {
  test(`E2E setup installs Chromium using Playwright in ${location}`, (t) => {
    const checkout = fixture(t);
    checkout.install(location, `require("node:fs").writeFileSync("invocation.json", JSON.stringify(process.argv.slice(2)));`);
    const result = checkout.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(checkout.root, "invocation.json"), "utf8")), ["install", "chromium"]);
  });
}

test("E2E setup reports installer errors and preserves the exit status", (t) => {
  const checkout = fixture(t);
  checkout.install("apps/web", 'console.error("Browser download failed"); process.exit(42);');
  const result = checkout.run();
  assert.equal(result.status, 42);
  assert.match(result.stderr, /Browser download failed/);
});

test("E2E setup explains missing dependencies", (t) => {
  const result = fixture(t).run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run 'bun install'/);
});

test("E2E setup installs browsers for every workspace's Playwright version", (t) => {
  const checkout = fixture(t);
  for (const app of ["web", "admin"]) {
    checkout.install(app === "admin" ? "platform/apps/admin" : `apps/${app}`, `require("node:fs").appendFileSync("invocations.txt", "${app}\\n");`);
  }
  const result = checkout.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(join(checkout.root, "invocations.txt"), "utf8").trim().split("\n").sort(), ["admin", "web"]);
});

test("dev dependency checks never invoke browser installation", (t) => {
  const checkout = fixture(t);
  checkout.install("apps/web", 'require("node:fs").writeFileSync("browser-invoked", ""); process.exit(42);');
  const result = checkout.run("ensure-local-deps.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(checkout.root, "browser-invoked")), false);
});
