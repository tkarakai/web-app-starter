#!/usr/bin/env node
/**
 * Public repositories no longer support local Actions overrides or diagnostics. Private owners
 * retain the existing hosted/all-local selection. Platform workflows update on upgrade, but
 * app-owned CI callers and Renovate also need the visibility guard. This wraps only stock-style
 * platform runner expressions; custom selectors remain app-owned and need owner review.
 *
 * ./platform/tooling/node-ts.sh platform/tooling/codemods/v5-public-hosted-runners.ts [--check] [ROOT] [WORKFLOW_DIR]
 * The directory defaults to .github/workflows and must remain inside ROOT. No dependencies needed.
 * This does not stop services, delete registrations/credentials, change repository variables or
 * migrate queued jobs. Retire public local installations separately before applying the upgrade.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { openMigrationFile } from "./open-migration-file.ts";

const local = "vars.PLATFORM_CI_LOCAL_ONLY == 'true' || vars.PLATFORM_CI_WORKER_POOL != '' || vars.PLATFORM_CI_AUX_RUNNER != '' || vars.PLATFORM_CI_RUNNER != '' || vars.PLATFORM_UPDATE_RUNNER != '' || vars.PLATFORM_UPDATE_DELIVERY_RUNNER != ''";
const auxiliary = "vars.PLATFORM_CI_AUX_RUNNER || vars.PLATFORM_CI_RUNNER";
const scalar = `${auxiliary} || ((${local}) && 'starter-local-only-unconfigured' || 'ubuntu-latest')`;
const localJSON = `((${local}) && format('["self-hosted",{0}]', toJSON(${auxiliary} || 'starter-local-only-unconfigured')) || '["ubuntu-latest"]')`;
const ciTuple = `'["self-hosted","{0}","starter-source-{1}","starter-run-{2}"]'`;
const stockPrefixes = [
  `vars.PLATFORM_CI_WORKER_POOL != '' && format(${ciTuple}, vars.PLATFORM_CI_WORKER_POOL, github.sha, github.run_id)`,
  `vars.PLATFORM_CI_WORKER_POOL != '' && github.event_name != 'schedule' && format(${ciTuple}, vars.PLATFORM_CI_WORKER_POOL, github.sha, github.run_id)`,
  `startsWith(github.workflow, 'CI ') && vars.PLATFORM_CI_WORKER_POOL != '' && format(${ciTuple}, vars.PLATFORM_CI_WORKER_POOL, inputs.git_sha || github.sha, github.run_id)`,
  `vars.PLATFORM_UPDATE_RUNNER != '' && format('["self-hosted","{0}","starter-source-{1}","starter-run-{2}","starter-attempt-{3}","starter-update-check"]', vars.PLATFORM_UPDATE_RUNNER, github.sha, github.run_id, github.run_attempt)`,
  `vars.PLATFORM_UPDATE_RUNNER != '' && format('["self-hosted","{0}","starter-source-{1}","starter-run-{2}","starter-attempt-{3}","starter-update-verify"]', vars.PLATFORM_UPDATE_RUNNER, needs.check.outputs.head, github.run_id, github.run_attempt)`,
  `vars.PLATFORM_UPDATE_DELIVERY_RUNNER != '' && format('["self-hosted","{0}","starter-source-{1}","starter-run-{2}","starter-attempt-{3}","starter-update-deliver"]', vars.PLATFORM_UPDATE_DELIVERY_RUNNER, needs.check.outputs.head || github.sha, github.run_id, github.run_attempt)`,
];
const stockJSON = new Map<string, string>();
for (const fallback of [`format('["{0}"]', ${scalar})`, localJSON]) {
  stockJSON.set(fallback, localJSON);
  for (const prefix of stockPrefixes) stockJSON.set(`${prefix} || ${fallback}`, `${prefix} || ${localJSON}`);
}
const diagnostic = `format(${ciTuple}, inputs.worker_pool, github.sha, github.run_id)`;
stockJSON.set(diagnostic, diagnostic);
export function migrateContent(content: string): string {
  let updated = content.split("\n").map(line => {
    const match = line.match(/^ {4}runs-on: \$\{\{ (.+) \}\}$/);
    if (!match) return line;
    const expression = match[1]!;
    if (expression === scalar || expression === `github.event.repository.private != true && 'ubuntu-latest' || (${scalar})`) {
      return `    runs-on: \${{ fromJSON(github.event.repository.private != true && '["ubuntu-latest"]' || (${localJSON})) }}`;
    }
    for (const [before, after] of stockJSON) {
      if (expression === `fromJSON(${before})`
        || expression === `fromJSON(github.event.repository.private != true && '["ubuntu-latest"]' || (${before}))`
        || expression === `fromJSON(github.event.repository.private != true && '["ubuntu-latest"]' || ${before})`) {
        return `    runs-on: \${{ fromJSON(github.event.repository.private != true && '["ubuntu-latest"]' || (${after})) }}`;
      }
    }
    return line;
  }).join("\n");
  const first = "  worker-first:\n    name: Worker isolation 1\n    if: inputs.worker_check && inputs.worker_pool != ''";
  const second = "  worker-second:\n    name: Worker isolation 2\n    needs: worker-first\n";
  if (updated.includes(first) && updated.includes(second)) {
    updated = updated.replace(first, "  worker-first:\n    name: Worker isolation 1\n    if: ${{ github.event.repository.private == true && inputs.worker_check && inputs.worker_pool != '' }}")
      .replace(second, second + "    if: ${{ github.event.repository.private == true }}\n");
    if (!/^ {2}reject-public-workers:/m.test(updated)) {
      updated = updated.replace(/^jobs:\n/m, "jobs:\n  reject-public-workers:\n    name: Reject public local-worker request\n    if: ${{ github.event.repository.private != true && inputs.worker_check }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          echo \"::error::Public repositories must use GitHub-hosted runners; local worker diagnostics are not supported.\"\n          exit 1\n\n");
    }
  }
  return updated;
}
export function migrate(root: string, check = false, directory = ".github/workflows"): string[] {
  const folder = path.resolve(root, directory);
  if (!fs.existsSync(folder)) return [];
  if (!fs.realpathSync(folder).startsWith(fs.realpathSync(root) + path.sep)) throw Error("Workflow directory must be inside the app root");
  const changed: string[] = [];
  for (const name of fs.readdirSync(folder).filter(name => /\.ya?ml$/.test(name)).sort()) {
    const relative = path.relative(root, path.join(folder, name));
    const fd = openMigrationFile(root, relative, check);
    if (fd === undefined) continue;
    try {
      const before = fs.readFileSync(fd, "utf8"), after = migrateContent(before);
      if (before === after) continue;
      if (!check) {
        const bytes = Buffer.from(after);
        let offset = 0;
        while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
        fs.ftruncateSync(fd, bytes.length);
      }
      changed.push(relative);
    } finally { fs.closeSync(fd); }
  }
  return changed;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 2 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v5-public-hosted-runners.ts [--check] [ROOT] [WORKFLOW_DIR]");
    const files = migrate(path.resolve(values[0] ?? "."), check, values[1]);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need migration" : "updated") + "; custom runner selectors require owner review");
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
