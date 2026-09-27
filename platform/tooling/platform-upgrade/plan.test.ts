import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { gitText } from "./git.ts";
import { fixture, write, git } from "./fixtures.ts";
test("read-only planning merges app customization, removes retired platform files and preserves app/index/refs", async () => {
  const f = fixture();
  write(f.source, "app.config.ts", fs.readFileSync(path.join(f.source, "app.config.ts"), "utf8").replace("'old'", "'new'"));
  fs.unlinkSync(path.join(f.source, "platform/obsolete.ts")); write(f.source, "platform/feature.ts", "export const feature = 'new';\n"); f.publish("2.0.1");
  const before = { status: git(f.app, "status", "--porcelain"), refs: git(f.app, "show-ref"), index: git(f.app, "write-tree"), config: fs.readFileSync(path.join(f.app, "app.config.ts"), "utf8") };
  const result = await f.plan("2.0.1");
  assert.deepEqual(result.plan.gates, []);
  const config = result.payloads.find(row => row.path === "app.config.ts"); assert(config && !("remove" in config));
  assert.match(config.content.toString(), /my business/); assert.match(config.content.toString(), /'new'/);
  assert(result.payloads.some(row => row.path === "platform/obsolete.ts" && "remove" in row));
  assert(!result.payloads.some(row => row.path === "apps/web/business.ts"));
  assert(!JSON.stringify(result.plan).includes("secret-fixture-value"));
  assert.deepEqual({ status: git(f.app, "status", "--porcelain"), refs: git(f.app, "show-ref"), index: git(f.app, "write-tree"), config: fs.readFileSync(path.join(f.app, "app.config.ts"), "utf8") }, before);
});
test("skipped releases pin ordered codemods once, using each release implementation without running them", async () => {
  const f = fixture();
  write(f.source, "platform/tooling/codemods/first.ts", "throw new Error('not during planning');\n");
  f.publish("2.1.0", entry => { entry.codemods.push({ id: "first", path: "platform/tooling/codemods/first.ts", touches: ["apps/"] }); });
  write(f.source, "platform/tooling/codemods/second.ts", "throw new Error('also not during planning');\n");
  f.publish("2.2.0", entry => { entry.codemods.push(...f.manifest.releases[1].codemods, { id: "second", path: "platform/tooling/codemods/second.ts", touches: ["apps/"] }); });
  const { plan } = await f.plan("2.2.0");
  assert.deepEqual(plan.codemods.map(row => [row.id, row.release]), [["first", "2.1.0"], ["second", "2.2.0"]]);
  assert.equal(plan.releases.length, 2); assert(plan.releases.every(row => /^[0-9a-f]{40}$/.test(row.commit)));
});
test("patches, removed env usage, dynamic env and new secrets produce specific review items", async () => {
  const f = fixture(); const file = "platform/feature.ts";
  write(f.app, file, "// PLATFORM-PATCH: business fix\nexport const feature = 'custom';\n");
  write(f.app, ".platform-base.json", JSON.stringify({ version: "2.0.0", commit: f.commit, patches: [{ path: file, reason: "business fix" }] }));
  write(f.app, "apps/web/env.ts", "process.env.OLD; process.env[key];\n"); git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "patch and env");
  f.publish("2.0.1", entry => { entry.env.push({ name: "OLD", kind: "removed", secret: false, required: false }, { name: "TOKEN", kind: "new", secret: true, required: true }); });
  const { plan } = await f.plan("2.0.1");
  assert.deepEqual(plan.gates.map(row => row.kind).sort(), ["dynamic-env", "new-secret", "patch", "removed-env"]);
  assert.match(plan.patches[0].baseToApp, /business fix/); assert.equal(plan.patches[0].absorbed, false);
});
test("optional app deletion stays deleted, while a deleted required seam needs review", async () => {
  const f = fixture();
  f.manifest.seams.push({ id: "optional", path: "apps/landing/package.json", hooks: [], optionalApp: "apps/landing" });
  write(f.source, "apps/landing/package.json", '{"name":"optional"}\n');
  fs.unlinkSync(path.join(f.app, "app.config.ts")); git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "deleted seam"); f.publish("2.0.1");
  const { plan, payloads } = await f.plan("2.0.1");
  assert(!payloads.some(row => row.path.startsWith("apps/landing/")));
  assert(plan.gates.some(row => row.id === "seam:app.config.ts"));
});
test("floors raise a lower same-major app declaration without lowering a higher one", async () => {
  const f = fixture(); f.publish("2.0.1", entry => { entry.dependencyFloors.push({ path: "package.json", name: "example", minimum: "2.1.0" }); });
  const result = await f.plan("2.0.1"); const pkg = result.payloads.find(row => row.path === "package.json"); assert(pkg && !("remove" in pkg));
  assert.equal(JSON.parse(pkg.content.toString()).dependencies.example, "^2.1.0");
  write(f.app, "package.json", '{"name":"app","dependencies":{"example":"^2.5.0"}}\n'); git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "newer app dependency");
  const higher = await f.plan("2.0.1"); assert(!higher.payloads.some(row => row.path === "package.json"));
});
test("seam conflicts remain labeled, and dirty or mismatched baselines cannot be planned", async () => {
  const f = fixture(); write(f.source, "app.config.ts", "export const brand = 'upstream change';\n"); f.publish("2.0.1");
  const result = await f.plan("2.0.1"); const config = result.payloads.find(row => row.path === "app.config.ts"); assert(config && !("remove" in config));
  assert.match(config.content.toString(), /<<<<<<< app/); assert(result.plan.gates.some(row => row.kind === "seam-conflict"));
  write(f.app, "apps/web/business.ts", "unfinished work\n"); await assert.rejects(() => f.plan("2.0.1"), /Commit or stash/);
  git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "more app work");
  write(f.app, ".platform-base.json", JSON.stringify({ version: "2.0.0", commit: gitText(f.app, ["rev-parse", "HEAD"]), patches: [] }));
  git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "wrong record"); await assert.rejects(() => f.plan("2.0.1"), /version\/commit/);
});
test("root overrides cannot undercut an app dependency floor", async () => {
  const f = fixture(); write(f.app, "package.json", '{"name":"app","overrides":{"example":"2.0.0"}}\n');
  write(f.app, "apps/web/package.json", '{"name":"web","dependencies":{"example":"^2.0.0"}}\n'); git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "app override");
  f.publish("2.0.1", entry => { entry.dependencyFloors.push({ path: "apps/web/package.json", name: "example", minimum: "2.1.0" }); });
  const { payloads, plan } = await f.plan("2.0.1"); const root = payloads.find(row => row.path === "package.json"); assert(root && !("remove" in root));
  assert.equal(JSON.parse(root.content.toString()).overrides.example, "2.1.0"); assert.equal(plan.dependencies.length, 2);
});
