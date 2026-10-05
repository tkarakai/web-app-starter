import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { canonical, demand, digest } from "./metadata.ts";
import { git, gitText, loadRelease } from "./git.ts";
import { createPlan, workingFiles, type Planned } from "./plan.ts";
import { acceptReviewedEdits, assertBeforeApply, changedFiles, ensureUpdateBranch, materializePayloads, stage } from "./files.ts";
import { readRegular, writeAtomic } from "./io.ts";
import { inScope, secretValueFile } from "./ownership.ts";
import { execute, redact, type Execute } from "./commands.ts";
import { candidateBase, REQUIRED_CHECKS, verifyDependencies, verifySource } from "./verify.ts";
import { reportAppRoot, decisionFor, exclusions, unresolved, writeReport, type Report, type Step } from "./report.ts";

export async function reconstruct(report: Report, plannedTarget: Planned["cache"], excluded: string[]): Promise<Planned> {
  const root = reportAppRoot(report), original = path.join(plannedTarget.directory, "original-app");
  git(plannedTarget.directory, ["clone", "--quiet", "--no-local", "--no-checkout", "--no-tags", "--", root, original]);
  git(original, ["checkout", "--quiet", "--detach", report.plan.app.head]);
  const planned = await createPlan({ root: original, source: report.plan.source, to: report.plan.target.version, advisoryRelease: report.plan.advisorySource?.version, cache: plannedTarget, excluded, identity: report.plan.app });
  demand(planned.plan.digest === report.plan.digest, "Saved plan no longer matches its source, release metadata or original app commit");
  return planned;
}

