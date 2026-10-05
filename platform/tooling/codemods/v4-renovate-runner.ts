#!/usr/bin/env node
/**
 * v4.1 makes every ordinary Actions job fail closed when any local worker routing is configured.
 * Renovate is app-owned, so replacing the platform did not update an adopted app's stock hosted
 * runner. This migrates only that exact stock runner; custom routes remain app-owned and the
 * platform CI contract check reports any route that still cannot enforce local-only operation.
 *
 * Run from the app root:
 * ./platform/tooling/node-ts.sh platform/tooling/codemods/v4-renovate-runner.ts [--check] [ROOT]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const WORKFLOW = ".github/workflows/renovate.yml";
const STOCK_RUNNER = "    runs-on: ubuntu-latest";
const ROUTED_RUNNER = "    runs-on: ${{ vars.PLATFORM_CI_AUX_RUNNER || vars.PLATFORM_CI_RUNNER || ((vars.PLATFORM_CI_LOCAL_ONLY == 'true' || vars.PLATFORM_CI_WORKER_POOL != '' || vars.PLATFORM_CI_AUX_RUNNER != '' || vars.PLATFORM_CI_RUNNER != '' || vars.PLATFORM_UPDATE_RUNNER != '' || vars.PLATFORM_UPDATE_DELIVERY_RUNNER != '') && 'starter-local-only-unconfigured' || 'ubuntu-latest') }}";

export function migrateContent(content: string): string {
  const lines = content.split("\n");
  const matches = lines.flatMap((line, index) => line === STOCK_RUNNER ? [index] : []);
  if (matches.length !== 1) return content;
  lines[matches[0]!] = ROUTED_RUNNER;
  return lines.join("\n");
}

export function migrate(root: string, check = false): string[] {
  const target = path.join(root, WORKFLOW);
  if (!fs.existsSync(target)) return [];
  const before = fs.readFileSync(target, "utf8");
  const after = migrateContent(before);
  if (after === before) return [];
  if (!check) fs.writeFileSync(target, after);
  return [WORKFLOW];
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v4-renovate-runner.ts [--check] [ROOT]");
    const files = migrate(path.resolve(values[0] ?? "."), check);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need migration" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
