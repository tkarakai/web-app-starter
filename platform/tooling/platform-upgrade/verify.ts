import * as fs from "node:fs";
import * as path from "node:path";
import { checkZone, type PlatformBase } from "../check-zone.ts";
import { demand } from "./metadata.ts";
import { compare, satisfies } from "./semver.ts";
import { scanEnvironment } from "./env.ts";
import { readRegular } from "./io.ts";
import { secretValueFile } from "./ownership.ts";
import { reportAppRoot, decisionFor, unresolved, type Report } from "./report.ts";
import { workingFiles } from "./plan.ts";

export const REQUIRED_CHECKS = ["check:runtime-baseline", "check:agent-skills", "check:actions-pinned", "check:i18n", "lint:dev-scripts", "typecheck:dev-scripts", "test:dev-scripts", "lint", "typecheck", "test", "test:unit", "test:convex", "test:contracts", "build", "test:e2e"] as const;
export function candidateBase(report: Report): PlatformBase {
  return { version: report.plan.target.version, commit: report.plan.target.commit, patches: report.plan.patches.filter(patch => {
    const gate = report.plan.gates.find(row => row.id === "patch:" + patch.path);
    return !patch.absorbed && gate && decisionFor(report, gate)?.action === "reapply-patch";
  }).map(patch => ({ path: patch.path, reason: patch.reason })) };
}
export function verifySource(report: Report, directory: string, excluded: string[]): void {
  const root = reportAppRoot(report);
  demand(unresolved(report).length === 0, "Review items remain unresolved");
  for (const advisory of report.plan.advisories) if (["high", "critical"].includes(advisory.severity)) demand(!satisfies(report.plan.target.version, advisory.affected), "Target is still affected by advisory " + advisory.id);
  for (const file of report.plan.gates.filter(row => row.kind === "seam-conflict").flatMap(row => row.files)) {
    demand(fs.existsSync(path.join(root, file)), "Required seam remains missing: " + file);
    demand(!/^(?:<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)(?: |$)/m.test(fs.readFileSync(path.join(root, file), "utf8")), "Seam conflict remains unresolved: " + file);
  }
  const sources = Object.entries(workingFiles(root, excluded)).filter(([file, hash]) => !secretValueFile(file) && hash.startsWith("100")).map(([file]) => ({ path: file, content: readRegular(path.join(root, file)).content }));
  const scan = scanEnvironment(sources);
  for (const change of report.plan.environment.changes) if (change.kind !== "new") demand(!scan.references.some(row => row.name === change.name), "App still references removed/renamed env " + change.name);
  const candidate = path.join(directory, "candidate-base.json"); fs.writeFileSync(candidate, JSON.stringify(candidateBase(report)), { mode: 0o600 });
  const result = checkZone(root, { baseFile: candidate }); demand(result.errors.length === 0, result.errors.join("\n"));
}
type Package = { version?: string; workspaces?: string[] } & Partial<Record<"dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies" | "overrides", Record<string, string>>>;
const readPackage = (file: string): Package => JSON.parse(fs.readFileSync(file, "utf8"));
function inside(root: string, file: string): string {
  const resolved = fs.realpathSync(file);
  demand(resolved.startsWith(root + path.sep), "Dependency lookup escaped the app");
  return resolved;
}
function installedPackage(root: string, directory: string, name: string): string | undefined {
  let current = directory;
  for (;;) {
    const file = path.join(current, "node_modules", name, "package.json");
    if (fs.existsSync(file)) return inside(root, file);
    if (current === root) return undefined;
    const parent = path.dirname(current);
    demand(parent !== current && (parent === root || parent.startsWith(root + path.sep)), "Dependency lookup escaped the app");
    current = parent;
  }
}
function overrideVersions(root: string, name: string): (string | undefined)[] {
  const rootFile = path.join(root, "package.json"), pkg = readPackage(rootFile);
  const workspaces = fs.globSync((pkg.workspaces ?? []).map(glob => glob + "/package.json"), { cwd: root, exclude: ["**/node_modules/**", "**/.git/**"] });
  const queue = [rootFile, ...workspaces.map(file => inside(root, path.join(root, file)))].map(file => ({ file, workspace: true }));
  const visited = new Set<string>(), versions: (string | undefined)[] = [];
  // Follow reachable packages, including Bun's isolated symlinks. Scanning its
  // .bun store would also count stale versions that no consumer resolves.
  for (const { file, workspace } of queue) {
    if (visited.has(file)) continue;
    visited.add(file);
    const manifest = readPackage(file);
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
      if (section === "devDependencies" && !workspace) continue;
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        const installed = installedPackage(root, path.dirname(file), dependency);
        if (dependency === name && (installed || section === "dependencies" || section === "devDependencies")) versions.push(installed ? readPackage(installed).version : undefined);
        if (installed) queue.push({ file: installed, workspace: false });
      }
    }
  }
  return versions;
}
export function verifyDependencies(report: Report): void {
  const root = fs.realpathSync(reportAppRoot(report));
  for (const floor of report.plan.dependencies) {
    const file = path.join(root, floor.path), pkg = readPackage(file);
    const installed = installedPackage(root, path.dirname(file), floor.name);
    const versions = floor.path === "package.json" && Object.hasOwn(pkg.overrides ?? {}, floor.name)
      ? overrideVersions(root, floor.name)
      : [installed ? readPackage(installed).version : undefined];
    demand(versions.length > 0 && versions.every(version => typeof version === "string" && compare(version, floor.minimum) >= 0), "Resolved dependency is below its floor or missing: " + floor.name + " in " + floor.path);
  }
}
