#!/usr/bin/env node
/**
 * Organization cutover requires an app-owned exhaustive migration registry. Historical
 * owner IDs, private/shared semantics and queued jobs cannot be safely inferred by a codemod.
 * This creates a deliberately incomplete registration seam; verification refuses it until
 * the app supplies reviewed dispositions and executable backfills. It never edits data.
 * Run at the repository root: node-ts.sh platform/tooling/codemods/organization-register-migration.ts
 * [--check] [--backend packages/backend/convex] [ROOT]. Idempotent, no existing file overwritten.
 */
import { existsSync, mkdirSync, writeFileSync, lstatSync } from "node:fs";
import { resolve, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
export function migrate(root: string, check = false, backend = "packages/backend/convex") {
  const base = resolve(root); const target = resolve(base, backend, "organizationMigrationRegistry.ts");
  if (!target.startsWith(base + sep)) throw new Error("Migration target must be inside the application repository");
  for (let current = dirname(target); current !== dirname(base); current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Migration refuses symlinked directories");
    if (current === base) break;
  }
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) throw new Error("Migration refuses symlinked files");
    return [];
  }
  const content = `/** App-owned: classify every table, function and job before cutover. Empty is NOT ready. */
import type { OrganizationMigrationRegistry } from "./platform/organizationMigrationRegistry";
export const organizationMigrationRegistry: OrganizationMigrationRegistry = {
  version: 1,
  tables: {},
  functions: {},
  jobs: {},
  components: {},
};
`;
  if (!check) { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content, { flag: "wx" }); }
  return [relative(base, target)];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); const check = args.includes("--check");
    const index = args.indexOf("--backend"); const backend = index < 0 ? undefined : args[index + 1];
    if (index >= 0 && (!backend || backend.startsWith("--"))) throw new Error("--backend requires a path");
    const values = args.filter((arg, i) => arg !== "--check" && i !== index && (index < 0 || i !== index + 1));
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw new Error("Usage: organization-register-migration.ts [--check] [--backend PATH] [ROOT]");
    const changed = migrate(resolve(values[0] ?? "."), check, backend);
    for (const file of changed) process.stdout.write(`${check ? "Would create" : "Created"} ${file}\n`);
    process.stdout.write(`${changed.length} file(s) ${check ? "need migration" : "created"}\n`);
    if (check && changed.length) process.exitCode = 1;
  } catch (error) { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; }
}
