import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { inspectRepositoryWorkflow, maintenanceAllowed, setupRepositoryWorkflow } from "../repository-workflow.ts";
import { saveRecord } from "../repository-workflow/state.ts";
import { fixture } from "./repository-workflow-fixtures.ts";

function maintenanceFixture(isPrivate = true) {
  const f = fixture(isPrivate);
  f.record.maintenanceBots = [{ login: "app-updater[bot]", appId: 42, kind: "platform-update", policy: "patch" }];
  saveRecord(f.root, f.record); f.committedPolicy = JSON.stringify(f.record);
  f.metadata.allow_auto_merge = true;
  f.variables = [{ name: "PLATFORM_UPDATER_APP_ID", value: "42" }, { name: "PLATFORM_UPDATE_DELIVERY", value: "app" }];
  return f;
}

test("effective inherited E2E and updater variables use complete pagination and repository precedence", async t => {
  const f = maintenanceFixture(); t.after(f.cleanup); f.metadata.owner.type = "Organization";
  f.organizationVariables = [
    ...Array.from({ length: 30 }, (_, i) => ({ name: `ORG_${i}`, value: "unused" })),
    ...f.variables, { name: "PLATFORM_CI_PR_E2E", value: "off" },
  ];
  f.variables = [];
  let status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
  assert.equal(status.e2e.mode, "off"); assert.equal(status.e2e.enforced, false);
  assert.equal(status.maintenanceBots[0].verified, true);
  assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
  f.variables = [
    ...Array.from({ length: 30 }, (_, i) => ({ name: `REPO_${i}`, value: "unused" })),
    { name: "PLATFORM_CI_PR_E2E", value: "always" },
  ];
  status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
  assert.equal(status.e2e.mode, "always"); assert.equal(status.e2e.enforced, true);
  assert.equal(maintenanceAllowed(status, "app-updater[bot]"), true);
  f.variables.push({ name: "PLATFORM_UPDATE_DELIVERY", value: "deferred" });
  status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
  assert.equal(status.maintenanceBots[0].verified, false);
  assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
  f.variables.at(-1)!.value = "app";
  f.variables.push({ name: "PLATFORM_UPDATER_APP_ID", value: "99" });
  assert.equal(maintenanceAllowed(await inspectRepositoryWorkflow(f.root, "owner/app", f.exec), "app-updater[bot]"), false);
  assert(f.calls.some(c => c.args[1] === "repos/owner/app/actions/organization-variables?per_page=30&page=2"));
  assert(f.calls.some(c => c.args[1] === "repos/owner/app/actions/variables?per_page=30&page=2"));
  assert(f.calls.filter(c => c.file === "gh" && c.args[1] !== "graphql").every(c => c.args.includes("GET")));
});

test("unknown, malformed and incomplete effective variables deny readiness and stop setup writes", async t => {
  const failures = [
    (f: ReturnType<typeof fixture>) => { f.organizationVariableError = 403; },
    (f: ReturnType<typeof fixture>) => { f.organizationVariableError = 404; },
    (f: ReturnType<typeof fixture>) => { f.variableResponses["repos/owner/app/actions/organization-variables?per_page=30&page=1"] = {}; },
    (f: ReturnType<typeof fixture>) => { f.variableResponses["repos/owner/app/actions/organization-variables?per_page=30&page=1"] = { total_count: 1, variables: [{ name: "PLATFORM_CI_PR_E2E", value: false }] }; },
    (f: ReturnType<typeof fixture>) => { f.organizationVariables = [{ name: "PLATFORM_CI_PR_E2E", value: "off" }, { name: "platform_ci_pr_e2e", value: "always" }]; },
    (f: ReturnType<typeof fixture>) => { f.organizationVariables = [{ name: "PLATFORM_CI_PR_E2E", value: "unknown" }]; },
    (f: ReturnType<typeof fixture>) => {
      f.organizationVariables = Array.from({ length: 31 }, (_, i) => ({ name: `ORG_${i}`, value: "unused" }));
      f.variableResponses["repos/owner/app/actions/organization-variables?per_page=30&page=2"] = { total_count: 31, variables: [] };
    },
    (f: ReturnType<typeof fixture>) => {
      f.organizationVariables = Array.from({ length: 31 }, (_, i) => ({ name: `ORG_${i}`, value: "unused" }));
      f.variableResponses["repos/owner/app/actions/organization-variables?per_page=30&page=2"] = { total_count: 32, variables: [{ name: "ORG_30", value: "unused" }, { name: "ORG_31", value: "unused" }] };
    },
    (f: ReturnType<typeof fixture>) => { f.organizationVariables = Array.from({ length: 3001 }, (_, i) => ({ name: `ORG_${i}`, value: "unused" })); },
  ];
  for (const fail of failures) {
    const f = maintenanceFixture(); t.after(f.cleanup); f.metadata.owner.type = "Organization"; fail(f);
    const status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
    assert.equal(status.readiness, "incomplete"); assert.equal(status.e2e.enforced, false);
    assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
    await assert.rejects(() => setupRepositoryWorkflow(f.root, "owner/app", { consent: true }, f.exec), /uncertain/);
    assert(f.calls.filter(c => c.file === "gh" && c.args[1] !== "graphql").every(c => c.args.includes("GET")));
  }
});

