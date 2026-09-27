import * as fs from "node:fs";
import * as path from "node:path";
import { checkZone, type PlatformBase } from "../check-zone.ts";
import { demand } from "./metadata.ts";
import { compare, satisfies } from "./semver.ts";
import { scanEnvironment } from "./env.ts";
import { secretValueFile } from "./ownership.ts";
import { decisionFor, unresolved, type Report } from "./report.ts";
import { workingFiles } from "./plan.ts";

export const REQUIRED_CHECKS = ["check:runtime-baseline", "check:agent-skills", "check:actions-pinned", "check:i18n", "lint:dev-scripts", "typecheck:dev-scripts", "test:dev-scripts", "lint", "typecheck", "test", "test:unit", "test:convex", "test:contracts", "build", "test:e2e"] as const;
export function candidateBase(report: Report): PlatformBase {
  return { version: report.plan.target.version, commit: report.plan.target.commit, patches: report.plan.patches.filter(patch => {
    const gate = report.plan.gates.find(row => row.id === "patch:" + patch.path);
    return !patch.absorbed && gate && decisionFor(report, gate)?.action === "reapply-patch";
  }).map(patch => ({ path: patch.path, reason: patch.reason })) };
}
export function verifySource(report: Report, directory: string, excluded: string[]): void {
  const root = report.plan.app.root;
  demand(unresolved(report).length === 0, "Review items remain unresolved");
  for (const advisory of report.plan.advisories) if (["high", "critical"].includes(advisory.severity)) demand(!satisfies(report.plan.target.version, advisory.affected), "Target is still affected by advisory " + advisory.id);
  for (const file of report.plan.gates.filter(row => row.kind === "seam-conflict").flatMap(row => row.files)) {
    demand(fs.existsSync(path.join(root, file)), "Required seam remains missing: " + file);
    demand(!/^(?:<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)(?: |$)/m.test(fs.readFileSync(path.join(root, file), "utf8")), "Seam conflict remains unresolved: " + file);
  }
  const sources = Object.keys(workingFiles(root, excluded)).filter(file => !secretValueFile(file)).flatMap(file => {
    const full = path.join(root, file); if (!fs.existsSync(full) || !fs.lstatSync(full).isFile()) return [];
    return [{ path: file, content: fs.readFileSync(full) }];
  });
  const scan = scanEnvironment(sources);
  for (const change of report.plan.environment.changes) if (change.kind !== "new") demand(!scan.references.some(row => row.name === change.name), "App still references removed/renamed env " + change.name);
  const candidate = path.join(directory, "candidate-base.json"); fs.writeFileSync(candidate, JSON.stringify(candidateBase(report)), { mode: 0o600 });
  const result = checkZone(root, { baseFile: candidate }); demand(result.errors.length === 0, result.errors.join("\n"));
}
export function verifyDependencies(report: Report): void {
  const root = report.plan.app.root;
  for (const floor of report.plan.dependencies) {
    let current = path.dirname(path.join(root, floor.path)), installed: string | undefined;
    for (;;) {
      const file = path.join(current, "node_modules", floor.name, "package.json");
      if (fs.existsSync(file)) { installed = JSON.parse(fs.readFileSync(file, "utf8")).version; break; }
      if (current === root) break;
      const parent = path.dirname(current); demand(parent !== current && (parent === root || parent.startsWith(root + path.sep)), "Dependency lookup escaped the app"); current = parent;
    }
    demand(typeof installed === "string" && compare(installed, floor.minimum) >= 0, "Resolved dependency is below its floor or missing: " + floor.name + " in " + floor.path);
  }
}
