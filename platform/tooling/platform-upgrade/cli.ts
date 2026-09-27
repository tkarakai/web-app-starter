import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { demand } from "./metadata.ts";
import { version } from "./semver.ts";
import type { Decision } from "./report.ts";
export type Arguments = { to?: string; advisoryRelease?: string; source?: string; resume?: string; report?: string; relocate: boolean; dryRun: boolean; deferE2e: boolean; resolve?: string; action?: Decision["action"]; evidence?: string; migrationEvidence?: string; appRoot?: string; bootstrapProtocol?: string; targetCommit?: string };
export function argumentsFor(argv: string[]): Arguments {
  const result: Arguments = { relocate: false, dryRun: false, deferE2e: false };
  const values: Record<string, keyof Arguments> = { "--to": "to", "--advisory-release": "advisoryRelease", "--source": "source", "--resume": "resume", "--report": "report", "--resolve": "resolve", "--action": "action", "--evidence": "evidence", "--migration-evidence": "migrationEvidence", "--app-root": "appRoot", "--bootstrap-protocol": "bootstrapProtocol", "--target-commit": "targetCommit" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--relocate") result.relocate = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--defer-e2e") result.deferE2e = true;
    else if (arg === "--non-interactive") { /* All commands are non-interactive. */ }
    else { const key = values[arg]; demand(key, "Unknown argument: " + arg); const value = argv[++i]; demand(value && !value.startsWith("--"), arg + " needs a value"); demand(result[key] === undefined, "Repeated option: " + arg); Object.assign(result, { [key]: value }); }
  }
  demand(Boolean(result.to) !== Boolean(result.resume), "Supply exactly one of --to or --resume");
  demand(!result.relocate || result.resume, "--relocate requires --resume");
  if (result.advisoryRelease) { result.advisoryRelease = result.advisoryRelease.replace(/^v/, ""); version(result.advisoryRelease); }
  if (result.to) { result.to = result.to.replace(/^v/, ""); version(result.to); }
  demand(!result.resume || (!result.source && !result.report && !result.dryRun && !result.advisoryRelease), "Resume uses the saved source and report; it cannot be a new dry run");
  demand(!result.resolve || (result.resume && result.action && result.evidence), "A resolution needs --resume, --action and --evidence");
  demand(result.resolve || (!result.action && !result.evidence && !result.migrationEvidence), "Decision options require --resolve");
  return result;
}
export function reportLocation(argument?: string): string { return path.resolve(argument ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "platform-upgrade-report-")), "report.json")); }
export const HELP = `Usage:
  bun run platform:upgrade --to vX.Y.Z --dry-run [--report report.json]
  bun run platform:upgrade --to vX.Y.Z --non-interactive [--report report.json]
  bun run platform:upgrade --resume report.json [--relocate] [--defer-e2e]
  bun run platform:upgrade --resume report.json --resolve ITEM_ID --action ACTION --evidence 'specific review evidence'

--relocate binds an unfinished draft to this checkout after checking its exact tree and history.
It repeats installation and verification; completed codemods and the immutable plan are retained.
Resolutions are bound to one plan and item. Actions: reviewed, accept-release,
reapply-patch, secret-configured, migration-complete (also --migration-evidence FILE).
A resolution records a decision only; run --resume again to continue.
--source owner/repo or a local Git repository explicitly selects another trusted source.
--advisory-release vX.Y.Z includes newer cumulative advisory metadata in the pinned plan.
Exit 0: planned/unchanged/verified; 2: needs-review; 1: failed. Inspect report.outcome.
`;