test("local app removal cannot weaken committed current check requirements", async t => {
  for (const [dir, label] of [["apps/web", "Web"], ["apps/landing", "Landing"], ["platform/apps/admin", "Admin"], ["platform/apps/storybook", "Storybook"]]) {
    for (const isPrivate of [true, false]) {
      const f = maintenanceFixture(isPrivate); t.after(f.cleanup);
      rmSync(path.join(f.root, dir), { recursive: true });
      const context = f.bindings.find(c => c.label === `CI ${label} Complete`)!.context;
      f.protection.required_status_checks!.checks = f.protection.required_status_checks!.checks!.filter(c => c.context !== context);
      const status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
      assert(status.expectedChecks.includes(`CI ${label} Complete`));
      assert.equal(status.expectedChecks.includes("CodeQL"), !isPrivate);
      assert.equal(status.readiness, "incomplete"); assert.equal(status.e2e.enforced, false);
      assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
      f.protection.required_status_checks!.checks!.push({ context, app_id: 15368 });
      assert.equal(maintenanceAllowed(await inspectRepositoryWorkflow(f.root, "owner/app", f.exec), "app-updater[bot]"), true);
    }
  }
});

test("missing, unknown, malformed or truncated committed inventory denies all live consumers", async t => {
  const failures = [
    (f: ReturnType<typeof fixture>) => { f.treeError = 404; },
    (f: ReturnType<typeof fixture>) => { f.treeError = 403; },
    (f: ReturnType<typeof fixture>) => { f.treeResponse = {}; },
    (f: ReturnType<typeof fixture>) => { f.treeResponse = { sha: "d".repeat(40), truncated: true, tree: [] }; },
    (f: ReturnType<typeof fixture>) => { f.treeResponse = { sha: "d".repeat(40), truncated: false }; },
    (f: ReturnType<typeof fixture>) => { f.treeResponse = { sha: "d".repeat(40), truncated: false, tree: [{ path: "apps/web/package.json", type: "unknown", mode: "100644", sha: "e".repeat(40) }] }; },
  ];
  for (const fail of failures) {
    const f = maintenanceFixture(); t.after(f.cleanup); fail(f);
    const status = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
    assert.equal(status.readiness, "incomplete"); assert.deepEqual(status.expectedChecks, []);
    assert.equal(status.e2e.enforced, false); assert.equal(maintenanceAllowed(status, "app-updater[bot]"), false);
    assert.equal(status.checks.find(c => c.step === "committed-inventory")?.status, "unavailable");
    await assert.rejects(() => setupRepositoryWorkflow(f.root, "owner/app", { consent: true }, f.exec), /uncertain/);
    assert(f.calls.filter(c => c.file === "gh" && c.args[1] !== "graphql").every(c => c.args.includes("GET")));
  }
});

test("bootstrap setup installs locally planned bindings beyond the minimal current committed inventory", async t => {
  const f = fixture(); t.after(f.cleanup); f.committedFiles = [];
  const baseline = f.bindings.filter(c => ["CI Shared Complete", "Security Complete"].includes(c.label));
  f.protection.required_status_checks!.checks = baseline.map(c => ({ context: c.context, app_id: c.appId }));
  f.protection.required_pull_request_reviews!.required_approving_review_count = 3;
  const before = await inspectRepositoryWorkflow(f.root, "owner/app", f.exec);
  assert.deepEqual(before.expectedChecks, ["CI Shared Complete", "Security Complete"]);
  assert.equal(before.readiness, "enforced");
  const result = await setupRepositoryWorkflow(f.root, "owner/app", { consent: true, discoverPr: 1 }, f.exec);
  assert.equal(result.readiness, "enforced");
  assert(f.managedRuleset);
  const checks = f.managedRuleset.rules.find(r => r.type === "required_status_checks")!.parameters!.required_status_checks;
  assert.deepEqual(checks, f.bindings.map(c => ({ context: c.context, integration_id: c.appId })));
  assert.equal(f.protection.required_pull_request_reviews!.required_approving_review_count, 3);
  assert.equal(f.managedRuleset.rules.find(r => r.type === "pull_request")!.parameters!.required_approving_review_count, 3);
  const created = f.calls.filter(c => c.args[1] === "repos/owner/app/rulesets" && c.args.includes("POST")).length;
  await setupRepositoryWorkflow(f.root, "owner/app", { consent: true, discoverPr: 1 }, f.exec);
  assert.equal(f.calls.filter(c => c.args[1] === "repos/owner/app/rulesets" && c.args.includes("POST")).length, created);
});
