import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import rawAppConfig from "../../../app.config.ts";
import { configVariables, run, shellQuote } from "../app-config.ts";
import { validateAppConfig } from "../../packages/app-config/src/schema.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const config = validateAppConfig(rawAppConfig);

function customised(): typeof rawAppConfig {
  const copy = JSON.parse(JSON.stringify(rawAppConfig)) as typeof rawAppConfig;
  copy.identity.productName = "Acme's Cloud";
  copy.runtime.ports.web = 4101;
  copy.runtime.authCookiePrefix = "acme";
  return copy;
}

test("port and origin follow runtime.ports", () => {
  assert.equal(run(["port", "web"]), String(config.runtime.ports.web));
  assert.equal(run(["port", "web"], customised()), "4101");
  assert.equal(run(["origin", "web"], customised()), "http://localhost:4101");
  assert.equal(run(["port", "landing-static"]), String(config.runtime.ports["landing-static"]));
});

test("dir names each app's directory relative to the repository root", () => {
  assert.equal(run(["dir", "web"]), "apps/web");
  assert.equal(run(["dir", "admin"]), "platform/apps/admin");
  assert.equal(run(["dir", "storybook"]), "platform/apps/storybook");
  assert.throws(() => run(["dir", "demo"]), /expected an app name/);
  const variables = configVariables(config);
  assert.equal(variables.APP_CONFIG_DIR_LANDING_STATIC, "apps/landing-static");
  assert.equal(variables.APP_CONFIG_DIR_ADMIN, "platform/apps/admin");
});

test("get returns single values only", () => {
  assert.equal(run(["get", "runtime.authCookiePrefix"], customised()), "acme");
  assert.equal(run(["get", "features.waitlist"]), String(config.features.waitlist));
  assert.throws(() => run(["get", "runtime.ports"]), /not a single value/);
  assert.throws(() => run(["get", "identity.nope"]), /not a single value/);
  assert.throws(() => run(["get", "constructor"]), /not a single value/);
});

test("shell output survives eval, including quotes in values", () => {
  const output = run(["shell"], customised());
  const result = spawnSync(
    "bash",
    ["-c", `eval "$1"; printf '%s|%s|%s' "$APP_CONFIG_PRODUCT_NAME" "$APP_CONFIG_PORT_WEB" "$APP_CONFIG_ORIGIN_LANDING_STATIC"`, "_", output],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `Acme's Cloud|4101|http://localhost:${config.runtime.ports["landing-static"]}`);
  assert.equal(shellQuote("a'b"), `'a'\\''b'`);
});

test("github-env output is one KEY=value line per variable", () => {
  const lines = run(["github-env"]).split("\n");
  assert.equal(lines.length, Object.keys(configVariables(config)).length);
  for (const line of lines) assert.match(line, /^APP_CONFIG_[A-Z_]+=[^\n]+$/);
  assert.ok(lines.includes(`APP_CONFIG_ORIGIN_ADMIN=http://localhost:${config.runtime.ports.admin}`));
});

test("an invalid config fails before printing anything", () => {
  const broken = customised();
  broken.runtime.ports.admin = broken.runtime.ports.web;
  assert.throws(() => run(["port", "web"], broken), /runtime\.ports\.admin: port 4101 is already used/);
});

test("the CLI exits 2 on misuse and prints values on success", () => {
  const cli = (...args: string[]) =>
    spawnSync("./platform/tooling/node-ts.sh", ["platform/tooling/app-config.ts", ...args], { cwd: repoRoot, encoding: "utf8" });
  const ok = cli("port", "admin");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, `${config.runtime.ports.admin}\n`);
  assert.equal(ok.stderr, "");
  const bad = cli("port", "worker");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /expected an app name/);
});
