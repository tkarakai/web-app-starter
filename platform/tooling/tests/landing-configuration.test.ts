import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const helper = "apps/landing/qa/helpers/configuration-acceptance.ts";

test("adoption fixtures exclude transient CI state while retaining app source", {
  skip: !existsSync(path.join(root, helper)),
}, async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "landing-ci-exclusion-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source"), target = path.join(directory, "adopted");
  mkdirSync(source); mkdirSync(target);
  for (const name of [".ci-local-artifacts", ".ci-artifacts"]) {
    mkdirSync(path.join(source, name));
    writeFileSync(path.join(source, name, "private-state.json"), "disposable local state");
  }
  writeFileSync(path.join(source, "app.config.ts"), "export default {};");
  const fixture = await import(path.join(root, "apps/landing/qa/helpers/configuration-fixture.ts")) as { copyConfigurationFixture(source: string, target: string): void };
  fixture.copyConfigurationFixture(source, target);
  for (const name of [".ci-local-artifacts", ".ci-artifacts"]) assert.equal(existsSync(path.join(target, name)), false);
  assert.equal(readFileSync(path.join(target, "app.config.ts"), "utf8"), "export default {};");
});

test("adoption retains configuration-aware landing components and browser scenarios", {
  skip: !existsSync(path.join(root, helper)), timeout: 120_000,
}, () => {
  const output = execFileSync(path.join(root, "platform/tooling/node-ts.sh"), [helper, "--components"], {
    cwd: root, encoding: "utf8", timeout: 110_000,
  });
  assert.match(output, /PASS: adopted landing configuration matrix; source app.config.ts preserved/);
});
