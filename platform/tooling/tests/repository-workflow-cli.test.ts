import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main, type RepositoryWorkflowStatus } from "../repository-workflow.ts";
import { run, type Run } from "../deploy-setup/io.ts";
import { RECORD } from "../repository-workflow/state.ts";
import { RECORD as UPDATE_RECORD, saveRecord as saveUpdateIntent } from "../setup-updates/state.ts";
import { fixture } from "./repository-workflow-fixtures.ts";

test("CLI discovers origin in a real empty Git repository and reports incomplete without creating a commit/branch/PR", async t => {
  const f = fixture(); t.after(f.cleanup); f.branchExists = false; f.hasPr = false;
  rmSync(path.join(f.root, RECORD));
  await run("git", ["init", "--initial-branch=main"], undefined, undefined, f.root);
  await run("git", ["remote", "add", "origin", "git@github.com:owner/app.git"], undefined, undefined, f.root);
  const before = await run("git", ["status", "--porcelain"], undefined, undefined, f.root);
  const outputs: string[] = [];
  const code = await main(["--check", "--json"], { root: f.root, exec: f.exec, write: v => outputs.push(v) });
  const result = JSON.parse(outputs.at(-1)!) as RepositoryWorkflowStatus;
  assert.equal(code, 2); assert.equal(result.readiness, "incomplete"); assert.equal(result.defaultBranchExists, false);
  assert.equal(result.discovery, null); assert.equal(result.featureAutoMergeAllowed, false);
  assert.equal(await run("git", ["status", "--porcelain"], undefined, undefined, f.root), before);
  assert.equal(await run("git", ["branch", "--show-current"], undefined, undefined, f.root), "main");
  await assert.rejects(() => run("git", ["rev-parse", "--verify", "HEAD"], undefined, undefined, f.root));
  assert(!existsSync(path.join(f.root, RECORD)));
  assert(f.calls.filter(c => c.file === "gh").every(c => c.args.includes("GET")));
});
test("CLI public flags check live paid/Free state and exact named maintenance eligibility with stable exit codes", async t => {
  const f = fixture(); t.after(f.cleanup); const output: string[] = [];
  const deps = { root: f.root, exec: f.exec, write: (v: string) => output.push(v) };
  assert.equal(await main(["--check", "--json", "--repo", "owner/app"], deps), 0);
  assert.equal(JSON.parse(output.at(-1)!).readiness, "enforced");
  assert.equal(await main(["--json", "--repo", "owner/app", "--maintenance-bot", "owner"], deps), 2);
  assert.equal(JSON.parse(output.at(-1)!).maintenanceAllowed, false);
  f.protectionError = 403; f.rulesError = 403;
  assert.equal(await main(["--check", "--json", "--repo", "owner/app"], deps), 2);
  assert.equal(JSON.parse(output.at(-1)!).readiness, "policy-only");
});
test("CLI selects adopted app intent with retained starter origin for inspection and first setup", async t => {
  for (const setup of [false, true]) {
    const f = fixture(); t.after(f.cleanup);
    rmSync(path.join(f.root, RECORD));
    saveUpdateIntent(f.root, "deferred", "owner/app", "deferred", []);
    const intent = readFileSync(path.join(f.root, UPDATE_RECORD), "utf8");
    const output: string[] = [];
    const exec: Run = async (file, args, input, env, cwd) => {
      if (file === "git") { assert.deepEqual(args, ["remote", "get-url", "origin"]); return "https://github.com/tkarakai/web-app-starter.git"; }
      return f.exec(file, args, input, env, cwd);
    };
    const args = setup ? ["--yes", "--json", "--approvals", "1", "--dismiss-stale-reviews"] : ["--check", "--json"];
    assert.equal(await main(args, { root: f.root, exec, write: value => output.push(value) }), setup ? 0 : 2);
    assert.equal(JSON.parse(output.at(-1)!).repository, "owner/app");
    assert(f.calls.some(c => c.args[1] === "repos/owner/app"));
    assert(!f.calls.some(c => c.args.some(a => a.includes("tkarakai/web-app-starter"))));
    assert.equal(readFileSync(path.join(f.root, UPDATE_RECORD), "utf8"), intent);
  }
});
test("CLI rejects conflicting app, workflow, explicit and downstream origin identities before GitHub calls", async t => {
  for (const conflict of ["workflow", "explicit", "origin", "invalid-intent"] as const) {
    for (const setup of [false, true]) {
      const f = fixture(); t.after(f.cleanup);
      saveUpdateIntent(f.root, "deferred", conflict === "workflow" ? "owner/other" : "owner/app", "deferred", []);
      if (conflict === "invalid-intent") {
        rmSync(path.join(f.root, UPDATE_RECORD));
        saveUpdateIntent(f.root, "deferred", "owner/other", "deferred", []);
        const record = JSON.parse(readFileSync(path.join(f.root, UPDATE_RECORD), "utf8"));
        record.schemaVersion = 9;
        writeFileSync(path.join(f.root, UPDATE_RECORD), JSON.stringify(record));
      }
      const exec: Run = async (file, args, input, env, cwd) => {
        if (file === "git") { assert.deepEqual(args, ["remote", "get-url", "origin"]); return conflict === "origin" ? "git@github.com:owner/other.git" : "git@github.com:tkarakai/web-app-starter.git"; }
        return f.exec(file, args, input, env, cwd);
      };
      const args = setup ? ["--yes", "--json"] : ["--check", "--json"];
      if (conflict === "explicit") args.push("--repo", "owner/other");
      await assert.rejects(() => main(args, { root: f.root, exec, write: () => {} }), /Conflicting|Invalid update-delivery/);
      assert.equal(f.calls.length, 0);
    }
  }
});
test("CLI requires explicit selection when origin gives no downstream identity", async t => {
  for (const origin of ["https://github.com/tkarakai/web-app-starter.git", "https://example.com/owner/app.git", undefined]) {
    const f = fixture(); t.after(f.cleanup); rmSync(path.join(f.root, RECORD));
    const output: string[] = [];
    const exec: Run = async (file, args, input, env, cwd) => {
      if (file === "git") { assert.deepEqual(args, ["remote", "get-url", "origin"]); if (!origin) throw Error("No origin"); return origin; }
      return f.exec(file, args, input, env, cwd);
    };
    const deps = { root: f.root, exec, write: (value: string) => output.push(value) };
    await assert.rejects(() => main(["--check", "--json"], deps), /pass --repo/);
    assert.equal(f.calls.length, 0);
    assert.equal(await main(["--check", "--json", "--repo", "owner/app"], deps), 2);
    assert.equal(JSON.parse(output.at(-1)!).repository, "owner/app");
  }
});
test("CLI saves/resumes first-PR contexts only under explicit owner consent and refuses read-only mutation flags", async t => {
  const f = fixture(); t.after(f.cleanup); f.protectionError = 404;
  const deps = { root: f.root, exec: f.exec, write: (_v: string) => {} };
  const before = readFileSync(path.join(f.root, RECORD), "utf8");
  await assert.rejects(() => main(["--check", "--yes", "--repo", "owner/app"], deps), /read-only/);
  await assert.rejects(() => main(["--check", "--discover-pr", "1", "--repo", "owner/app"], deps), /read-only/);
  await assert.rejects(() => main(["--yes", "--discover-pr", "0", "--repo", "owner/app"], deps), /positive PR/);
  await assert.rejects(() => main(["--unknown"], deps), /Usage/);
  assert.equal(f.calls.length, 0); assert.equal(readFileSync(path.join(f.root, RECORD), "utf8"), before);
  assert.equal(await main(["--yes", "--json", "--repo", "owner/app", "--discover-pr", "1", "--approvals", "2", "--dismiss-stale-reviews"], deps), 0);
  const saved = JSON.parse(readFileSync(path.join(f.root, RECORD), "utf8"));
  assert.equal(saved.discovery.pr, 1); assert.equal(saved.approvals, 2);
  assert.equal(saved.discovery.checks.find((c: { label: string }) => c.label === "Security Complete").context, "Platform / Security Complete");
});
