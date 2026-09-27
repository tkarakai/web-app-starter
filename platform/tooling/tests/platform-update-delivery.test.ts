import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packageUpgrade } from "../platform-update-artifact.ts";
import { fixture, git, temp, write } from "../platform-upgrade/fixtures.ts";
import { createReport } from "../platform-upgrade/report.ts";
import { workingFiles } from "../platform-upgrade/plan.ts";
import { applyUpgrade } from "../platform-upgrade/engine.ts";
import { REQUIRED_CHECKS } from "../platform-upgrade/verify.ts";

const workflow = fs.readFileSync(fileURLToPath(new URL("../../../.github/workflows/platform-update.yml", import.meta.url)), "utf8");
const deliveryScript = workflow.slice(workflow.lastIndexOf("          script: |\n") + "          script: |\n".length).split("\n").map(line => line.startsWith("            ") ? line.slice(12) : line).join("\n");
type Input = Record<string, unknown>;
async function prepared(review = false, workflowChange = false) {
  const f = fixture(), pkg = JSON.stringify({ name: "app", scripts: Object.fromEntries(REQUIRED_CHECKS.map(name => [name, "true"])) });
  write(f.source, "package.json", pkg); write(f.app, "package.json", pkg); git(f.app, "add", "-A"); git(f.app, "commit", "-qm", "commands");
  if (workflowChange) write(f.source, ".github/workflows/platform-fixture.yml", "name: changed\n");
  f.publish("2.0.1", release => { if (review) release.env.push({ name: "NEW_SECRET", secret: true, required: true, kind: "new" }); });
  const planned = await f.plan("2.0.1"), report = createReport(planned.plan, workingFiles(f.app)), file = path.join(f.app, "upgrade-report.json"), artifact = temp();
  await applyUpgrade(report, planned, { reportFile: file, execute: async () => ({ exitCode: 0, log: "fixture verification" }) });
  packageUpgrade(f.app, path.join(artifact, "delivery"), file);
  write(artifact, "discovery/discovery.json", JSON.stringify({ schemaVersion: 1, source: "owner/platform", installed: "2.0.0", severity: "none", target: { version: "2.0.1" } }));
  return { f, report, file, artifact };
}
async function deliver(p: Awaited<ReturnType<typeof prepared>>, changes: Record<string, string> = {}, options: { duplicate?: boolean; protected?: boolean; advanced?: boolean } = {}) {
  const clone = temp(); git(clone, "init", "-q"); git(clone, "fetch", "-q", p.f.app, "HEAD"); git(clone, "checkout", "-q", "--detach", "FETCH_HEAD");
  const env = { RUNNER_TEMP: p.artifact, CHECK_RESULT: "success", VERIFY_RESULT: "success", SOURCE: "owner/platform", TARGET: "2.0.1", MAJOR: "", BASE_HEAD: p.report.plan.app.head, BASE_BRANCH: "main", APP_TOKEN: "fixture-token", AUTO_MERGE: "true", ...changes };
  const issues: Input[] = [], prs: Input[] = [], pushes: string[][] = [], merges: Input[] = [], errors: string[] = [];
  const github = {
    paginate: async () => [], graphql: async (_: string, data: Input) => { merges.push(data); },
    rest: {
      pulls: { list: async () => ({ data: options.duplicate ? [{ html_url: "existing" }] : [] }), create: async (data: Input) => { prs.push(data); return { data: { number: 1, html_url: "created", node_id: "PR_fixture" } }; } },
      repos: { getBranch: async () => ({ data: { commit: { sha: options.advanced ? "a".repeat(40) : env.BASE_HEAD }, protected: options.protected ?? false, protection: { required_status_checks: { contexts: ["CI"] } } } }) },
      issues: { listForRepo: async () => [], getLabel: async () => ({}), createLabel: async () => ({}), addLabels: async () => ({}), create: async (data: Input) => { issues.push(data); } },
    },
  };
  await vm.runInNewContext("(async()=>{\n" + deliveryScript + "\n})()", {
    process: { env }, Buffer, Error,
    context: { repo: { owner: "owner", repo: "app" }, runId: 1 }, github,
    core: { getInput: () => "fallback-token", notice: () => {}, setFailed: (message: string) => { errors.push(message); } },
    require: (name: string) => {
      if (name === "node:fs") return fs;
      if (name === "node:crypto") return crypto;
      if (name === "node:child_process") return { execFileSync: (command: string, args: string[], config: Input) => {
        assert.equal(command, "git"); assert(args.includes("core.hooksPath=/dev/null"));
        if (args.includes("push")) { assert(!args.some(arg => /force|fixture-token|fallback-token/.test(arg))); pushes.push(args); return ""; }
        return execFileSync(command, args, { ...config, cwd: clone, encoding: "utf8" });
      } };
      throw Error("Unexpected dependency " + name);
    },
  });
  return { issues, prs, pushes, merges, errors, clone };
}
test("delivery applies the exact artifact, opens a ready PR, and only enables auto-merge with required checks", async () => {
  const p = await prepared(), result = await deliver(p);
  assert.equal(result.errors.length, 0); assert.equal(result.pushes.length, 1); assert.equal(result.prs[0].draft, false); assert.equal(result.merges.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.clone, ".platform-base.json"), "utf8")).version, "2.0.1");
  const protectedResult = await deliver(p, {}, { protected: true }); assert.equal(protectedResult.merges.length, 1);
  const duplicate = await deliver(p, {}, { duplicate: true }); assert.equal(duplicate.pushes.length, 0); assert.equal(duplicate.prs.length, 0);
});
test("review gates produce drafts with portable recovery; token fallback explains manual CI", async () => {
  const p = await prepared(true), result = await deliver(p, { APP_TOKEN: "" });
  assert.equal(result.prs[0].draft, true); assert.match(String(result.prs[0].body), /--relocate/); assert.match(String(result.prs[0].body), /Approve and run/); assert.equal(result.merges.length, 0);
  const change = await prepared(false, true), fallback = await deliver(change, { APP_TOKEN: "" });
  assert.equal(fallback.pushes.length, 0); assert.equal(fallback.prs.length, 0); assert.match(String(fallback.issues[0].title), /workflow-capable token/);
});
test("major releases, verifier failures, tampered artifacts and a stale app base produce issues without pushing", async () => {
  const p = await prepared();
  for (const flags of [{ CHECK_RESULT: "failure" }, { VERIFY_RESULT: "failure" }] as Record<string, string>[]) {
    const result = await deliver(p, flags); assert.equal(result.issues.length, 1); assert.equal(result.pushes.length, 0);
  }
  const discoveryFile = path.join(p.artifact, "discovery/discovery.json"), discovery = JSON.parse(fs.readFileSync(discoveryFile, "utf8"));
  discovery.major = { version: "3.0.0" }; fs.writeFileSync(discoveryFile, JSON.stringify(discovery));
  const major = await deliver(p, { TARGET: "", MAJOR: "3.0.0" }); assert.match(String(major.issues[0].title), /major-upgrade review/); assert.equal(major.pushes.length, 0);
  const stale = await deliver(p, {}, { advanced: true }); assert.equal(stale.pushes.length, 0); assert.equal(stale.errors.length, 1);
  fs.appendFileSync(path.join(p.artifact, "delivery/update.patch"), "tamper");
  const tampered = await deliver(p); assert.equal(tampered.pushes.length, 0); assert.match(String(tampered.issues[0].body), /digest mismatch/);
});
test("packaging refuses unexpected files or a failed verifier", async () => {
  const p = await prepared(); write(p.f.app, "unplanned.txt", "unexpected");
  assert.throws(() => packageUpgrade(p.f.app, temp(), p.file), /files changed/);
});