export async function applyUpgrade(report: Report, planned: Planned, options: { reportFile: string; deferE2e?: boolean; execute?: Execute }): Promise<Report> {
  const root = reportAppRoot(report), excluded = exclusions(root, options.reportFile), run = options.execute ?? execute;
  const save = () => writeReport(options.reportFile, report);
  const snapshot = () => workingFiles(root, excluded);
  const pending = (message?: string) => { report.outcome = "needs-review"; report.state.error = message; save(); return report; };
  const baselinePath = path.join(root, ".platform-base.json"), baselineText = readRegular(baselinePath).content.toString("utf8");
  const checkBaseline = () => {
    let matches = false;
    try { matches = digest(readRegular(baselinePath).content) === report.plan.previousBaseHash; } catch { /* Missing or replaced baseline is an external mutation. */ }
    if (!matches) {
      writeAtomic(baselinePath, baselineText); report.state.requiresReplan = true;
      throw new Error("An external command changed the installed baseline; restored its original bytes. Inspect the command and create a new plan.");
    }
  };
  const command = async (id: string, args: string[], cwd: string, allowed: (file: string) => boolean, accepted = [0]): Promise<Step> => {
    const before = snapshot(); report.state.activeStep = id; save();
    process.stdout.write("platform-upgrade: " + id + "\n");
    const result = await run(args, cwd); checkBaseline();
    const after = snapshot(), touched = changedFiles(before, after), unexpected = touched.filter(file => !allowed(file));
    const step: Step = { id, command: args, status: accepted.includes(result.exitCode) && !unexpected.length ? "passed" : "failed", exitCode: result.exitCode, log: redact(result.log), changedFiles: touched };
    report.state.steps = report.state.steps.filter(row => row.id !== id).concat(step);
    report.state.expectedFiles = after; delete report.state.activeStep;
    if (unexpected.length) { report.state.requiresReplan = true; step.log += "\nUnexpected file changes: " + unexpected.join(", "); }
    save(); demand(step.status === "passed", id + " failed. " + step.log); return step;
  };
  try {
    demand(report.plan.digest === planned.plan.digest, "Cannot apply another plan");
    demand(!report.state.requiresReplan, "An earlier command changed unexpected files; inspect the report and create a new plan");
    if (report.state.stage === "recorded") {
      demand(canonical(snapshot()) === canonical(report.state.expectedFiles), "App changed after verification; run the app's CI again");
      report.outcome = "verified"; save(); return report;
    }
    if (report.state.stage === "verified" && baselineText === JSON.stringify(candidateBase(report), null, 2) + "\n") {
      demand(gitText(root, ["branch", "--show-current"]) === report.state.branch, "Resume on the original update branch");
      demand(changedFiles(report.state.expectedFiles, snapshot()).every(file => file === ".platform-base.json"), "App changed during baseline recording");
      demand(REQUIRED_CHECKS.every(script => report.state.steps.some(row => row.id === "verify:" + script && row.status === "passed")), "Verification evidence is incomplete");
      verifySource(report, planned.cache.directory, excluded); verifyDependencies(report);
      stage(root, [".platform-base.json"], planned.cache.directory); report.state.stage = "recorded"; report.state.expectedFiles = snapshot(); report.outcome = "verified"; delete report.state.error; save(); return report;
    }
    demand(digest(baselineText) === report.plan.previousBaseHash, "Installed baseline changed during this upgrade");
    if (report.state.stage === "planned") {
      assertBeforeApply(report, planned, excluded);
      if (unresolved(report, true).length) return pending();
      report.state.branch = ensureUpdateBranch(root, report.plan.target.version); save();
      materializePayloads(root, planned.payloads); stage(root, planned.payloads.map(row => row.path), planned.cache.directory);
      report.state.expectedFiles = snapshot(); report.state.stage = "applied"; save();
      if (report.plan.gates.some(gate => decisionFor(report, gate)?.action === "reapply-patch")) return pending("Reapply the reviewed patches to the new platform files, retaining their PLATFORM-PATCH markers, then resume.");
    } else {
      demand(gitText(root, ["branch", "--show-current"]) === report.state.branch, "Resume on the original update branch");
      demand(spawnSync("git", ["merge-base", "--is-ancestor", report.plan.app.head, "HEAD"], { cwd: root }).status === 0, "App history no longer descends from the planned commit");
      // An interrupted command may have written only its declared paths. Its --check runs on resume.
      const codemod = report.plan.codemods.find(row => report.state.activeStep === "codemod:" + row.id);
      if (codemod) {
        const current = snapshot(), touched = changedFiles(report.state.expectedFiles, current);
        demand(touched.every(file => file !== ".platform-base.json" && !secretValueFile(file) && codemod.touches.some(scope => inScope(file, scope))), "Interrupted codemod changed unexpected files; preserve them and replan");
        stage(root, touched, planned.cache.directory); report.state.expectedFiles = snapshot();
      }
      if (report.state.activeStep === "install") {
        const current = snapshot(), touched = changedFiles(report.state.expectedFiles, current); demand(touched.every(file => file === "bun.lock"), "Interrupted install changed unexpected files; inspect and replan"); stage(root, touched, planned.cache.directory); report.state.expectedFiles = snapshot();
      }
      const reviewed = acceptReviewedEdits(report, excluded); stage(root, reviewed, planned.cache.directory); report.state.expectedFiles = snapshot();
      if (reviewed.length) { report.state.steps = report.state.steps.filter(row => !row.id.startsWith("verify:") && row.id !== "install"); report.state.stage = report.state.stage === "applied" ? "applied" : "codemods"; }
      save();
    }
    if (unresolved(report).length) return pending();
    // A normal clone does not transfer refs/platform-upgrade or their otherwise unreachable
    // objects. Import the already-validated target for the candidate zone check on resume too.
    git(root, ["fetch", "--quiet", "--no-tags", planned.cache.repo, report.plan.target.commit + ":refs/platform-upgrade/" + report.plan.digest]);
    // Stop before executing scripts while a seam still contains conflict markers.
    for (const change of report.plan.changes.filter(row => row.conflict)) demand(!/^(?:<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)(?: |$)/m.test(fs.readFileSync(path.join(root, change.path), "utf8")), "Resolve seam conflict before running scripts: " + change.path);
    if (report.state.stage === "applied") {
      for (const codemod of report.plan.codemods) {
        const id = "codemod:" + codemod.id;
        if (report.state.steps.some(row => row.id === id + ":idempotence" && row.status === "passed")) continue;
        const release = await loadRelease(planned.cache, codemod.release);
        demand(report.plan.releases.some(row => row.version === release.version && row.commit === release.commit), "Codemod release identity changed");
        if (fs.existsSync(path.join(release.directory, "bun.lock"))) await command(id + ":dependencies", ["bun", "install", "--frozen-lockfile", "--ignore-scripts"], release.directory, () => false);
        const executable = [process.execPath, path.join(release.directory, codemod.path)];
        const check = await command(id + ":check", [...executable, "--check"], root, () => false, [0, 1]);
        if (check.exitCode !== 0) await command(id, executable, root, file => file !== ".platform-base.json" && !secretValueFile(file) && codemod.touches.some(scope => inScope(file, scope)));
        await command(id + ":idempotence", [...executable, "--check"], root, () => false);
        stage(root, changedFiles(report.state.expectedFiles, snapshot()).concat(report.state.steps.find(row => row.id === id)?.changedFiles ?? []), planned.cache.directory);
      }
      report.state.expectedFiles = snapshot(); report.state.stage = "codemods"; save();
    }
    if (report.state.stage === "codemods") {
      await command("install", ["bun", "install"], root, file => file === "bun.lock");
      stage(root, ["bun.lock"], planned.cache.directory); report.state.expectedFiles = snapshot(); report.state.stage = "installed"; save();
    }
    verifySource(report, planned.cache.directory, excluded); verifyDependencies(report);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    for (const script of REQUIRED_CHECKS) {
      demand(typeof pkg.scripts?.[script] === "string", "Required verification script is missing: " + script);
      const id = "verify:" + script;
      if (script === "test:e2e" && options.deferE2e) {
        if (!report.state.steps.some(row => row.id === id && row.status === "passed")) report.state.steps = report.state.steps.filter(row => row.id !== id).concat({ id, command: ["bun", "run", script], status: "pending", exitCode: null, log: "Run --resume without --defer-e2e to verify and finalize.", changedFiles: [] });
        continue;
      }
      if (!report.state.steps.some(row => row.id === id && row.status === "passed")) {
        try { await command(id, ["bun", "run", script], root, () => false); }
        catch (error) {
          if (script === "check:dependencies") throw new Error(String(error) + "\nRefresh only affected transitive resolutions in bun.lock under the dependency release-age policy, then --resume. Registry access is required to verify this app lockfile.", { cause: error });
          throw error;
        }
      }
    }
    if (report.state.steps.some(row => row.status === "pending")) return pending("Required E2E verification is pending; the installed baseline is unchanged.");
    verifySource(report, planned.cache.directory, excluded); verifyDependencies(report);
    report.state.stage = "verified"; save();
    writeAtomic(baselinePath, JSON.stringify(candidateBase(report), null, 2) + "\n");
    try { verifySource(report, planned.cache.directory, excluded); }
    catch (error) { writeAtomic(baselinePath, baselineText); throw error; }
    stage(root, [".platform-base.json"], planned.cache.directory);
    report.state.stage = "recorded"; report.state.expectedFiles = snapshot(); report.outcome = "verified"; delete report.state.error; save(); return report;
  } catch (error) {
    report.outcome = "failed"; report.state.error = redact(error instanceof Error ? error.message : String(error)); save(); return report;
  }
}
