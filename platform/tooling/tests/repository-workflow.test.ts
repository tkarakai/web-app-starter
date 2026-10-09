import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main, inspectRepositoryWorkflow, maintenanceAllowed, setupRepositoryWorkflow } from "../repository-workflow.ts";
import { RECORD, readRecord, saveRecord } from "../repository-workflow/state.ts";
import { fixture } from "./repository-workflow-fixtures.ts";

test("classic protected repository verifies exact published completion and public CodeQL bindings read-only", async t => {
  for (const isPrivate of [true, false]) {
    const f = fixture(isPrivate); t.after(f.cleanup);
    const bytes = readFileSync(path.join(f.root, RECORD), "utf8");
    const status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
    assert.equal(status.readiness, "enforced");
    assert.equal(status.expectedChecks.includes("CodeQL"), !isPrivate);
    assert.equal(status.effective.strict, true); assert.equal(status.effective.adminsEnforced, true);
    assert.equal(status.featureAutoMergeAllowed, false); assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
    assert.equal(status.deploymentGate.preventsDirectPushes, false);
    assert.equal(readFileSync(path.join(f.root, RECORD), "utf8"), bytes);
    assert(f.calls.every(c => c.args.includes("GET")));
  }
});
test("inactive, wrong-branch and inherited bypass rules cannot masquerade as enforcement", async t => {
  const f = fixture(); t.after(f.cleanup); f.protectionError = 404;
  f.rules = [
    { type: "pull_request", ruleset_id: 7, ruleset_source: "owner", ruleset_source_type: "Organization", parameters: { required_approving_review_count: 2, dismiss_stale_reviews_on_push: true } },
    { type: "required_linear_history", ruleset_id: 7, ruleset_source: "owner", ruleset_source_type: "Organization" },
    { type: "required_status_checks", ruleset_id: 7, ruleset_source: "owner", ruleset_source_type: "Organization", parameters: { strict_required_status_checks_policy: true, required_status_checks: f.bindings.map(c => ({ context: c.context, integration_id: c.appId })) } },
  ];
  f.details = [{ id: 7, enforcement: "active", bypass_actors: [] }];
  assert.equal((await inspectRepositoryWorkflow(f.root, "owner/app", f.exec)).readiness, "enforced");
  f.details[0].bypass_actors = [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }];
  const bypass = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
  assert.equal(bypass.readiness, "incomplete"); assert.equal(bypass.effective.pullRequestRequired, false);
  f.details[0].enforcement = "evaluate";
  assert.equal((await inspectRepositoryWorkflow(f.root, "owner/app", f.exec)).readiness, "incomplete");
  f.rules = []; f.details = [{ id: 7, enforcement: "active", bypass_actors: [] }];
  assert.equal((await inspectRepositoryWorkflow(f.root, "owner/app", f.exec)).readiness, "incomplete");
});
test("all missing/contradictory live enforcement fields and unbound/wrong publisher checks fail closed", async t => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { f.metadata.allow_rebase_merge = true; },
    (f: ReturnType<typeof fixture>) => { f.metadata.delete_branch_on_merge = false; },
    (f: ReturnType<typeof fixture>) => { f.protection.enforce_admins!.enabled = false; },
    (f: ReturnType<typeof fixture>) => { f.protection.required_linear_history!.enabled = false; },
    (f: ReturnType<typeof fixture>) => { f.protection.required_status_checks!.strict = false; },
    (f: ReturnType<typeof fixture>) => { f.protection.required_status_checks!.checks![0].app_id = null; },
    (f: ReturnType<typeof fixture>) => { f.protection.required_status_checks!.checks![0].app_id = 999; },
    (f: ReturnType<typeof fixture>) => { f.protection.required_pull_request_reviews!.dismiss_stale_reviews = false; },
    (f: ReturnType<typeof fixture>) => { f.protection.required_pull_request_reviews!.bypass_pull_request_allowances = { apps: [{ id: 999 }] }; },
    (f: ReturnType<typeof fixture>) => { f.protection.required_pull_request_reviews = undefined; },
    (f: ReturnType<typeof fixture>) => { f.protection.required_status_checks!.checks = []; },
    (f: ReturnType<typeof fixture>) => { f.metadata.allow_auto_merge = true; },
  ];
  for (const change of changes) {
    const f = fixture(); t.after(f.cleanup); change(f);
    const status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
    assert.equal(status.readiness, "incomplete", String(change)); assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
  }
  for (const missing of ["CI Shared Complete", "CI Storybook Complete", "CI Web Complete", "CI Admin Complete", "CI Landing Complete", "Security Complete"]) {
    const f = fixture(); t.after(f.cleanup); f.protection.required_status_checks!.checks = f.protection.required_status_checks!.checks!.filter(c => c.context !== f.bindings.find(b => b.label === missing)!.context);
    assert.equal((await inspectRepositoryWorkflow(f.root, "owner/app", f.exec)).readiness, "incomplete", missing);
  }
});
test("private-Free is policy-only only after owner plan plus both unsupported API denials are verified", async t => {
  const f = fixture(); t.after(f.cleanup); f.protectionError = 403; f.rulesError = 403;
  let status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
  assert.equal(status.readiness, "policy-only"); assert.equal(status.protectionAvailability, "unsupported-private-free");
  assert(status.checks.find(c => c.step === "required-checks")?.enforceable === false);
  assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
  f.plan = "pro"; status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
  assert.equal(status.readiness, "incomplete"); assert.equal(status.protectionAvailability, "unknown");
  f.plan = "free"; f.rulesError = undefined;
  assert.equal((await inspectRepositoryWorkflow(f.root, "owner/app", f.exec)).readiness, "incomplete");
  f.rulesError = 403; f.variableError = true;
  const unavailable = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
  assert.equal(unavailable.readiness, "incomplete"); assert(!JSON.stringify(unavailable).includes("private credentials"));
});
test("owner-consented setup discovers first PR, preserves strong custom rules and resumes idempotently", async t => {
  const f = fixture(); t.after(f.cleanup); f.protectionError = 404; f.hasPr = false; delete f.record.discovery; saveRecord(f.root, f.record);
  await assert.rejects(() => setupRepositoryWorkflow(f.root, "owner/app", { consent: false }, f.exec), /owner consent/);
  assert.equal(f.calls.length, 0);
  let status = await setupRepositoryWorkflow(f.root, "owner/app", { consent: true }, f.exec);
  assert.equal(status.readiness, "incomplete"); assert(!f.calls.some(c => c.args[1] === "repos/owner/app/rulesets"));
  f.hasPr = true;
  status = await setupRepositoryWorkflow(f.root, "owner/app", { consent: true, discoverPr: 1 }, f.exec);
  assert.equal(status.readiness, "enforced"); assert.equal(readRecord(f.root, "owner/app")!.discovery!.checks.length, f.bindings.length);
  const created = f.calls.filter(c => c.args[1] === "repos/owner/app/rulesets" && c.args.includes("POST")).length;
  assert.equal(created, 1);
  f.managedRuleset!.rules.push({ type: "required_signatures" });
  const pr = f.managedRuleset!.rules.find(r => r.type === "pull_request")!;
  pr.parameters!.required_approving_review_count = 3; pr.parameters!.require_code_owner_review = true;
  f.rules = f.managedRuleset!.rules.map(r => ({ ...r, ruleset_id: 99, ruleset_source: "owner/app", ruleset_source_type: "Repository" }));
  await setupRepositoryWorkflow(f.root, "owner/app", { consent: true, approvals: 0, dismissStaleReviews: false }, f.exec);
  assert.equal(f.calls.filter(c => c.args[1] === "repos/owner/app/rulesets" && c.args.includes("POST")).length, 1);
  assert.equal(pr.parameters!.required_approving_review_count, 3); assert.equal(pr.parameters!.require_code_owner_review, true);
  assert(f.managedRuleset!.rules.some(r => r.type === "required_signatures"));
  assert(!f.calls.some(c => c.args.some(a => /secret|token/.test(a))));
});
test("maintenance permission needs exact bot, semantically constrained caller, narrow App and active installation", async t => {
  const f = fixture(); t.after(f.cleanup);
  f.record.maintenanceBots = [{ login: "app-updater[bot]", appId: 42, kind: "platform-update", policy: "patch" }]; saveRecord(f.root, f.record);
  f.committedPolicy = JSON.stringify(f.record);
  f.advanceBranchOnPolicyRead = true;
  f.metadata.allow_auto_merge = true;
  f.variables = [{ name: "PLATFORM_UPDATER_APP_ID", value: "42" }, { name: "PLATFORM_UPDATE_DELIVERY", value: "app" }];
  let status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
  assert.equal(status.readiness, "enforced"); assert.equal(maintenanceAllowed(status, "app-updater[bot]"), true); assert.equal(maintenanceAllowed(status, "other[bot]"), false);
  f.branchSha = f.contentSha; f.advanceBranchOnPolicyRead = false;
  for (const change of [() => { f.viewer = "owner"; }, () => { f.appPermissions.administration = "write"; }, () => { f.installationRepos.push("owner/other"); }, () => { f.caller = "jobs: {update: {uses: './.github/workflows/platform-update.yml', with: {policy: major, auto-merge: true}}}"; }]) {
    change(); status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec); assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
  }
  f.viewer = "app-updater[bot]"; f.appPermissions.administration = "read"; f.installationRepos = ["owner/app"]; f.caller = "jobs: {update: {uses: './.github/workflows/platform-update.yml', with: {policy: patch, auto-merge: true}}}";
  f.variables.push({ name: "PLATFORM_CI_PR_E2E", value: "off" });
  status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec); assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
});

