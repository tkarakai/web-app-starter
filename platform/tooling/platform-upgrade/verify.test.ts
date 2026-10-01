import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fixture, write, git } from "./fixtures.ts";
import { createReport } from "./report.ts";
import { verifyDependencies } from "./verify.ts";

async function overrideFixture() {
  const f = fixture();
  write(f.app, "package.json", JSON.stringify({ name: "app", workspaces: ["apps/*"], overrides: { example: "2.1.0" } }));
  write(f.app, "apps/web/package.json", JSON.stringify({ name: "web", dependencies: { example: "2.1.0" } }));
  git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "workspace override");
  f.publish("2.0.1", release => release.dependencyFloors.push({ path: "package.json", name: "example", minimum: "2.1.0" }));
  const { plan } = await f.plan("2.0.1");
  return { ...f, report: createReport(plan, {}) };
}

test("root override floors resolve isolated workspace installs, ignoring unused cache versions", async () => {
  const f = await overrideFixture();
  write(f.app, "node_modules/.bun/example@2.1.0/node_modules/example/package.json", '{"name":"example","version":"2.1.0"}');
  write(f.app, "node_modules/.bun/example@2.0.0/node_modules/example/package.json", '{"name":"example","version":"2.0.0"}');
  fs.mkdirSync(path.join(f.app, "apps/web/node_modules"), { recursive: true });
  fs.symlinkSync("../../../node_modules/.bun/example@2.1.0/node_modules/example", path.join(f.app, "apps/web/node_modules/example"));
  assert.doesNotThrow(() => verifyDependencies(f.report));
  write(f.app, "node_modules/.bun/example@2.1.0/node_modules/example/package.json", '{"name":"example","version":"2.0.0"}');
  assert.throws(() => verifyDependencies(f.report), /below its floor or missing: example/);
});

test("a good hoisted version cannot hide an older workspace resolution", async () => {
  const f = await overrideFixture();
  write(f.app, "node_modules/example/package.json", '{"name":"example","version":"2.1.0"}');
  write(f.app, "apps/admin/package.json", '{"name":"admin","dependencies":{"example":"2.0.0"}}');
  write(f.app, "apps/admin/node_modules/example/package.json", '{"name":"example","version":"2.0.0"}');
  assert.throws(() => verifyDependencies(f.report), /below its floor or missing: example/);
  write(f.app, "apps/admin/node_modules/example/package.json", '{"name":"example","version":"2.2.0"}');
  assert.doesNotThrow(() => verifyDependencies(f.report));
});

test("override floors inspect reachable transitive dependencies and reject missing installs", async () => {
  const f = await overrideFixture();
  assert.throws(() => verifyDependencies(f.report), /below its floor or missing: example/);
  write(f.app, "apps/web/package.json", '{"name":"web","dependencies":{"wrapper":"1.0.0"}}');
  write(f.app, "apps/web/node_modules/wrapper/package.json", '{"name":"wrapper","version":"1.0.0","dependencies":{"example":"2.0.0"}}');
  write(f.app, "apps/web/node_modules/wrapper/node_modules/example/package.json", '{"name":"example","version":"2.0.0"}');
  assert.throws(() => verifyDependencies(f.report), /below its floor or missing: example/);
  write(f.app, "apps/web/node_modules/wrapper/node_modules/example/package.json", '{"name":"example","version":"2.1.0"}');
  assert.doesNotThrow(() => verifyDependencies(f.report));
});
