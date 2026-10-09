import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendSourceDigest, inspectOrganizationSource, prepareOrganizationDeployment, recoverOrganizationDeployment, verifyOrganizationDeployment } from "../../../.github/actions/deploy-convex/organization-target.ts";
import type { ConvexCommand } from "../../../.github/actions/deploy-convex/fixture-target.ts";

const source = { deploymentVersion: "b".repeat(64), registryHash: "c".repeat(64) };

test("a source without the cutover contract is refused before running its tooling", t => {
  const root = mkdtempSync(join(tmpdir(), "organization-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => inspectOrganizationSource(root), /Unsafe organization rollback/);
  mkdirSync(join(root, "packages/backend/convex/platform"), { recursive: true });
  writeFileSync(join(root, "packages/backend/convex/platform/organizationReadiness.ts"), "export const ORGANIZATION_MIGRATION_CONTRACT_VERSION = 0;");
  assert.throws(() => inspectOrganizationSource(root), /Unsupported organization cutover contract/);
});

test("source receipt binds app functions, platform code and dependencies, excluding generated/test artifacts", t => {
  const root = mkdtempSync(join(tmpdir(), "organization-digest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["packages/backend/convex", "platform/packages/auth"]) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ["bun.lock", "app.config.ts", "packages/backend/package.json"]) writeFileSync(join(root, file), "initial");
  const before = backendSourceDigest(root);
  writeFileSync(join(root, "packages/backend/convex/custom.ts"), "export const policy = 1;");
  const app = backendSourceDigest(root); assert.notEqual(app, before);
  writeFileSync(join(root, "packages/backend/convex/custom.test.ts"), "changed fixture");
  assert.equal(backendSourceDigest(root), app);
  writeFileSync(join(root, "platform/packages/auth/policy.ts"), "export const enforced = true;");
  const platform = backendSourceDigest(root); assert.notEqual(platform, app);
  writeFileSync(join(root, "bun.lock"), "changed dependency");
  assert.notEqual(backendSourceDigest(root), platform);
  symlinkSync(join(root, "app.config.ts"), join(root, "packages/backend/convex/escape.ts"));
  assert.throws(() => backendSourceDigest(root), /symbolic links/);
});

test("updating a protected deployment closes its previous writers before changing the source binding", () => {
  const calls: string[][] = [];
  const command: ConvexCommand = args => {
    calls.push(args);
    if (args[0] === "env" && args[1] === "list") return "ORGANIZATION_CUTOVER_ENFORCED\n";
    if (args[1] === "organizationMigration:status") return JSON.stringify({ deployment: "https://retained.convex.cloud", deploymentVersion: "old", registryHash: "old" });
    return "null";
  };
  prepareOrganizationDeployment(command, source);
  assert.equal(calls[2][1], "organizationMigration:maintenance");
  assert.deepEqual(JSON.parse(calls[2][2]), { confirmDeployment: "https://retained.convex.cloud", nextDeploymentVersion: source.deploymentVersion });
  assert.deepEqual(calls.slice(3), [["env", "set", "ORGANIZATION_DEPLOYMENT_VERSION", source.deploymentVersion], ["env", "set", "ORGANIZATION_REGISTRY_HASH", source.registryHash]]);
});

test("unknown deployment state or a failed maintenance barrier never changes the binding", () => {
  for (const failure of ["malformed-environment", "missing-identity", "maintenance-failure"]) {
    const writes: string[][] = [];
    const command: ConvexCommand = args => {
      if (args[0] === "env" && args[1] === "list") return failure === "malformed-environment" ? "Warning: environment unavailable" : "ORGANIZATION_CUTOVER_ENFORCED";
      if (args[1] === "organizationMigration:status") return JSON.stringify(failure === "missing-identity" ? {} : { deployment: "https://retained.convex.cloud" });
      if (args[1] === "organizationMigration:maintenance") throw new Error("barrier unavailable");
      writes.push(args); return "null";
    };
    assert.throws(() => prepareOrganizationDeployment(command, source));
    assert.deepEqual(writes, []);
  }
});

test("only matching deployed inventory and a verified readiness receipt enable protected cutover", () => {
  for (const fault of ["registry", "batch", "receipt", "none"]) {
    const calls: string[][] = []; let ready = false;
    const command: ConvexCommand = args => {
      calls.push(args);
      if (args[1] === "organizationMigration:status") return JSON.stringify({ deployment: "https://retained.convex.cloud", expectedRegistryHash: fault === "registry" ? "wrong" : source.registryHash,
        ready, deploymentVersion: fault === "receipt" ? "old" : source.deploymentVersion, registryHash: source.registryHash });
      if (args[1] === "organizationMigration:step") { if (fault === "batch") throw new Error("unmapped row"); return '{"complete":true}'; }
      if (args[1] === "organizationMigration:finalize") { ready = true; return '{"ready":true}'; }
      return "null";
    };
    if (fault === "none") verifyOrganizationDeployment(command, source);
    else assert.throws(() => verifyOrganizationDeployment(command, source));
    assert.equal(calls.some(args => args[0] === "env" && args[2] === "ORGANIZATION_CUTOVER_ENFORCED"), fault === "none");
    if (fault === "registry") assert.equal(calls.length, 1);
  }
});

test("same-source retries preserve the active receipt and resume through production migration checks", () => {
  const calls: string[][] = [];
  const command: ConvexCommand = args => {
    calls.push(args);
    if (args[0] === "env" && args[1] === "list") return "ORGANIZATION_CUTOVER_ENFORCED";
    if (args[1] === "organizationMigration:status") return JSON.stringify({ deployment: "https://retained.convex.cloud", ...source, expectedRegistryHash: source.registryHash, ready: true });
    if (args[1] === "organizationMigration:step") return '{"complete":true}';
    return "null";
  };
  prepareOrganizationDeployment(command, source);
  verifyOrganizationDeployment(command, source);
  assert.ok(calls.some(args => args[1] === "organizationMigration:begin"));
  assert.ok(!calls.some(args => args[1] === "organizationMigration:maintenance" || args[1] === "organizationMigration:finalize"));
});

test("explicit forward recovery changes only the exact pending target and resumes an interrupted environment update", () => {
  for (const alreadyRecovered of [false, true]) {
    const calls: string[][] = [];
    const pending = "d".repeat(64);
    const command: ConvexCommand = args => {
      calls.push(args);
      if (args[0] === "env" && args[1] === "list") return "ORGANIZATION_CUTOVER_ENFORCED";
      if (args[1] === "organizationMigration:status") return JSON.stringify({ deployment: "https://retained.convex.cloud",
        deploymentVersion: "a".repeat(64), registryHash: "old", receipt: { phase: "maintenance", nextDeploymentVersion: alreadyRecovered ? source.deploymentVersion : pending } });
      return "null";
    };
    recoverOrganizationDeployment(command, source, pending);
    const recovery = calls.filter(args => args[1] === "organizationMigration:recoverForward");
    assert.equal(recovery.length, alreadyRecovered ? 0 : 1);
    if (!alreadyRecovered) assert.deepEqual(JSON.parse(recovery[0][2]), { confirmDeployment: "https://retained.convex.cloud",
      expectedPendingDeploymentVersion: pending, nextDeploymentVersion: source.deploymentVersion });
    const barrier = calls.findIndex(args => args[1] === "organizationMigration:maintenance");
    assert.ok(barrier >= 0);
    assert.ok(calls.findIndex(args => args[0] === "env" && args[1] === "set") > barrier);
    assert.ok(!calls.some(args => args[1] === "organizationMigration:finalize" || args[2] === "ORGANIZATION_CUTOVER_ENFORCED"));
  }
});

test("forward recovery conflict leaves all environment and readiness state untouched", () => {
  const writes: string[][] = [];
  const command: ConvexCommand = args => {
    if (args[1] === "organizationMigration:status") return JSON.stringify({ deployment: "https://retained.convex.cloud", receipt: { phase: "maintenance", nextDeploymentVersion: "changed" } });
    if (args[1] === "organizationMigration:recoverForward") throw new Error("ORGANIZATION_FORWARD_RECOVERY_CONFLICT");
    writes.push(args); return "null";
  };
  assert.throws(() => recoverOrganizationDeployment(command, source, "d".repeat(64)), /CONFLICT/);
  assert.deepEqual(writes, []);
  assert.throws(() => recoverOrganizationDeployment(command, source, source.deploymentVersion), /different/);
});
