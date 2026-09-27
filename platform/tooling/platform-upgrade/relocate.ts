import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { canonical, demand, digest } from "./metadata.ts";
import { git, gitText } from "./git.ts";
import { workingFiles } from "./plan.ts";
import { readRegular } from "./io.ts";
import { reportAppRoot, sealState, type Report } from "./report.ts";

/** A draft can travel through a PR. Its immutable plan never changes with its location. */
export function relocateReport(report: Report, destination: string, excluded: string[]): void {
  const root = fs.realpathSync(destination);
  if (reportAppRoot(report) === root) return;
  demand(fs.realpathSync(gitText(root, ["rev-parse", "--show-toplevel"])) === root, "Relocate at the app repository root");
  demand(report.state.stage !== "recorded", "This upgrade is already recorded; run the app's CI in the new checkout");
  demand(!report.state.activeStep && !report.state.requiresReplan, "Finish or inspect the interrupted command in the original checkout before relocating");
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) demand(!fs.existsSync(path.resolve(root, gitText(root, ["rev-parse", "--git-path", marker]))), "Finish the active Git operation before relocating");
  demand(gitText(root, ["branch", "--show-current"]) === "platform-update/v" + report.plan.target.version, "Check out the draft's platform-update branch before relocating");
  demand(spawnSync("git", ["merge-base", "--is-ancestor", report.plan.app.head, "HEAD"], { cwd: root }).status === 0, "Draft history does not descend from the planned app commit");
  demand(digest(readRegular(path.join(root, ".platform-base.json")).content) === report.plan.previousBaseHash, "Installed baseline changed; refusing relocation");
  demand(canonical(workingFiles(root, excluded)) === canonical(report.state.expectedFiles), "Draft files changed; relocate its exact committed state before making review edits");
  const indexed = git(root, ["diff", "--name-only", "-z"]).toString("utf8").split("\0").filter(Boolean);
  demand(indexed.every(file => excluded.includes(file)), "Index and working tree differ; refusing relocation");
  // A new machine has different dependencies and secrets. Keep only portable review and
  // codemod evidence, then re-run every check before advancing the installed baseline.
  report.state.executionRoot = root;
  report.state.decisions = report.state.decisions.filter(row => row.action !== "secret-configured");
  report.state.steps = report.state.steps.filter(row => row.id !== "install" && !row.id.startsWith("verify:"));
  if (["installed", "verified"].includes(report.state.stage)) report.state.stage = "codemods";
  report.outcome = "needs-review";
  delete report.state.error;
  sealState(report.state);
}
