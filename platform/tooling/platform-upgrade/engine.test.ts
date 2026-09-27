import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fixture, git, temp, write } from "./fixtures.ts";
import { createCache } from "./git.ts";
import { applyUpgrade, reconstruct } from "./engine.ts";
import { createReport, readReport, recordDecision, writeReport } from "./report.ts";
import { workingFiles } from "./plan.ts";
import { materializePayloads, preflight } from "./files.ts";
import { REQUIRED_CHECKS } from "./verify.ts";
import { childEnvironment, execute, type Execute } from "./commands.ts";
import { MANIFEST } from "./metadata.ts";

function runnable() {
  const f = fixture();
  const pkg = { name: "app", scripts: Object.fromEntries(REQUIRED_CHECKS.map(script => [script, "node -e 'process.exit(0)' "])) };
  write(f.source, "package.json", JSON.stringify(pkg)); write(f.app, "package.json", JSON.stringify(pkg));
  git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "app check commands");
  return f;
}
const pass: Execute = async () => ({ exitCode: 0, log: "passed" });
function reportFor(planned: Awaited<ReturnType<ReturnType<typeof fixture>["plan"]>>) {
  const report = createReport(planned.plan, workingFiles(planned.plan.app.root)); const reportFile = path.join(temp(), "report.json"); writeReport(reportFile, report); return { report, reportFile };
}
test("verified update preserves app work/modes/links and advances baseline only after required commands", async () => {
  const f = runnable(); write(f.source, "platform/tool.sh", "#!/bin/sh\nexit 0\n"); fs.chmodSync(path.join(f.source, "platform/tool.sh"), 0o755);
  fs.symlinkSync("tool.sh", path.join(f.source, "platform/link")); fs.unlinkSync(path.join(f.source, "platform/obsolete.ts")); f.publish("2.0.1");
  const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned), before = fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8"), calls: string[][] = [];
  const result = await applyUpgrade(report, planned, { reportFile, execute: async (args, cwd) => {
    assert.equal(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8"), before); calls.push(args);
    return args[1] === "run" ? execute(args, cwd) : pass(args, cwd);
  } });
  assert.equal(result.outcome, "verified", result.state.error); assert.equal(readReport(reportFile).state.stage, "recorded");
  assert.deepEqual(calls.filter(args => args[1] === "run").map(args => args[2]), REQUIRED_CHECKS);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8")).commit, planned.target.commit);
  assert.equal(fs.readFileSync(path.join(f.app, "apps/web/business.ts"), "utf8"), "export const total = 42;\n");
  assert.equal(fs.readFileSync(path.join(f.app, ".env.local"), "utf8"), "TOKEN=secret-fixture-value\n");
  assert.equal(fs.readlinkSync(path.join(f.app, "platform/link")), "tool.sh"); assert(fs.statSync(path.join(f.app, "platform/tool.sh")).mode & 0o111);
  assert.equal(fs.existsSync(path.join(f.app, "platform/obsolete.ts")), false);
  assert.equal(git(f.app, "branch", "--show-current"), "platform-update/v2.0.1");
  // Rollback is an ordinary commit and restores the app's pre-upgrade business work.
  git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "verified platform update"); git(f.app, "revert", "--no-edit", "HEAD");
  assert.equal(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8"), before);
  assert.equal(fs.readFileSync(path.join(f.app, "apps/web/business.ts"), "utf8"), "export const total = 42;\n");
});
test("failed contracts and deferred E2E keep the old baseline; resume pins the same plan", async () => {
  const f = runnable(); f.publish("2.0.1"); const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned);
  const before = fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8");
  const failed = await applyUpgrade(report, planned, { reportFile, execute: async args => ({ exitCode: args[2] === "test:contracts" ? 1 : 0, log: "contract evidence" }) });
  assert.equal(failed.outcome, "failed"); assert.equal(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8"), before);
  const restored = readReport(reportFile), cache = createCache(planned.plan.source);
  try {
    const rebuilt = await reconstruct(restored, cache, []); assert.equal(rebuilt.plan.digest, planned.plan.digest);
    const pending = await applyUpgrade(restored, rebuilt, { reportFile, execute: pass, deferE2e: true });
    assert.equal(pending.outcome, "needs-review", pending.state.error); assert.equal(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8"), before);
    const verified = await applyUpgrade(readReport(reportFile), rebuilt, { reportFile, execute: pass }); assert.equal(verified.outcome, "verified", verified.state.error);
  } finally { fs.rmSync(cache.directory, { recursive: true, force: true }); }
});
test("ordered codemods use historical implementations once and survive failed checks", async () => {
  const f = runnable(), mod = "platform/tooling/codemods/first.ts";
  write(f.source, mod, `import fs from 'node:fs'; const p='apps/web/business.ts'; const s=fs.readFileSync(p,'utf8'); if(process.argv.includes('--check')) process.exit(s.includes('first')?0:1); if(!s.includes('first')) fs.appendFileSync(p,'// first\\n');`);
  f.publish("2.1.0", entry => { entry.codemods.push({ id: "first", path: mod, touches: ["apps/web/business.ts"] }); });
  write(f.source, mod, "throw new Error('must use historical implementation');\n");
  const second = "platform/tooling/codemods/second.ts";
  write(f.source, second, `import fs from 'node:fs'; const p='apps/web/business.ts'; const s=fs.readFileSync(p,'utf8'); if(!s.includes('first')) throw Error('wrong order'); if(process.argv.includes('--check')) process.exit(s.includes('second')?0:1); if(!s.includes('second')) fs.appendFileSync(p,'// second\\n');`);
  f.publish("2.2.0", entry => { entry.codemods.push(...f.manifest.releases[1].codemods, { id: "second", path: second, touches: ["apps/web/business.ts"] }); });
  const planned = await f.plan("2.2.0"), { report, reportFile } = reportFor(planned); const calls: string[] = [];
  const run: Execute = async (args, cwd) => { calls.push(args.join(" ")); return args[0] === process.execPath ? execute(args, cwd) : pass(args, cwd); };
  assert.equal((await applyUpgrade(report, planned, { reportFile, execute: run, deferE2e: true })).outcome, "needs-review");
  const count = calls.length; const result = await applyUpgrade(readReport(reportFile), planned, { reportFile, execute: run }); assert.equal(result.outcome, "verified", result.state.error);
  assert(!calls.slice(count).some(call => call.includes("codemods/")));
  assert.equal(fs.readFileSync(path.join(f.app, "apps/web/business.ts"), "utf8"), "export const total = 42;\n// first\n// second\n");
});
test("new-secret gate is specific, bound to the plan and produces no source mutation", async () => {
  const f = runnable(); f.publish("2.0.1", entry => { entry.env.push({ name: "NEW_SECRET", kind: "new", secret: true, required: true }); });
  const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned); const before = git(f.app, "status", "--porcelain");
  assert.equal((await applyUpgrade(report, planned, { reportFile, execute: pass })).outcome, "needs-review"); assert.equal(git(f.app, "status", "--porcelain"), before);
  assert.throws(() => recordDecision(report, { id: "all", action: "reviewed", evidence: "approved all" }), /Unknown review/);
  recordDecision(report, { id: "secret:NEW_SECRET", action: "secret-configured", evidence: "Configured in the app staging environment" }); writeReport(reportFile, report);
  const result = await applyUpgrade(readReport(reportFile), planned, { reportFile, execute: pass }); assert.equal(result.outcome, "verified", result.state.error);
});
test("unexpected app changes refuse stale resume and unsupported writes fail before any mutation", async () => {
  const f = runnable(); f.publish("2.0.1"); const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned);
  await applyUpgrade(report, planned, { reportFile, execute: pass, deferE2e: true }); write(f.app, "apps/web/new-feature.ts", "keep my work\n");
  const result = await applyUpgrade(readReport(reportFile), planned, { reportFile, execute: pass }); assert.equal(result.outcome, "failed"); assert.match(result.state.error!, /Unexpected edit/);
  const external = temp(); fs.symlinkSync(external, path.join(f.app, "escape"));
  assert.throws(() => materializePayloads(f.app, [{ path: "safe.txt", mode: "100644", content: Buffer.from("never written") }, { path: "escape/unsafe.txt", mode: "100644", content: Buffer.from("unsafe") }]), /traverses/);
  assert(!fs.existsSync(path.join(f.app, "safe.txt"))); assert(!fs.existsSync(path.join(external, "unsafe.txt")));
  assert.throws(() => preflight(f.app, [{ path: "platform/link", mode: "120000", content: Buffer.from("../escape/secret.txt") }]), /linked directory/);
  assert.throws(() => preflight(f.app, [{ path: ".platform-base.json", remove: true }]), /Only record/);
});
test("target still affected by an acknowledged advisory cannot be recorded", async () => {
  const f = runnable(); write(f.source, "platform/releases/advisories.json", JSON.stringify({ schemaVersion: 1, advisories: [{ id: "security-1", severity: "high", affected: ">=2.0.0 <2.0.2", fixed: "2.0.2", summary: "fixture security fix" }] })); f.publish("2.0.1");
  const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned); recordDecision(report, { id: "advisory:security-1", action: "reviewed", evidence: "Reviewed the affected version range" });
  const result = await applyUpgrade(report, planned, { reportFile, execute: pass }); assert.equal(result.outcome, "failed"); assert.match(result.state.error!, /still affected/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8")).version, "2.0.0");
});
test("reports reject corruption and command logs redact credential values", async () => {
  const f = runnable(); f.publish("2.0.1"); const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned);
  process.env.UPGRADE_TEST_SECRET = "sensitive-fixture-value";
  try { const result = await applyUpgrade(report, planned, { reportFile, execute: async () => ({ exitCode: 1, log: "sensitive-fixture-value" }) }); assert.equal(result.outcome, "failed"); assert(!fs.readFileSync(reportFile, "utf8").includes("sensitive-fixture-value")); } finally { delete process.env.UPGRADE_TEST_SECRET; }
  const parsed = JSON.parse(fs.readFileSync(reportFile, "utf8")); parsed.plan.target.version = "9.0.0"; fs.writeFileSync(reportFile, JSON.stringify(parsed)); assert.throws(() => readReport(reportFile), /plan changed/);
  assert.deepEqual(childEnvironment({ PATH: "bin", STARTER_RELEASE_TOKEN: "secret", GITHUB_TOKEN: "secret", PLATFORM_UPDATER_PRIVATE_KEY: "secret" }), { PATH: "bin" });
  assert(fs.existsSync(path.join(f.app, MANIFEST)));
});
test("seam resolutions and removed env edits are scoped and verified, not merely acknowledged", async () => {
  const f = runnable(); write(f.source, "app.config.ts", "export const brand = 'target';\n"); write(f.app, "apps/web/env.ts", "export const value = process.env.OLD;\n"); git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "old env consumer");
  f.publish("2.0.1", entry => { entry.env.push({ name: "OLD", kind: "removed", secret: false, required: false }); });
  const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned);
  recordDecision(report, { id: "env:OLD", action: "reviewed", evidence: "Replace OLD with the explicit application setting" });
  assert.equal((await applyUpgrade(report, planned, { reportFile, execute: pass })).outcome, "needs-review");
  const pending = readReport(reportFile); recordDecision(pending, { id: "seam:app.config.ts", action: "reviewed", evidence: "Retain app identity with the target configuration hook" });
  write(f.app, "app.config.ts", "export const brand = 'my business';\n"); writeReport(reportFile, pending);
  const failed = await applyUpgrade(readReport(reportFile), planned, { reportFile, execute: pass }); assert.equal(failed.outcome, "failed"); assert.match(failed.state.error!, /still references/);
  write(f.app, "apps/web/env.ts", "export const value = 'app setting';\n");
  const done = await applyUpgrade(readReport(reportFile), planned, { reportFile, execute: pass }); assert.equal(done.outcome, "verified", done.state.error);
});
test("reapplied patch is retained only after review and the marker/zone checks", async () => {
  const f = runnable(), file = "platform/feature.ts"; write(f.app, file, "// PLATFORM-PATCH: app fix\nexport const feature = 'custom';\n");
  write(f.app, ".platform-base.json", JSON.stringify({ version: "2.0.0", commit: f.commit, patches: [{ path: file, reason: "app fix" }] })); git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "record platform patch");
  f.publish("2.0.1"); const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned);
  recordDecision(report, { id: "patch:" + file, action: "reapply-patch", evidence: "Still needed; reapply to the new release and retain the marker" });
  const pending = await applyUpgrade(report, planned, { reportFile, execute: pass }); assert.equal(pending.outcome, "needs-review");
  write(f.app, file, "// PLATFORM-PATCH: app fix\nexport const feature = 'custom on new source';\n");
  const done = await applyUpgrade(readReport(reportFile), planned, { reportFile, execute: pass }); assert.equal(done.outcome, "verified", done.state.error);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8")).patches, [{ path: file, reason: "app fix" }]);
});
test("an interrupted codemod is checked before retry and cannot run twice after completion", async () => {
  const f = runnable(), mod = "platform/tooling/codemods/interrupted.ts";
  write(f.source, mod, `import fs from 'node:fs'; const p='apps/web/business.ts'; const s=fs.readFileSync(p,'utf8'); if(process.argv.includes('--check')) process.exit(s.includes('done')?0:1); if(!s.includes('done')) fs.appendFileSync(p,'// done\\n');`);
  f.publish("2.0.1", entry => { entry.codemods.push({ id: "interrupted", path: mod, touches: ["apps/web/business.ts"] }); });
  const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned);
  const interrupted = await applyUpgrade(report, planned, { reportFile, execute: async (args, cwd) => {
    const result = await execute(args, cwd); if (args[1]?.endsWith("interrupted.ts") && !args.includes("--check")) throw new Error("simulated cut-off after codemod write"); return result;
  } });
  assert.equal(interrupted.outcome, "failed"); assert.equal(readReport(reportFile).state.activeStep, "codemod:interrupted");
  const calls: string[][] = []; const done = await applyUpgrade(readReport(reportFile), planned, { reportFile, execute: async (args, cwd) => { calls.push(args); return args[0] === process.execPath ? execute(args, cwd) : pass(args, cwd); } });
  assert.equal(done.outcome, "verified", done.state.error); assert(!calls.some(args => args[1]?.endsWith("interrupted.ts") && !args.includes("--check")));
});
test("index-only edits cannot enter an upgrade even when working-tree bytes match the plan", async () => {
  const f = runnable(); f.publish("2.0.1"); const planned = await f.plan("2.0.1"), { report, reportFile } = reportFor(planned);
  write(f.app, "apps/web/business.ts", "staged-only change\n"); git(f.app, "add", "apps/web/business.ts"); write(f.app, "apps/web/business.ts", "export const total = 42;\n");
  const result = await applyUpgrade(report, planned, { reportFile, execute: pass }); assert.equal(result.outcome, "failed"); assert.match(result.state.error!, /Unexpected staged edit/);
  assert.match(git(f.app, "show", ":apps/web/business.ts"), /staged-only change/);
});
test("bounded command diagnostics retain the initial failure across noisy shutdown output", async () => {
  const result = await execute([process.execPath, "-e", "console.error('Error: initial dependency failure'); console.log('x'.repeat(100000)); process.exit(1)"], process.cwd());
  assert.equal(result.exitCode, 1); assert(result.log.length <= 16384); assert.match(result.log, /initial dependency failure/);
});
test("a plan-only draft commit may contain its reports without invalidating the app source", async () => {
  const f = runnable(); f.publish("2.0.1", entry => { entry.env.push({ name: "DRAFT_SECRET", kind: "new", secret: true, required: true }); });
  const planned = await f.plan("2.0.1"), report = createReport(planned.plan, workingFiles(planned.plan.app.root)), reportFile = path.join(f.app, "upgrade-report.json");
  await applyUpgrade(report, planned, { reportFile, execute: pass });
  git(f.app, "switch", "-c", "platform-update/v2.0.1"); git(f.app, "add", "upgrade-report.json", "upgrade-report.md"); git(f.app, "commit", "-qm", "draft upgrade report");
  const saved = readReport(reportFile); recordDecision(saved, { id: "secret:DRAFT_SECRET", action: "secret-configured", evidence: "Configured in the named staging environment" }); writeReport(reportFile, saved);
  const done = await applyUpgrade(saved, planned, { reportFile, execute: pass }); assert.equal(done.outcome, "verified", done.state.error);
});

