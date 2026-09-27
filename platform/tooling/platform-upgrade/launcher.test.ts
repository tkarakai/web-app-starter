import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixture, git, temp, write } from "./fixtures.ts";
import { readReport } from "./report.ts";
import { ENTRY, MANIFEST } from "./metadata.ts";
import { REQUIRED_CHECKS } from "./verify.ts";

const tooling = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("stable launcher runs the pinned target tool; real dry-run, apply and resume share the protocol", () => {
  const f = fixture();
  for (const file of fs.readdirSync(path.join(tooling, "platform-upgrade"))) {
    if ((!file.endsWith(".ts") && file !== "protocol.json") || file.endsWith(".test.ts") || file === "fixtures.ts") continue;
    write(f.source, "platform/tooling/platform-upgrade/" + file, fs.readFileSync(path.join(tooling, "platform-upgrade", file), "utf8"));
  }
  write(f.source, "platform/tooling/check-zone.ts", fs.readFileSync(path.join(tooling, "check-zone.ts"), "utf8"));
  write(f.source, "platform/tooling/platform-upgrade.ts", fs.readFileSync(path.join(tooling, "platform-upgrade.ts"), "utf8"));
  const pkg = { name: "launcher-fixture", private: true, type: "module", scripts: Object.fromEntries(REQUIRED_CHECKS.map(script => [script, "node -e 'process.exit(0)' "])) };
  write(f.source, "package.json", JSON.stringify(pkg)); write(f.app, "package.json", JSON.stringify(pkg));
  f.manifest.runtime.nodeMajor = Number(process.versions.node.split(".")[0]);
  f.publish("2.0.1");
  // Use this release as the app's initial baseline, with an installed launcher.
  git(f.app, "fetch", "--quiet", f.source, "refs/tags/v2.0.1");
  git(f.app, "checkout", "FETCH_HEAD", "--", "platform");
  write(f.app, ".platform-base.json", JSON.stringify({ version: "2.0.1", commit: git(f.source, "rev-parse", "v2.0.1"), patches: [] }));
  git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "install launcher baseline");
  write(f.source, ENTRY, fs.readFileSync(path.join(f.source, ENTRY), "utf8") + '\nprocess.stdout.write("PINNED_TARGET_TOOL\\n");\n');
  write(f.source, "platform/feature.ts", "export const feature = 'target';\n"); f.publish("2.0.2");
  const file = path.join(temp(), "upgrade.json"), before = { refs: git(f.app, "show-ref"), index: git(f.app, "write-tree"), status: git(f.app, "status", "--porcelain") };
  const invoke = (args: string[], root = f.app) => spawnSync(process.execPath, [path.join(root, "platform/tooling/platform-upgrade.ts"), ...args], { cwd: root, encoding: "utf8", timeout: 120000 });
  const dry = invoke(["--to", "v2.0.2", "--source", f.source, "--dry-run", "--report", file]);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr); assert.match(dry.stdout, /PINNED_TARGET_TOOL/); assert.equal(readReport(file).outcome, "planned");
  assert.deepEqual({ refs: git(f.app, "show-ref"), index: git(f.app, "write-tree"), status: git(f.app, "status", "--porcelain") }, before);
  const pending = invoke(["--resume", file, "--defer-e2e"]); assert.equal(pending.status, 2, pending.stdout + pending.stderr); assert.equal(readReport(file).outcome, "needs-review");
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8")).version, "2.0.1");
  const originalDigest = readReport(file).plan.digest;
  fs.copyFileSync(file, path.join(f.app, "upgrade-report.json")); fs.copyFileSync(file.replace(/\.json$/, ".md"), path.join(f.app, "upgrade-report.md"));
  git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "deliver pending draft");
  const clone = temp(); git(clone, "clone", "-q", f.app, ".");
  const clonedReport = path.join(clone, "upgrade-report.json");
  const refused = invoke(["--resume", clonedReport], clone); assert.equal(refused.status, 1); assert.match(refused.stderr, /relocate/);
  const done = invoke(["--resume", clonedReport, "--relocate"], clone); assert.equal(done.status, 0, done.stdout + done.stderr); assert.equal(readReport(clonedReport).outcome, "verified");
  assert.equal(readReport(clonedReport).plan.digest, originalDigest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(clone, ".platform-base.json"), "utf8")).version, "2.0.2");
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8")).version, "2.0.1");
  const manifest = JSON.parse(fs.readFileSync(path.join(clone, MANIFEST), "utf8")); assert.equal(manifest.releases.at(-1).version, "2.0.2");
  const guard = invoke(["--to", "2.0.2", "--bootstrap-protocol", "1"]); assert.equal(guard.status, 1); assert.match(guard.stderr, /recursive delegation/);
});
