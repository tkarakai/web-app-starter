import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { demand } from "./metadata.ts";
import { version } from "./semver.ts";
import type { Decision } from "./report.ts";
export type Arguments = { to?: string; source?: string; resume?: string; report?: string; dryRun: boolean; deferE2e: boolean; resolve?: string; action?: Decision["action"]; evidence?: string; migrationEvidence?: string; appRoot?: string; bootstrapProtocol?: string; targetCommit?: string };
export function argumentsFor(argv: string[]): Arguments {
  const result: Arguments = { dryRun: false, deferE2e: false };
  const values: Record<string, keyof Arguments> = { "--to": "to", "--source": "source", "--resume": "resume", "--report": "report", "--resolve": "resolve", "--action": "action", "--evidence": "evidence", "--migration-evidence": "migrationEvidence", "--app-root": "appRoot", "--bootstrap-protocol": "bootstrapProtocol", "--target-commit": "targetCommit" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--defer-e2e") result.deferE2e = true;
    else if (arg === "--non-interactive") { /* All commands are non-interactive. */ }
    else { const key = values[arg]; demand(key, "Unknown argument: " + arg); const value = argv[++i]; demand(value && !value.startsWith("--"), arg + " needs a value"); demand(result[key] === undefined, "Repeated option: " + arg); Object.assign(result, { [key]: value }); }
  }
  demand(Boolean(result.to) !== Boolean(result.resume), "Supply exactly one of --to or --resume");
  if (result.to) { result.to = result.to.replace(/^v/, ""); version(result.to); }
  demand(!result.resume || (!result.source && !result.report && !result.dryRun), "Resume uses the saved source and report; it cannot be a new dry run");
  demand(!result.resolve || (result.resume && result.action && result.evidence), "A resolution needs --resume, --action and --evidence");
  demand(result.resolve || (!result.action && !result.evidence && !result.migrationEvidence), "Decision options require --resolve");
  return result;
}
export function reportLocation(argument?: string): string { return path.resolve(argument ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "platform-upgrade-report-")), "report.json")); }
export const HELP = `Usage:
  bun run platform:upgrade --to vX.Y.Z --dry-run [--report report.json]
  bun run platform:upgrade --to vX.Y.Z --non-interactive [--report report.json]
  bun run platform:upgrade --resume report.json [--defer-e2e]
  bun run platform:upgrade --resume report.json --resolve ITEM_ID --action ACTION --evidence 'specific review evidence'

Resolutions are bound to one plan and item. Actions: reviewed, accept-release,
reapply-patch, secret-configured, migration-complete (also --migration-evidence FILE).
A resolution records a decision only; run --resume again to continue.
--source owner/repo or a local Git repository explicitly selects another trusted source.
Exit 0: planned/unchanged/verified; 2: needs-review; 1: failed. Inspect report.outcome.
`;