test("a committed draft relocates without changing its plan or rerunning completed codemods", async () => {
  const { relocateReport } = await import("./relocate.ts");
  const f = runnable(), mod = "platform/tooling/codemods/portable.ts";
  write(f.source, mod, `import fs from 'node:fs'; const p='apps/web/business.ts'; const done=fs.readFileSync(p,'utf8').includes('portable'); if(process.argv.includes('--check')) process.exit(done?0:1); if(!done) fs.appendFileSync(p,'// portable\\n');`);
  f.publish("2.0.1", entry => entry.codemods.push({ id: "portable", path: mod, touches: ["apps/web/business.ts"] }));
  const planned = await f.plan("2.0.1"), report = createReport(planned.plan, workingFiles(f.app)), reportFile = path.join(f.app, "upgrade-report.json");
  const run: Execute = (args, cwd) => args[0] === process.execPath ? execute(args, cwd) : pass(args, cwd);
  assert.equal((await applyUpgrade(report, planned, { reportFile, execute: run, deferE2e: true })).outcome, "needs-review");
  git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "draft with completed codemod");
  const clone = temp(); git(clone, "clone", "--no-local", "-q", f.app, ".");
  const portable = readReport(path.join(clone, "upgrade-report.json")), immutable = JSON.stringify(portable.plan), excluded = ["upgrade-report.json", "upgrade-report.md"];
  assert.throws(() => git(clone, "cat-file", "-e", portable.plan.target.commit));
  relocateReport(portable, clone, excluded);
  assert.equal(JSON.stringify(portable.plan), immutable); assert.equal(portable.state.stage, "codemods");
  assert(!portable.state.steps.some(step => step.id === "install" || step.id.startsWith("verify:")));
  const cache = createCache(planned.plan.source), calls: string[][] = [];
  try {
    const rebuilt = await reconstruct(portable, cache, excluded);
    const done = await applyUpgrade(portable, rebuilt, { reportFile: path.join(clone, "upgrade-report.json"), execute: async args => { calls.push(args); return { exitCode: 0, log: "fresh machine checks" }; } });
    assert.equal(done.outcome, "verified", done.state.error);
    assert.deepEqual(calls.filter(args => args[1] === "run").map(args => args[2]), REQUIRED_CHECKS);
    assert(calls.some(args => args[1] === "install")); assert(!calls.some(args => args.some(arg => arg.includes("codemods/"))));
    assert.equal(fs.readFileSync(path.join(clone, "apps/web/business.ts"), "utf8"), "export const total = 42;\n// portable\n");
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.app, ".platform-base.json"), "utf8")).version, "2.0.0");
  } finally { fs.rmSync(cache.directory, { recursive: true, force: true }); }
});
test("relocation refuses changed files, index-only edits and unrelated history; secrets need new evidence", async () => {
  const { relocateReport } = await import("./relocate.ts");
  const f = runnable(); f.publish("2.0.1", entry => entry.env.push({ name: "PORTABLE_SECRET", kind: "new", secret: true, required: true }));
  const planned = await f.plan("2.0.1"), report = createReport(planned.plan, workingFiles(f.app));
  recordDecision(report, { id: "secret:PORTABLE_SECRET", action: "secret-configured", evidence: "Configured for the original machine" });
  const clone = temp(); git(clone, "clone", "-q", f.app, "."); git(clone, "switch", "-c", "platform-update/v2.0.1");
  write(clone, "apps/web/business.ts", "changed");
  assert.throws(() => relocateReport(report, clone, []), /Draft files changed/);
  git(clone, "add", "apps/web/business.ts"); write(clone, "apps/web/business.ts", "export const total = 42;\n");
  assert.throws(() => relocateReport(report, clone, []), /Index and working tree/);
  git(clone, "add", "apps/web/business.ts");
  const other = temp(); git(other, "init", "-q"); git(other, "switch", "-c", "platform-update/v2.0.1"); git(other, "commit", "--allow-empty", "-qm", "unrelated");
  assert.throws(() => relocateReport(report, other, []), /history does not descend/);
  relocateReport(report, clone, []); assert.equal(report.state.decisions.length, 0); assert.equal(report.plan.app.root, fs.realpathSync(f.app));
});
