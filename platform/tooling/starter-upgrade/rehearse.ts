#!/usr/bin/env node
/** Rehearse on a copy of the demonstration app, without servers or publishing credentials. */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as u from "./upgrade.ts";
export const SANDBOX = path.join(u.ROOT, ".ci-local-artifacts/starter-upgrade");
export function copyApp(destination: string): void {
  fs.cpSync(path.join(u.ROOT, "apps/demo"), destination, { recursive: true, filter: p => !["node_modules", ".next", ".turbo", ".starter-upgrade", "out", "next-env.d.ts", "tsconfig.tsbuildinfo", ".DS_Store"].includes(path.basename(p)) });
}
export function seedBaseline(app: string, releases: string): void {
  const release = u.catalogue(releases).releases["1.0.0"];
  for (const file of Object.keys(release.files)) fs.copyFileSync(path.join(releases, "1.0.0", file), path.join(app, file));
  u.atomicJson(path.join(app, u.LOCK), { schemaVersion: 1, package: u.PACKAGE, release: "1.0.0", releaseDigest: u.fingerprint(release), files: release.files, status: "baseline" });
}
export function linkStarter(app: string): void {
  fs.mkdirSync(path.join(app, "node_modules/@repo"), { recursive: true });
  fs.symlinkSync(path.join(app, u.BOUNDARY), path.join(app, "node_modules", u.PACKAGE), "dir");
}
function linkDependencies(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name), to = path.join(destination, name);
    if (name === "starter-sidebar-policy") continue;
    if (fs.lstatSync(from).isSymbolicLink()) {
      const resolved = fs.realpathSync(from);
      u.requireThat(resolved.startsWith(path.join(u.ROOT, "node_modules") + path.sep), `Rehearsal must not import workspace source: ${from}`);
      fs.symlinkSync(resolved, to);
    } else if (fs.statSync(from).isDirectory()) linkDependencies(from, to);
    else fs.copyFileSync(from, to);
  }
}
function run(app: string, command: string[], log: string, success = true): void {
  const exit = u.runCheck(app, { id: "rehearsal", command }, log);
  u.requireThat((exit === 0) === success, `Unexpected exit ${exit}; see ${log}`);
}
export function cli(app: string, releases: string, command: string, ...args: string[]): object {
  const result = spawnSync(process.execPath, [path.join(u.ROOT, "scripts/starter-upgrade/upgrade.ts"), command, "--app", app, "--releases", releases, ...args], { encoding: "utf8", timeout: 900_000 });
  u.requireThat(result.status === 0, result.stderr || String(result.error));
  return JSON.parse(result.stdout) as object;
}
export function main(): void {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  const app = path.join(SANDBOX, "apps/demo"), releases = path.join(SANDBOX, "releases");
  copyApp(app); fs.cpSync(u.RELEASES, releases, { recursive: true });
  fs.copyFileSync(path.join(u.ROOT, "tsconfig.base.json"), path.join(SANDBOX, "tsconfig.base.json"));
  fs.writeFileSync(path.join(SANDBOX, "package.json"), '{"private":true}\n');
  linkDependencies(path.join(u.ROOT, "apps/demo/node_modules"), path.join(app, "node_modules"));
  // Local package installation: only this dependency points at the copied package artifact.
  // The app uses its package exports, not an alias to authoring source.
  linkStarter(app);
  fs.symlinkSync(path.join(u.ROOT, "node_modules"), path.join(SANDBOX, "node_modules"), "dir");
  seedBaseline(app, releases);
  const before = u.sourceFiles(app);
  run(app, ["bun", "run", "test:business"], path.join(SANDBOX, "baseline-business.log"));
  run(app, ["bun", "run", "typecheck"], path.join(SANDBOX, "baseline-types.log"));
  const reportPath = path.join(SANDBOX, "baseline-regression.json");
  run(app, ["bun", "run", "test:starter-policy", "--reporter=json", `--outputFile=${reportPath}`], path.join(SANDBOX, "baseline-regression.log"), false);
  const regression = JSON.parse(fs.readFileSync(reportPath, "utf8")) as { numPassedTests: number; testResults: { assertionResults: { status: string; fullName: string; failureMessages: string[] }[] }[] };
  const failed = regression.testResults.flatMap(f => f.assertionResults).filter(a => a.status === "failed");
  const failures = failed.flatMap(a => a.failureMessages).join("\n");
  u.requireThat(failed.length === 2 && regression.numPassedTests === 1 && failed.every(a => a.fullName.includes("sidebar-finite-width action")) && failures.includes("expected NaN to be 16") && failures.includes("Width NaN"), "Baseline must reproduce both policy and rendered-sidebar regressions");
  const discovery = cli(app, releases, "discover") as { availableTargets: string[] };
  u.requireThat(u.equal(discovery.availableTargets, ["1.0.1"]), "Target not discovered");
  const approved = cli(app, releases, "plan", "--target", "1.0.1");
  const planPath = path.join(SANDBOX, "plan.json"); fs.writeFileSync(planPath, u.encode(approved));
  cli(app, releases, "apply", "--plan", planPath);
  const evidence = cli(app, releases, "verify", "--plan", planPath);
  cli(app, releases, "audit");
  u.requireThat(u.equal(before, u.sourceFiles(app)), "Application bytes were overwritten");
  const html = fs.readFileSync(path.join(app, u.ARTIFACT), "utf8");
  for (const expected of ["Northstar Dispatch", "Port of Oakland", "NS-104", "NS-105"]) u.requireThat(html.includes(expected), `Built dashboard lost ${expected}`);
  u.requireThat(!html.includes("Fresno cold storage"), "Built dashboard offered unready freight");
  u.requireThat(fs.readFileSync(path.join(app, "public/northstar.svg")).equals(fs.readFileSync(path.join(u.ROOT, "apps/demo/public/northstar.svg"))), "Brand asset changed");
  fs.writeFileSync(path.join(SANDBOX, "report.json"), u.encode({ schemaVersion: 1, status: "verified", discovery, dependencyLockSha256: u.digest(fs.readFileSync(path.join(u.ROOT, "bun.lock"))), baselineRegression: "failed-as-expected", protectedFiles: Object.keys(before).length, plan: approved, evidence }));
  process.stdout.write(`Starter upgrade rehearsal verified: ${path.join(SANDBOX, "report.json")}\n`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
