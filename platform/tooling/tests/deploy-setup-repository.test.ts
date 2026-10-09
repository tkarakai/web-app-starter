import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSetup, configureBranch, requiredChecks } from "../deploy-setup/providers.ts";
import type { Run } from "../deploy-setup/io.ts";
import type { App, State } from "../deploy-setup/model.ts";
import { fixture } from "./repository-workflow-fixtures.ts";
const installed: App[] = ["web", "admin", "landing"];
const state: State = { schema: 1, repository: "owner/app", branch: "main", prefix: "app", team: "team_1", convexTeam: "123", projects: {}, backends: {} };

test("deployment check consumes the same verified classic/ruleset readiness and includes Security Complete", async t => {
  const f = fixture(); t.after(f.cleanup);
  const exec: Run = async (file, args, input, env, cwd) => {
    if (file !== "gh" || args[0] !== "api") throw Error("Unconfigured deployment fixture");
    return f.exec(file, args, input, env, cwd);
  };
  assert(requiredChecks(installed).includes("Security Complete"));
  let checks = await checkSetup(state, installed, exec, installed, f.root);
  assert.equal(checks.find(c => c.step === "branch-protection")?.status, "done");
  assert.equal(checks.find(c => c.step === "repository-strict-updates")?.status, "done");
  f.protection.required_status_checks!.strict = false;
  checks = await checkSetup(state, installed, exec, installed, f.root);
  assert.equal(checks.find(c => c.step === "branch-protection")?.status, "missing");
  f.protectionError = 403; f.rulesError = 403;
  checks = await checkSetup(state, installed, exec, installed, f.root);
  assert.equal(checks.find(c => c.step === "branch-protection")?.status, "human-only");
  assert.match(checks.find(c => c.step === "branch-protection")!.instruction!, /does not prevent direct pushes/);
});
test("deployment configure requires owner consent and preserves existing classic approval/app bindings", async t => {
  const f = fixture(); t.after(f.cleanup);
  await assert.rejects(() => configureBranch(state, installed, f.exec, undefined, f.root), /owner consent/);
  assert.equal(f.calls.length, 0);
  const old = JSON.stringify(f.protection);
  f.protection.required_status_checks!.strict = false;
  const expected = JSON.stringify(f.protection);
  const status = await configureBranch(state, installed, f.exec, { consent: true, approvals: 0, dismissStaleReviews: false }, f.root);
  assert.equal(status.readiness, "enforced"); assert.equal(JSON.stringify(f.protection), expected); assert.notEqual(old, expected);
  assert(!f.calls.some(c => c.args[1].includes("protection") && !c.args.includes("GET")));
});
