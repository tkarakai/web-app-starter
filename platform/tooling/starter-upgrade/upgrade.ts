#!/usr/bin/env node
/** Local package upgrades. Release metadata cannot provide commands or write destinations. */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { validateConsumerImports } from "./consumer-boundary.ts";
import {
  SCHEMA, PACKAGE, BOUNDARY, PAYLOADS, LOCK, EVIDENCE, ARTIFACT,
  requireThat, digest, fingerprint, equal, encode, safePath, readJson, atomicJson,
  manifest, ownerOf, installed, sourceFiles,
  type Catalogue, type Lock, type Plan, type Check, type Evidence,
} from "./model.ts";
export * from "./model.ts";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const RELEASES = path.join(ROOT, "apps/demo/qa/fixtures/starter-releases");
export const ACTIONS: Record<string, string[]> = { "sidebar-finite-width": ["bun", "run", "test:starter-policy"] };
export const CHECKS: Check[] = [
  { id: "business", command: ["bun", "run", "test:business"] },
  { id: "types", command: ["bun", "run", "typecheck"] },
  { id: "build", command: ["bun", "run", "build", "--webpack"] },
];
const EXPORTS = { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } };
export function packageContract(directory: string, version: string): void {
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")) as Record<string, unknown>;
  requireThat(pkg.name === PACKAGE && pkg.version === version && pkg.type === "module" && equal(pkg.exports, EXPORTS), "Invalid starter package identity or exports");
  requireThat(!pkg.dependencies && !pkg.devDependencies && !pkg.peerDependencies && !pkg.imports && !pkg.scripts, "Release package must be standalone and have no install scripts");
}
export function catalogue(releases: string): Catalogue {
  const value = readJson<Catalogue>(safePath(releases, "catalogue.json"));
  requireThat(value.package === PACKAGE && value.releases && typeof value.releases === "object" && !Array.isArray(value.releases), "Invalid starter catalogue");
  for (const [version, release] of Object.entries(value.releases)) {
    requireThat(/^\d+\.\d+\.\d+$/.test(version) && release && typeof release === "object", "Invalid release");
    requireThat(release.files && equal(Object.keys(release.files).sort(), [...PAYLOADS].sort()), "Unsafe overwrite: unsupported release destinations");
    requireThat(Array.isArray(release.from) && release.from.every(b => typeof b === "string" && Object.hasOwn(value.releases, b)), "Missing or unsupported baselines");
    requireThat(Array.isArray(release.actions) && release.actions.every(a => typeof a === "string" && Object.hasOwn(ACTIONS, a)), "Missing or unsupported action; upgrade the tooling");
    requireThat(new Set(release.actions).size === release.actions.length && (!release.from.length || release.actions.length), "Missing or duplicate action evidence requirement");
    requireThat(equal(release.affectedLayers, ["starter-sidebar-policy"]), "Missing or unknown affected layers");
    requireThat(["none", "low", "high", "critical"].includes(release.securityUrgency), "Missing or unknown security urgency");
    for (const [destination, sha] of Object.entries(release.files)) {
      const payload = safePath(releases, `${version}/${destination}`);
      requireThat(fs.existsSync(payload) && digest(fs.readFileSync(payload)) === sha, `Corrupt release: ${version}`);
    }
    requireThat(equal(installed(path.join(releases, version)), release.files), "Unexpected package artifact files");
    packageContract(path.join(releases, version, BOUNDARY), version);
  }
  requireThat(Object.hasOwn(value.releases, value.latest), "Unknown latest release");
  return value;
}
function toolDigest(): string {
  return fingerprint(["model.ts", "upgrade.ts", "consumer-boundary.ts"].map(f => digest(fs.readFileSync(path.join(import.meta.dirname, f)))));
}
export function baseline(app: string, catalog: Catalogue): Lock {
  const lock = readJson<Lock>(safePath(app, LOCK));
  requireThat(lock.package === PACKAGE, "Lock package mismatch");
  requireThat(["baseline", "verified"].includes(lock.status), "Incomplete upgrade; verify pending plan or restore from git");
  const release = catalog.releases[lock.release];
  requireThat(release, "Unsupported baseline");
  requireThat(lock.releaseDigest === fingerprint(release), "Stale baseline release metadata");
  requireThat(equal(lock.files, release.files) && equal(lock.files, installed(app)), "Consumed starter package drift; do not overwrite local edits");
  return lock;
}
export function discover(app: string, releases: string): object {
  sourceFiles(app);
  const catalog = catalogue(releases);
  const lock = baseline(app, catalog);
  const targets = Object.keys(catalog.releases).filter(v => catalog.releases[v].from.includes(lock.release));
  return { schemaVersion: SCHEMA, package: PACKAGE, current: lock.release, latest: catalog.latest, availableTargets: targets,
    targetDetails: Object.fromEntries(targets.map(v => [v, { affectedLayers: catalog.releases[v].affectedLayers, securityUrgency: catalog.releases[v].securityUrgency }])) };
}
export function plan(app: string, releases: string, target: string): Plan {
  const value = manifest(app), catalog = catalogue(releases), lock = baseline(app, catalog);
  requireThat(Object.hasOwn(catalog.releases, target), "Unknown target");
  const release = catalog.releases[target];
  requireThat(release.from.includes(lock.release), "Unsupported or stale baseline-to-target transition");
  for (const file of Object.keys(release.files)) requireThat(ownerOf(value, file) === "consumed", `Unsafe overwrite of ${file}`);
  const unsigned = {
    schemaVersion: SCHEMA, package: PACKAGE, from: lock.release, to: target,
    affectedLayers: release.affectedLayers, securityUrgency: release.securityUrgency,
    catalogueDigest: fingerprint(catalog), sourceDigest: fingerprint(sourceFiles(app)),
    toolDigest: toolDigest(), lockDigest: fingerprint(lock),
    changes: Object.entries(release.files).sort().map(([p, sha]) => ({ path: p, before: lock.files[p], after: sha })),
    actions: release.actions.map(id => ({ id, command: ACTIONS[id] })), verification: CHECKS,
  };
  return { ...unsigned, id: fingerprint(unsigned) };
}
export function apply(app: string, releases: string, approved: Plan): object {
  requireThat(equal(approved, plan(app, releases, approved.to)), "Stale or modified upgrade plan");
  const release = catalogue(releases).releases[approved.to];
  const lock: Lock = { schemaVersion: SCHEMA, package: PACKAGE, release: approved.to, releaseDigest: fingerprint(release), files: release.files, status: "pending", plan: approved };
  atomicJson(safePath(app, LOCK), lock);
  for (const file of Object.keys(release.files)) {
    const destination = safePath(app, file, true);
    fs.writeFileSync(destination + ".tmp", fs.readFileSync(safePath(releases, `${approved.to}/${file}`)), { flag: "wx" });
    fs.renameSync(destination + ".tmp", destination);
  }
  return { schemaVersion: SCHEMA, status: "pending", planId: approved.id };
}
export function verificationContext(app: string, releases: string, approved: Plan): Lock {
  const catalog = catalogue(releases), lock = readJson<Lock>(safePath(app, LOCK));
  requireThat(["pending", "verified"].includes(lock.status) && equal(lock.plan, approved), "Missing applied plan; completion cannot be asserted");
  requireThat(fingerprint(catalog) === approved.catalogueDigest, "Catalogue changed since plan");
  requireThat(toolDigest() === approved.toolDigest, "Upgrade tooling changed since plan");
  requireThat(fingerprint(sourceFiles(app)) === approved.sourceDigest, "Application source changed since plan");
  const release = catalog.releases[approved.to];
  requireThat(release && lock.package === PACKAGE && lock.release === approved.to && lock.releaseDigest === fingerprint(release) && equal(lock.files, release.files) && equal(lock.files, installed(app)), "Unverifiable installed target");
  requireThat(equal(approved.actions, release.actions.map(id => ({ id, command: ACTIONS[id] }))), "Missing action evidence requirement");
  requireThat(equal(approved.verification, CHECKS), "Missing verification requirements");
  const { id, ...unsigned } = approved;
  requireThat(id === fingerprint(unsigned), "Invalid plan identity");
  return lock;
}
/** The consumer must resolve the approved local package, never current workspace source. */
export function consumerBoundary(app: string): void {
  const dependency = path.join(app, "node_modules", PACKAGE);
  requireThat(fs.existsSync(dependency), "Starter dependency is not installed");
  const resolved = fs.realpathSync(dependency);
  const local = fs.realpathSync(safePath(app, BOUNDARY));
  requireThat(resolved === local || resolved.startsWith(path.join(ROOT, "node_modules") + path.sep) || resolved.startsWith(path.join(app, "node_modules") + path.sep), "Starter dependency resolves to workspace source instead of the consumed package");
  for (const file of PAYLOADS) {
    const expected = fs.readFileSync(safePath(app, file, true));
    requireThat(digest(fs.readFileSync(path.join(resolved, file.slice(BOUNDARY.length)))) === digest(expected), "Installed dependency differs from the consumed starter package; reinstall local dependencies");
  }
  validateConsumerImports(app, ROOT);
}
export type Runner = (app: string, check: Check, log: string) => number;
export const runCheck: Runner = (app, check, log) => {
  const fd = fs.openSync(log, "w");
  try {
    const result = spawnSync(check.command[0], check.command.slice(1), { cwd: app, stdio: ["ignore", fd, fd], timeout: 600_000, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally { fs.closeSync(fd); }
};
export function verify(app: string, releases: string, approved: Plan, runner: Runner = runCheck): Evidence {
  const lock = verificationContext(app, releases, approved);
  lock.status = "pending"; delete lock.evidenceDigest;
  atomicJson(safePath(app, LOCK), lock);
  const evidence: Evidence = { schemaVersion: SCHEMA, package: PACKAGE, planId: approved.id, sourceDigest: approved.sourceDigest, release: approved.to, status: "failed", results: [] };
  const evidencePath = safePath(app, EVIDENCE);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  try {
    consumerBoundary(app);
    for (const check of [...approved.actions, ...approved.verification]) {
      if (check.id === "build") fs.rmSync(safePath(app, ARTIFACT), { force: true });
      const log = safePath(app, `.starter-upgrade/${check.id}.log`);
      const exitCode = runner(app, check, log);
      evidence.results.push({ ...check, exitCode, outputSha256: digest(fs.readFileSync(log)) });
      requireThat(exitCode === 0, `Verification failed: ${check.id}; see ${log}`);
    }
    verificationContext(app, releases, approved); consumerBoundary(app);
    const artifact = safePath(app, ARTIFACT);
    requireThat(fs.existsSync(artifact), "Missing built dashboard artifact");
    evidence.artifacts = { [ARTIFACT]: digest(fs.readFileSync(artifact)) };
    evidence.status = "verified"; atomicJson(evidencePath, evidence);
    lock.status = "verified"; lock.evidenceDigest = fingerprint(evidence); atomicJson(safePath(app, LOCK), lock);
    return evidence;
  } catch (error) {
    evidence.error = String(error); atomicJson(evidencePath, evidence); throw error;
  }
}
export function audit(app: string, releases: string): Evidence {
  const lock = readJson<Lock>(safePath(app, LOCK));
  requireThat(lock.status === "verified", "Completion is unverified");
  requireThat(lock.plan, "Missing completion plan");
  const approved = lock.plan;
  verificationContext(app, releases, approved); consumerBoundary(app);
  const evidence = readJson<Evidence>(safePath(app, EVIDENCE));
  requireThat(lock.evidenceDigest === fingerprint(evidence) && evidence.status === "verified" && evidence.package === PACKAGE && evidence.planId === approved.id && evidence.sourceDigest === approved.sourceDigest && evidence.release === approved.to, "Missing or altered completion evidence");
  requireThat(evidence.artifacts && equal(Object.keys(evidence.artifacts), [ARTIFACT]), "Missing built artifact evidence");
  for (const [p, sha] of Object.entries(evidence.artifacts)) requireThat(digest(fs.readFileSync(safePath(app, p))) === sha, "Built artifact changed or missing");
  const expected = [...approved.actions, ...approved.verification];
  requireThat(Array.isArray(evidence.results) && evidence.results.length === expected.length, "Missing action or verification evidence");
  expected.forEach((check, i) => {
    const result = evidence.results[i];
    requireThat(result.id === check.id && equal(result.command, check.command) && result.exitCode === 0 && result.outputSha256 === digest(fs.readFileSync(safePath(app, `.starter-upgrade/${check.id}.log`))), `Unverifiable completion: ${check.id}`);
  });
  return evidence;
}
export function exclusive<T>(app: string, work: () => T): T {
  const guard = safePath(app, ".starter-upgrade/upgrade.guard");
  fs.mkdirSync(path.dirname(guard), { recursive: true });
  try { fs.mkdirSync(guard); } catch { throw new Error("Another upgrade command is active or an interrupted command left upgrade.guard; inspect before removing it"); }
  try { return work(); } finally { fs.rmdirSync(guard); }
}
export function main(): void {
  try {
    const args = parseArgs({ allowPositionals: true, options: { app: { type: "string", default: "apps/demo" }, releases: { type: "string", default: RELEASES }, target: { type: "string" }, plan: { type: "string" } } });
    const [command] = args.positionals;
    const app = path.resolve(args.values.app), releases = path.resolve(args.values.releases);
    const result = exclusive(app, () => {
      if (command === "discover") return discover(app, releases);
      if (command === "plan") { requireThat(args.values.target, "plan requires --target"); return plan(app, releases, args.values.target); }
      if (command === "audit") return audit(app, releases);
      requireThat(command === "apply" || command === "verify", "Expected discover, plan, apply, verify or audit");
      requireThat(args.values.plan, `${command} requires --plan`);
      const approved = readJson<Plan>(args.values.plan);
      return command === "apply" ? apply(app, releases, approved) : verify(app, releases, approved);
    });
    process.stdout.write(encode(result));
  } catch (error) { process.stderr.write(encode({ schemaVersion: SCHEMA, status: "blocked", error: String(error) })); process.exitCode = 1; }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
