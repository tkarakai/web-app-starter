import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareAdoptionWorkflow } from "../adopt-workflow.ts";

function repository(t: { after: (f: () => void) => void }, defaultBranch = "main") {
  const root = mkdtempSync(path.join(tmpdir(), "adoption-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", defaultBranch);
  writeFileSync(path.join(root, "app.txt"), "source"); git("add", "."); git("commit", "-m", "Published source fixture");
  const source = git("rev-parse", "HEAD");
  const run = (file: string, args: string[]) => {
    if (file === "gh") {
      assert.deepEqual(args, ["api", "repos/owner/app"]);
      return JSON.stringify({ full_name: "owner/app", default_branch: defaultBranch });
    }
    assert.equal(file, "git");
    assert(["check-ref-format", "branch"].includes(args[0]), "Preflight must only inspect Git");
    return git(...args);
  };
  return { root, git, source, run };
}

for (const branch of ["main", "production"]) {
  test(`live ${branch} default refuses; explicit override and real task branch preserve Git state`, t => {
    const f = repository(t, branch);
    assert.throws(() => prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme" }, f.run), /bypasses review/);
    const result = prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme", allowDefaultBranch: true }, f.run);
    assert.equal(result.override, true);
    assert.equal(f.git("rev-parse", "HEAD"), f.source);
    assert.equal(f.git("status", "--porcelain"), "");
    assert.equal(f.git("branch", "--show-current"), branch);
    f.git("switch", "-c", "adopt/acme");
    assert.deepEqual(prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme" }, f.run), { taskBranch: "adopt/acme", override: false });
    assert.equal(f.git("rev-parse", "HEAD"), f.source);
  });
}

test("ordinary task-branch adoption preserves empty-target capabilities without bootstrap", t => {
  const f = repository(t); f.git("switch", "-c", "adopt/acme");
  const result = prepareAdoptionWorkflow(f.root, { repo: "owner/app", name: "Acme" }, f.run);
  assert.equal(result.taskBranch, "adopt/acme");
  assert.equal(f.git("rev-parse", "HEAD"), f.source);
  assert.equal(f.git("status", "--porcelain"), "");
});

test("unavailable or mismatched live metadata and detached HEAD fail without mutation", t => {
  const f = repository(t); const options = { repo: "owner/app", name: "Acme", allowDefaultBranch: true };
  assert.throws(() => prepareAdoptionWorkflow(f.root, options, () => { throw Error("credential failure"); }), /credential failure/);
  for (const metadata of [{ full_name: "other/app", default_branch: "main" }, { full_name: "owner/app" }, { full_name: "owner/app", default_branch: "bad branch" }]) {
    assert.throws(() => prepareAdoptionWorkflow(f.root, options, (file, args) => file === "gh" ? JSON.stringify(metadata) : f.git(...args)));
  }
  f.git("switch", "--detach");
  assert.throws(() => prepareAdoptionWorkflow(f.root, options, f.run), /task branch/);
  assert.equal(f.git("branch", "--show-current"), "");
  assert.equal(f.git("rev-parse", "HEAD"), f.source);
  assert.equal(f.git("status", "--porcelain"), "");
});
