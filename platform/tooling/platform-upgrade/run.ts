import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { argumentsFor, HELP, reportLocation } from "./cli.ts";
import { canonical, demand } from "./metadata.ts";
import { createCache, loadRelease, resolveSource } from "./git.ts";
import { createPlan, workingFiles } from "./plan.ts";
import { createReport, exclusions, reportAppRoot, readReport, recordDecision, unresolved, writeReport } from "./report.ts";
import { applyUpgrade, reconstruct } from "./engine.ts";
import { relocateReport } from "./relocate.ts";
import { redact } from "./commands.ts";

export function assertRuntime(nodeMajor: number, bun: string): void {
  demand(Number(process.versions.node.split(".")[0]) === nodeMajor, "Target requires Node " + nodeMajor + "; select it before running the upgrade");
  demand(execFileSync("bun", ["--version"], { encoding: "utf8" }).trim() === bun, "Target requires Bun " + bun + "; install/select that version before running the upgrade");
}
export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help")) { process.stdout.write(HELP); return 0; }
  const args = argumentsFor(argv);
  demand(args.bootstrapProtocol === "1" && /^[0-9a-f]{40}$/.test(args.targetCommit ?? "") && args.appRoot, "Invoke platform:upgrade through its launcher; target protocol 1 is required");
  const root = fs.realpathSync(args.appRoot), saved = args.resume ? readReport(args.resume) : undefined;
  if (saved) demand(args.relocate || reportAppRoot(saved) === root, "Saved plan belongs to another app checkout");
  const source = saved?.plan.source ?? resolveSource(args.source), to = saved?.plan.target.version ?? args.to!;
  const cache = createCache(source);
  try {
    const target = await loadRelease(cache, to);
    demand(target.commit === args.targetCommit, "Target changed after bootstrap; no app changes were made");
    if (saved) demand(target.commit === saved.plan.target.commit && target.manifestDigest === saved.plan.target.manifestDigest, "Saved target identity changed");
    assertRuntime(target.manifest.runtime.nodeMajor, target.manifest.runtime.bun);
    const file = saved ? fs.realpathSync(args.resume!) : reportLocation(args.report), excluded = exclusions(root, file);
    process.stdout.write("Upgrade report: " + file + "\n");
    if (saved && args.relocate) { relocateReport(saved, root, excluded); writeReport(file, saved); }
    if (args.resolve) {
      recordDecision(saved!, { id: args.resolve, action: args.action!, evidence: args.evidence!, migrationEvidence: args.migrationEvidence });
      writeReport(file, saved!); process.stdout.write("Decision recorded. Run --resume to continue.\n"); return 0;
    }
    const planned = saved ? await reconstruct(saved, cache, excluded) : await createPlan({ root, source, to, advisoryRelease: args.advisoryRelease, cache, excluded });
    const report = saved ?? createReport(planned.plan, workingFiles(root, excluded));
    if (!saved) {
      demand(canonical(report.plan.source) === canonical(source), "Source identity mismatch");
      report.outcome = unresolved(report).length ? "needs-review" : planned.plan.installed.version === to && !planned.plan.changes.length ? "unchanged" : "planned";
      writeReport(file, report);
    }
    if (!args.dryRun && report.outcome !== "unchanged") await applyUpgrade(report, planned, { reportFile: file, deferE2e: args.deferE2e });
    process.stdout.write("platform-upgrade: " + report.outcome + "; " + file + "\n");
    if (report.outcome === "failed" && report.state.error) process.stderr.write(redact(report.state.error) + "\n");
    return report.outcome === "failed" ? 1 : report.outcome === "needs-review" ? 2 : 0;
  } finally { fs.rmSync(cache.directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { process.stderr.write("platform-upgrade: " + redact(error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; });
}
