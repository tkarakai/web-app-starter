import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { adoptionCommands, prepareAdoptionWorkflow } from "../adopt-workflow.ts";

function repository(t: { after: (f: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), "adoption-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main"); writeFileSync(path.join(root, "app.txt"), "source"); git("add", "."); git("commit", "-m", "Published source fixture");
  const source = git("rev-parse", "HEAD");
  let refs = source + "\trefs/heads/main", unavailable = false;
  const calls: string[][] = [];
  const run = (file: string, args: string[]) => {
    calls.push([file, ...args]);
    if (file === "gh") { if (unavailable) throw Error("credential failure"); return JSON.stringify({ full_name: "owner/app", default_branch: "main" }); }
    assert.equal(file, "git");
    if (args[0] === "ls-remote") { if (unavailable) throw Error("remote failure"); return refs; }
    assert(!args.includes("push")); return git(...args);
  };
  return { root, git, source, calls, run, empty: () => { refs = ""; }, unavailable: () => { unavailable = true; } };
}
test("empty private target gets an empty local base and task branch with exact separate push and draft PR commands", t => {
  const f = repository(t); f.empty();
  assert.throws(() => prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme" }, f.run), /--bootstrap/);
  const result = prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme", bootstrap: true }, f.run);
  assert.equal(result.taskBranch, "bootstrap/adopt-acme"); assert.equal(f.git("branch", "--show-current"), result.taskBranch);
  assert.equal(f.git("ls-tree", "--name-only", result.bootstrapCommit!), "");
  assert.equal(f.git("rev-list", "--count", result.bootstrapCommit!), "1");
  assert.equal(f.git("merge-base", "--is-ancestor", result.bootstrapCommit!, "HEAD"), "");
  assert.equal(readFileSync(path.join(f.root, "app.txt"), "utf8"), "source");
  const commands = adoptionCommands(result);
  assert(commands[0].includes(`${result.bootstrapCommit}:refs/heads/'main'`));
  assert(commands.some(line => line === "git push 'https://github.com/owner/app.git' HEAD:refs/heads/'bootstrap/adopt-acme'"));
  assert(commands.some(line => line.startsWith("gh pr create --repo 'owner/app' --draft --base 'main' --head 'bootstrap/adopt-acme'")));
  assert(!f.calls.some(row => row.includes("push")));
});
test("existing protected repository default branch refuses before editing; owner override is explicit", t => {
  const f = repository(t);
  assert.throws(() => prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme" }, f.run), /bypasses review/);
  assert.equal(f.git("rev-parse", "HEAD"), f.source);
  assert.equal(f.git("status", "--porcelain"), "");
  const result = prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme", allowDefaultBranch: true }, f.run);
  assert.equal(result.override, true); assert.equal(adoptionCommands(result).length, 1);
  f.git("switch", "-c", "adopt/app");
  assert.equal(prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme" }, f.run).override, false);
  assert.throws(() => prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme", bootstrap: true }, f.run), /verified empty/);
});
test("unknown target access cannot select bootstrap, and detached existing source creates a task branch", t => {
  const f = repository(t); f.git("switch", "--detach");
  assert.equal(prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme" }, f.run).taskBranch, "bootstrap/adopt-acme");
  f.unavailable();
  assert.throws(() => prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme", bootstrap: true }, f.run), /credential failure/);
  assert.equal(f.git("rev-parse", "HEAD"), f.source);
});

test("normalized CI callers run draft bootstrap work and publish discoverable completion contexts", () => {
  const workflow = (file: string) => JSON.parse(execFileSync("bun", ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))", new URL(`../../../.github/workflows/${file}.yml`, import.meta.url).pathname], { encoding: "utf8" })) as {
    on: { pull_request?: { types?: string[] } | null };
    jobs: Record<string, { if?: string; name?: string; uses?: string; needs?: string[]; steps?: { run?: string }[] }>;
  };
  for (const app of ["shared", "web", "admin", "landing", "storybook"]) {
    const caller = workflow("ci-" + app);
    assert(caller.on.pull_request?.types?.includes("opened"));
    assert(caller.on.pull_request?.types?.includes("synchronize"));
    assert.equal(caller.jobs.platform.if, undefined, "Drafts must run the reusable CI caller");
    assert.equal(caller.jobs.platform.uses, `./.github/workflows/platform-ci-${app}.yml`);
    const complete = caller.jobs.complete;
    assert.equal(complete.name, "CI " + app[0].toUpperCase() + app.slice(1) + " Complete");
    assert.deepEqual(complete.needs, ["platform"]); assert.equal(complete.if, "always()");
    const script = complete.steps!.find(step => step.run)!.run!;
    execFileSync("bash", ["-c", script.replaceAll("${{ needs.platform.result }}", "success")]);
    assert.throws(() => execFileSync("bash", ["-c", script.replaceAll("${{ needs.platform.result }}", "failure")], { stdio: "pipe" }));
  }
  const security = workflow("security");
  assert(Object.hasOwn(security.on, "pull_request")); assert.equal(security.jobs.platform.if, undefined);
  assert.equal(workflow("platform-security").jobs.complete.name, "Security Complete");
});
