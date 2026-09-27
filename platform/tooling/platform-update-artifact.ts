/** Package a completed verifier result for a separate job that holds write credentials. */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, demand, digest } from "./platform-upgrade/metadata.ts";
import { git, gitText } from "./platform-upgrade/git.ts";
import { readRegular } from "./platform-upgrade/io.ts";
import { readReport, exclusions } from "./platform-upgrade/report.ts";
import { workingFiles } from "./platform-upgrade/plan.ts";
import { REQUIRED_CHECKS } from "./platform-upgrade/verify.ts";
import { version } from "./platform-upgrade/semver.ts";

export function packageUpgrade(root: string, destination: string, reportFile: string): void {
  root = fs.realpathSync(root); reportFile = fs.realpathSync(reportFile);
  const report = readReport(reportFile), p = report.plan;
  demand(["verified", "needs-review"].includes(report.outcome), "Only verified or reviewable updates can become PRs");
  demand(!report.state.requiresReplan && !report.state.activeStep, "Interrupted or unexpected writes cannot become an update PR");
  demand(gitText(root, ["rev-parse", "HEAD"]) === p.app.head, "App HEAD changed during verification");
  demand(canonical(workingFiles(root, exclusions(root, reportFile))) === canonical(report.state.expectedFiles), "App files changed after the upgrade report");
  if (report.outcome === "verified") {
    demand(report.state.stage === "recorded" && REQUIRED_CHECKS.every(script => report.state.steps.some(step => step.id === "verify:" + script && step.status === "passed")), "Ready PR needs complete verification evidence");
  }
  const relative = path.relative(root, reportFile).split(path.sep).join("/");
  demand(relative === "upgrade-report.json", "Workflow report must be upgrade-report.json in the app root");
  git(root, ["add", "--", relative, "upgrade-report.md"]);
  demand(gitText(root, ["diff", "--name-only"]) === "", "Unstaged app changes cannot enter the delivery artifact");
  const patch = git(root, ["diff", "--cached", "--binary", "--full-index", "HEAD"]);
  demand(patch.length > 0 && patch.length <= 32 * 1024 * 1024, "Update patch is empty or exceeds 32 MiB");
  const markdown = readRegular(path.join(root, "upgrade-report.md"), 8 * 1024 * 1024).content;
  const labels = ["platform-update"];
  const severity = p.advisories.reduce((highest, row) => ["none", "low", "medium", "high", "critical"].indexOf(row.severity) > ["none", "low", "medium", "high", "critical"].indexOf(highest) ? row.severity : highest, "none");
  if (severity !== "none") labels.push("severity:" + severity);
  if (p.migrations.length) labels.push("migration");
  if (p.environment.changes.some(row => row.kind === "new")) labels.push("new-env");
  if (p.removedFiles.length || p.renamedExports.length || p.environment.changes.some(row => row.kind !== "new")) labels.push("breaking");
  const before = version(p.installed.version), after = version(p.target.version);
  const autoMergeEligible = report.outcome === "verified" && before[0] === after[0] && before[1] === after[1] && after[2] > before[2] && !p.migrations.length && !p.environment.changes.length && !p.patches.some(row => !row.absorbed) && !p.gates.some(row => row.kind === "advisory");
  fs.mkdirSync(destination, { recursive: true });
  const result = { schemaVersion: 1, baseHead: p.app.head, installed: p.installed.version, target: p.target.version, targetCommit: p.target.commit, planDigest: p.digest, outcome: report.outcome, tree: gitText(root, ["write-tree"]), patchDigest: digest(patch), markdownDigest: digest(markdown), labels, autoMergeEligible };
  fs.writeFileSync(path.join(destination, "update.patch"), patch, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(path.join(destination, "report.md"), markdown, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(path.join(destination, "delivery.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { demand(process.argv.length === 3, "Usage: platform-update-artifact.ts OUTPUT_DIRECTORY"); packageUpgrade(process.cwd(), path.resolve(process.argv[2]), path.join(process.cwd(), "upgrade-report.json")); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; }
}
