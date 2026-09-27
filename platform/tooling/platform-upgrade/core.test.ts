import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { compare, raiseFloor, satisfies } from "./semver.ts";
import { MANIFEST, ADVISORIES, ENTRY, parseAdvisories, parseManifest, safeRelative, type Manifest, type Release } from "./metadata.ts";
import { createCache, gitText, loadRelease, materialize, tree } from "./git.ts";
import { scanEnvironment } from "./env.ts";
import { checkZone } from "../check-zone.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function temp(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-core-")); roots.push(root); return root; }
function write(root: string, file: string, content: string): void { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content); }
function git(root: string, ...args: string[]): string { return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function release(version = "2.0.0", previous: string | null = null): Release { return { version, previous, supportedBaseline: ">=2.0.0 <3.0.0", codemods: [], migrations: [], env: [], removedFiles: [], renamedExports: [], dependencyFloors: [], changedSeams: [] }; }
function manifest(): Manifest { return { schemaVersion: 1, runtime: { nodeMajor: 24, bun: "1.4.2" }, seams: [{ id: "package", path: "package.json", hooks: ["fixture"] }], releases: [release()] }; }
function source(): string {
  const root = temp(); git(root, "init", "-q");
  write(root, "package.json", '{"name":"fixture"}\n'); write(root, "platform/VERSION", "2.0.0\n");
  write(root, MANIFEST, JSON.stringify(manifest())); write(root, ADVISORIES, '{"schemaVersion":1,"advisories":[]}'); write(root, ENTRY, "// test target\n");
  write(root, "platform/run.sh", "#!/bin/sh\nexit 0\n"); fs.chmodSync(path.join(root, "platform/run.sh"), 0o755);
  fs.mkdirSync(path.join(root, ".agents/skills"), { recursive: true }); fs.symlinkSync("../../platform/run.sh", path.join(root, ".agents/skills/platform-run"));
  git(root, "add", "-A"); git(root, "commit", "-qm", "release"); git(root, "tag", "v2.0.0"); return root;
}
test("semver handles boundaries and rejects unsupported alternatives instead of hiding advisories", () => {
  assert.equal(compare("2.10.0", "2.9.9"), 1);
  assert.equal(satisfies("2.1.0", ">=2.0.0 <2.2.0 || =3.0.0"), true);
  assert.equal(satisfies("2.2.0", ">=2.0.0 <2.2.0"), false);
  assert.equal(satisfies("0.2.9", "^0.2.1"), true); assert.equal(satisfies("0.3.0", "^0.2.1"), false);
  assert.equal(satisfies("0.0.2", "^0.0.1"), false);
  assert.throws(() => satisfies("2.1.0", ">=2.0.0 || latest"), /Unsupported/);
  assert.throws(() => satisfies("2.1.0-beta.1", "*"), /Unsupported/);
  assert.deepEqual(raiseFloor("^2.1.0", "2.2.0"), { value: "^2.2.0" });
  assert.deepEqual(raiseFloor("~2.3.0", "2.2.0"), { value: "~2.3.0" });
  assert(raiseFloor("^3.0.0", "2.2.0").reason); assert(raiseFloor("workspace:*", "2.2.0").reason);
});
test("cumulative manifests reject missing history and conflicting stable codemod definitions", () => {
  const value = manifest(); value.releases.push(release("2.0.2", "2.0.1"));
  assert.throws(() => parseManifest(JSON.stringify(value)), /intermediate/);
  value.releases[1].previous = "2.0.0";
  value.releases[0].codemods = [{ id: "rename", path: "platform/tooling/codemods/rename.ts", touches: ["apps/"] }];
  value.releases[1].codemods = [{ id: "rename", path: "platform/tooling/codemods/other.ts", touches: ["apps/"] }];
  assert.throws(() => parseManifest(JSON.stringify(value)), /conflicting definitions/);
  value.releases[1].codemods = value.releases[0].codemods;
  assert.equal(parseManifest(JSON.stringify(value)).releases.length, 2);
  value.seams[0].path = "platform/config.json";
  assert.throws(() => parseManifest(JSON.stringify(value)), /cannot be three-way seams/);
});
test("advisory validation is fail-closed for unknown severity, range or an affected fixed version", () => {
  const row = { id: "test-advisory", severity: "high", affected: ">=2.0.0 <2.0.2", fixed: "2.0.2", summary: "Fix session isolation" };
  const parse = (change: object) => parseAdvisories(JSON.stringify({ schemaVersion: 1, advisories: [{ ...row, ...change }] }));
  assert.equal(parse({}).advisories[0].severity, "high");
  assert.throws(() => parse({ severity: "urgent" }), /Unknown/);
  assert.throws(() => parse({ affected: "2.x" }), /Unsupported/);
  assert.throws(() => parse({ fixed: "2.0.1" }), /still affected/);
});
test("source caching preserves modes and skill links without changing app/source refs", async () => {
  const root = source(); const before = git(root, "show-ref");
  const cache = createCache({ kind: "local", path: root }); roots.push(cache.directory);
  const target = await loadRelease(cache, "2.0.0");
  assert.equal(target.commit, git(root, "rev-parse", "HEAD"));
  assert.equal(fs.statSync(path.join(target.directory, "platform/run.sh")).mode & 0o777, 0o755);
  assert.equal(fs.readlinkSync(path.join(target.directory, ".agents/skills/platform-run")), "../../platform/run.sh");
  assert.equal(git(root, "show-ref"), before);
  assert.equal(git(root, "status", "--porcelain"), "");
});
test("unsafe paths and escaping source links are rejected before materialization", () => {
  for (const name of ["../escape", "/absolute", "a/../../b", ".git/config", "x\\y", "C:drive", "a\nb"]) assert.throws(() => safeRelative(name), /Unsafe/);
  const root = source(); fs.symlinkSync("../../outside", path.join(root, "platform/escape")); git(root, "add", "-A"); git(root, "commit", "-qm", "unsafe");
  const dest = path.join(temp(), "payload");
  assert.throws(() => materialize(root, tree(root, gitText(root, ["rev-parse", "HEAD"])), dest), /Unsafe/);
  assert.equal(fs.existsSync(dest), false);
});
test("env scan reports names and dynamic accesses without secret values or platform noise", () => {
  const scan = scanEnvironment([
    { path: "apps/web/env.ts", content: Buffer.from('process.env.OLD; process.env["OLDER"]; import.meta.env.PUBLIC; process.env[key];\n') },
    { path: ".github/workflows/app.yml", content: Buffer.from('value: ${{ secrets.TOKEN }}\nrun: echo "${OLD}"\n') },
    { path: "apps/web/.env.local", content: Buffer.from('TOKEN=do-not-copy\n') },
    { path: "platform/test.ts", content: Buffer.from('process.env.PLATFORM_ONLY') },
    { path: "apps/web/.env.example", content: Buffer.from('EXAMPLE=do-not-copy-either\n') },
  ]);
  assert.deepEqual([...new Set(scan.references.map(row => row.name))].sort(), ["EXAMPLE", "OLD", "OLDER", "PUBLIC", "TOKEN"]);
  assert.deepEqual(scan.dynamic, [{ file: "apps/web/env.ts", line: 1, kind: "dynamic-env-access" }]);
  assert(!JSON.stringify(scan).includes("do-not-copy"));
});
test("candidate zone checks do not overwrite the installed baseline; missing candidates fail closed", () => {
  const root = source(); const base = git(root, "rev-parse", "HEAD");
  write(root, ".platform-base.json", JSON.stringify({ version: "2.0.0", commit: base, patches: [] }));
  git(root, "add", "-A"); git(root, "commit", "-qm", "adopt");
  const original = fs.readFileSync(path.join(root, ".platform-base.json"), "utf8");
  write(root, "platform/run.sh", "#!/bin/sh\necho new\n"); git(root, "add", "-A"); git(root, "commit", "-qm", "candidate");
  const candidate = path.join(temp(), "candidate.json"); write(path.dirname(candidate), path.basename(candidate), JSON.stringify({ version: "2.0.1", commit: git(root, "rev-parse", "HEAD"), patches: [] }));
  assert(checkZone(root).errors.length > 0);
  assert.deepEqual(checkZone(root, { baseFile: candidate }).errors, []);
  assert.equal(fs.readFileSync(path.join(root, ".platform-base.json"), "utf8"), original);
  assert(checkZone(root, { baseFile: candidate + ".missing" }).errors.some(error => error.includes("Candidate baseline is missing")));
});