test("maintenance CLI denies local-only, unavailable and mismatched default-branch owner grants", async t => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { f.committedPolicy = JSON.stringify({ ...f.record, maintenanceBots: [] }); },
    (f: ReturnType<typeof fixture>) => { f.committedPolicy = undefined; },
    (f: ReturnType<typeof fixture>) => { f.policyError = 403; },
    (f: ReturnType<typeof fixture>) => { f.committedPolicy = "{}"; },
    (f: ReturnType<typeof fixture>) => { f.committedPolicy = JSON.stringify({ ...f.record, repository: "owner/other" }); },
    (f: ReturnType<typeof fixture>) => { f.committedPolicy = JSON.stringify({ ...f.record, maintenanceBots: [{ ...f.record.maintenanceBots[0], login: "other[bot]" }] }); },
    (f: ReturnType<typeof fixture>) => { f.committedPolicy = JSON.stringify({ ...f.record, maintenanceBots: [{ ...f.record.maintenanceBots[0], appId: 99 }] }); },
    (f: ReturnType<typeof fixture>) => { f.committedPolicy = JSON.stringify({ ...f.record, maintenanceBots: [{ ...f.record.maintenanceBots[0], kind: "dependency-update" }] }); },
    (f: ReturnType<typeof fixture>) => { f.committedPolicy = JSON.stringify({ ...f.record, maintenanceBots: [{ ...f.record.maintenanceBots[0], policy: "minor" }] }); },
    (f: ReturnType<typeof fixture>) => { f.branchExists = false; },
    (f: ReturnType<typeof fixture>) => { f.branchSha = "invalid"; },
  ];
  for (const change of changes) {
    const f = fixture(); t.after(f.cleanup);
    f.record.maintenanceBots = [{ login: "app-updater[bot]", appId: 42, kind: "platform-update", policy: "patch" }];
    saveRecord(f.root, f.record); f.committedPolicy = JSON.stringify(f.record);
    f.metadata.allow_auto_merge = true;
    f.variables = [{ name: "PLATFORM_UPDATER_APP_ID", value: "42" }, { name: "PLATFORM_UPDATE_DELIVERY", value: "app" }];
    change(f);
    const output: string[] = [];
    const code = await main(["--json", "--repo", "owner/app", "--maintenance-bot", "app-updater[bot]"],
      { root: f.root, exec: f.exec, write: value => output.push(value) });
    const result = JSON.parse(output.at(-1)!);
    assert.equal(code, 2); assert.equal(result.maintenanceAllowed, false);
    assert.equal(result.maintenanceBots[0].verified, false);
    assert.equal(readRecord(f.root, "owner/app")!.maintenanceBots[0].appId, 42);
    assert(f.calls.filter(c => c.file === "gh").every(c => c.args.includes("GET")));
  }
});

test("API uncertainty and conflicting inherited merge methods stop setup before every remote mutation", async t => {
  for (const failure of ["rules", "variables", "merge-methods"] as const) {
    const f = fixture(); t.after(f.cleanup);
    if (failure === "rules") f.rulesError = 403;
    if (failure === "variables") f.variableError = true;
    if (failure === "merge-methods") {
      f.rules = [{ type: "pull_request", ruleset_id: 7, ruleset_source_type: "Organization", ruleset_source: "owner", parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, allowed_merge_methods: ["rebase"] } }];
      f.details = [{ id: 7, enforcement: "active", bypass_actors: [] }];
    }
    await assert.rejects(() => setupRepositoryWorkflow(f.root, "owner/app", { consent: true }, f.exec), /uncertain|conflicts/);
    assert(f.calls.filter(c => c.file === "gh").every(c => c.args.includes("GET")), failure);
  }
});
