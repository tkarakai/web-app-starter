import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backendSourceDigest, inspectOrganizationSource, prepareOrganizationDeployment, recoverOrganizationDeployment, verifyOrganizationDeployment } from "../../../.github/actions/deploy-convex/organization-target.ts";
import type { ConvexCommand } from "../../../.github/actions/deploy-convex/fixture-target.ts";

const source = { deploymentVersion: "b".repeat(64), registryHash: "c".repeat(64) };

function digestFixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "organization-runtime-digest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file: string, contents: string) => {
    const destination = join(root, file); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, contents);
  };
  write("bun.lock", "locked fixture dependencies"); write("app.config.ts", "export default {};");
  write("packages/backend/package.json", '{"type":"module"}');
  return { root, write, digest: () => backendSourceDigest(root) };
}

for (const [declaration, implementation] of [
  ["apps/web/next-env.d.ts", "apps/web/next-env.js"],
  ["apps/landing/next-env.d.ts", "apps/landing/next-env.ts"],
  ["platform/apps/admin/next-env.d.ts", "platform/apps/admin/next-env.js"],
  ["packages/backend/convex/ambient.d.mts", "packages/backend/convex/ambient.mts"],
  ["packages/backend/convex/ambient.d.cts", "packages/backend/convex/ambient.cts"],
  ["packages/business/policy.d.json.ts", "packages/business/policy.json"],
]) test(`declaration lifecycle does not change binding: ${declaration}`, t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", "export const allowed = false;");
  f.write(implementation, implementation.endsWith(".json") ? '{"allowed":false}' : "export const allowed = false;");
  const before = f.digest();
  f.write(declaration, '/// <reference types="next" />\nimport "./.next/dev/types/routes.d.ts";\n');
  assert.equal(f.digest(), before, "creating a nonexecutable generated declaration cannot stale readiness");
  f.write(declaration, '/// <reference types="next/image-types/global" />\nimport "./.next/types/routes.d.ts";\n');
  assert.equal(f.digest(), before, "refreshing declaration contents cannot stale readiness");
  rmSync(join(f.root, declaration));
  assert.equal(f.digest(), before, "removing generated declarations cannot stale readiness");
  f.write(declaration, "export declare const allowed: boolean;");
  f.write(implementation, implementation.endsWith(".json") ? '{"allowed":true}' : "export const allowed = true;");
  assert.notEqual(f.digest(), before, "paired executable source remains bound while its declaration exists");
});

test("an explicit runtime import of a declaration-only module still fails closed", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", 'import "./policy.d.ts";');
  f.write("packages/backend/convex/policy.d.ts", "export declare const allowed: boolean;");
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

for (const [runtime, types] of [["js", "ts"], ["mjs", "mts"], ["cjs", "cts"]]) {
  test(`generated ${runtime} implementation is bound while declaration refresh is stable`, t => {
    const f = digestFixture(t);
    f.write("packages/backend/convex/main.ts", `import { policy } from "./_generated/api.${runtime}"; export const allowed = policy;`);
    const implementation = `packages/backend/convex/_generated/api.${runtime}`;
    const declaration = `packages/backend/convex/_generated/api.d.${types}`;
    f.write(implementation, "export const policy = false;");
    f.write(declaration, 'import type * as removedSample from "../removedSample.js"; export declare const policy: boolean;');
    const before = f.digest();
    f.write(declaration, "export declare const policy: false;");
    assert.equal(f.digest(), before, "legitimate declaration refresh must not change a prepared source binding");
    f.write(implementation, "export const policy = true;");
    assert.notEqual(f.digest(), before, "the paired executable module must never be hidden by its declaration");
    rmSync(join(f.root, implementation));
    assert.throws(f.digest, /Cannot bind imported organization source/);
  });
}

test("unambiguously erased type imports do not traverse generated declarations or missing type modules", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", `
    import type { Doc } from "./_generated/dataModel";
    import type Legacy = require("./missingLegacyTypes");
    export type { Missing } from "./missingTypes";
    type Result = typeof import("./missingImportType");
    export const allowed = false;
  `);
  const before = f.digest();
  f.write("packages/backend/convex/_generated/dataModel.d.ts", 'import schema from "../removedSchema.js"; export type Doc = typeof schema;');
  assert.equal(f.digest(), before);
  f.write("packages/backend/convex/main.ts", 'import "./missingTypes"; export const allowed = false;');
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

test("asset declaration substitution cannot hide executable JSON policy bytes", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", 'import policy from "./_generated/policy.json"; export const allowed = policy.allowed;');
  f.write("packages/backend/convex/_generated/policy.d.json.ts", "declare const policy: { allowed: boolean }; export default policy;");
  f.write("packages/backend/convex/_generated/policy.json", '{"allowed":false}');
  const before = f.digest();
  f.write("packages/backend/convex/_generated/policy.d.json.ts", "declare const policy: { allowed: false }; export default policy;");
  assert.equal(f.digest(), before);
  f.write("packages/backend/convex/_generated/policy.json", '{"allowed":true}');
  assert.notEqual(f.digest(), before);
  rmSync(join(f.root, "packages/backend/convex/_generated/policy.json"));
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

test("named type imports retain their possible runtime side effects", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/tsconfig.json", '{"compilerOptions":{"verbatimModuleSyntax":true}}');
  f.write("packages/backend/convex/main.ts", 'import { type Marker } from "./_generated/policy.js"; export { type Marker } from "./_generated/policy.js";');
  f.write("packages/backend/convex/_generated/policy.d.ts", "export interface Marker {};");
  f.write("packages/backend/convex/_generated/policy.js", "globalThis.policy = false;");
  const before = f.digest();
  f.write("packages/backend/convex/_generated/policy.js", "globalThis.policy = true;");
  assert.notEqual(f.digest(), before);
  rmSync(join(f.root, "packages/backend/convex/_generated/policy.js"));
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

for (const edge of ['import("../../business/.policy/authority.js")', 'require("../../business/.policy/authority.js")']) {
  test(`${edge} remains bound through a generated wrapper`, t => {
    const f = digestFixture(t);
    f.write("packages/backend/convex/main.ts", 'export { load } from "./_generated/runtime.js";');
    f.write("packages/backend/convex/_generated/runtime.js", `export const load = () => ${edge.replace("../../business", "../../../business")};`);
    f.write("packages/business/.policy/authority.d.ts", "export declare const allowed: boolean;");
    f.write("packages/business/.policy/authority.js", "export const allowed = false;");
    const before = f.digest();
    f.write("packages/business/.policy/authority.js", "export const allowed = true;");
    assert.notEqual(f.digest(), before);
    rmSync(join(f.root, "packages/business/.policy/authority.js"));
    assert.throws(f.digest, /Cannot bind imported organization source/);
  });
}

test("workspace paths resolve runtime implementations and reject declaration-only value imports", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{"@buyer/*":["../../business/tests/*"]}}}');
  f.write("packages/backend/convex/main.ts", 'import { allowed } from "@buyer/policy"; export const result = allowed;');
  f.write("packages/business/tests/policy.d.ts", "export declare const allowed: boolean;");
  f.write("packages/business/tests/policy.js", "export const allowed = false;");
  const before = f.digest();
  f.write("packages/business/tests/policy.js", "export const allowed = true;");
  assert.notEqual(f.digest(), before);
  rmSync(join(f.root, "packages/business/tests/policy.js"));
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

for (const [runtime, types] of [["js", "ts"], ["mjs", "mts"], ["cjs", "cts"]]) test(`explicit generated ${runtime} remains bound beside a ${types} implementation`, t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", `export { allowed } from "./_generated/api.${runtime}";`);
  f.write(`packages/backend/convex/_generated/api.${types}`, "export const allowed = false;");
  f.write(`packages/backend/convex/_generated/api.${runtime}`, "export const allowed = false;");
  const before = f.digest();
  f.write(`packages/backend/convex/_generated/api.${runtime}`, "export const allowed = true;");
  const changedJs = f.digest(); assert.notEqual(changedJs, before);
  f.write(`packages/backend/convex/_generated/api.${types}`, "export const allowed = true;");
  assert.notEqual(f.digest(), changedJs, "the conservative binding also retains the TS alternative");
  f.write(`packages/backend/convex/_generated/api.${runtime}`, 'export { allowed } from "./missingRuntime.js";');
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

for (const directory of ["services/functions", ".service/functions", "services/.functions", "services/tests/functions"]) {
  test(`configured ${directory} binds hidden executable imports and refuses missing/external sources`, t => {
    const f = digestFixture(t);
    f.write("packages/backend/convex.json", JSON.stringify({ functions: `../../${directory}` }));
    f.write(`${directory}/entry.ts`, 'export { allowed } from "./_generated/runtime.js";');
    f.write(`${directory}/_generated/runtime.js`, 'export { allowed } from "../.private/policy.js";');
    const policy = `${directory}/.private/policy.js`;
    f.write(policy, "export const allowed = false;");
    const before = f.digest();
    f.write(policy, "export const allowed = true;");
    const changedPolicy = f.digest(); assert.notEqual(changedPolicy, before);
    f.write(`${directory}/entry.ts`, 'export { allowed } from "./_generated/runtime.js"; export const changed = true;');
    assert.notEqual(f.digest(), changedPolicy, "a root omitted by the broad walk must bind its entry point too");
    rmSync(join(f.root, policy));
    assert.throws(f.digest, /Cannot bind imported organization source/);
    const external = mkdtempSync(join(tmpdir(), "organization-external-policy-"));
    t.after(() => rmSync(external, { recursive: true, force: true }));
    writeFileSync(join(external, "policy.js"), "export const allowed = true;");
    f.write(`${directory}/_generated/runtime.js`, `export { allowed } from ${JSON.stringify(join(external, "policy.js"))};`);
    assert.throws(f.digest, /outside the checkout/);
  });
}

test("a configured function root cannot escape through an initially excluded symlink", t => {
  const f = digestFixture(t);
  const external = mkdtempSync(join(tmpdir(), "organization-external-functions-"));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  writeFileSync(join(external, "entry.ts"), "export const allowed = true;");
  symlinkSync(external, join(f.root, ".functions"));
  f.write("packages/backend/convex.json", '{"functions":"../../.functions"}');
  assert.throws(f.digest, /symbolic links/);
});

for (const edge of ["paths", "workspace-exports"]) test(`${edge} cannot hide JS behind a TS sibling`, t => {
  const f = digestFixture(t);
  const policy = "packages/business/dist/policy";
  if (edge === "paths") {
    f.write("packages/backend/convex/tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{"@buyer/*":["../../business/dist/*"]}}}');
    f.write("packages/backend/convex/main.ts", 'export { allowed } from "@buyer/policy.js";');
  } else {
    f.write("packages/business/package.json", '{"name":"@buyer/policy","type":"module","exports":{"import":"./dist/policy.js"}}');
    mkdirSync(join(f.root, "packages/backend/node_modules/@buyer"), { recursive: true });
    symlinkSync(join(f.root, "packages/business"), join(f.root, "packages/backend/node_modules/@buyer/policy"));
    f.write("packages/backend/convex/main.ts", 'export { allowed } from "@buyer/policy";');
  }
  f.write(`${policy}.ts`, "export const allowed = false;");
  f.write(`${policy}.js`, "export const allowed = false;");
  const before = f.digest();
  f.write(`${policy}.js`, "export const allowed = true;");
  assert.notEqual(f.digest(), before);
  f.write(`${policy}.js`, 'export { allowed } from "./missing.js";');
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

for (const [pattern, specifier] of [["@buyer/*", "@buyer/missing"], ["@buyer/fixed", "@buyer/fixed"], ["@buyer/*/policy", "@buyer/missing/policy"]]) {
  test(`missing local alias ${specifier} is not treated as a published dependency`, t => {
    const f = digestFixture(t);
    f.write("packages/backend/convex/tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { [pattern]: ["../../business/missing/*"] } } }));
    f.write("packages/backend/convex/main.ts", `export { allowed } from ${JSON.stringify(specifier)};`);
    assert.throws(f.digest, /Cannot bind imported organization source/);
  });
}

for (const scope of ["inside", "outside"]) test(`absolute ${scope}-checkout runtime imports cannot disappear from source binding`, t => {
  const f = digestFixture(t);
  const directory = scope === "inside" ? join(f.root, ".policy") : mkdtempSync(join(tmpdir(), "organization-absolute-policy-"));
  if (scope === "outside") t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(directory, { recursive: true });
  const policy = join(directory, "policy.js");
  f.write("packages/backend/convex/main.ts", `export { allowed } from ${JSON.stringify(policy)};`);
  assert.throws(f.digest, /Cannot bind imported organization source/, "a missing absolute local import is never a published dependency");
  writeFileSync(policy, "export const allowed = false;");
  if (scope === "outside") {
    assert.throws(f.digest, /outside the checkout/);
  } else {
    const before = f.digest();
    writeFileSync(policy, "export const allowed = true;");
    assert.notEqual(f.digest(), before, "an existing absolute local implementation remains bound");
  }
});

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

test("bounded migration pages preserve every checkpoint and smaller-page resume after a budget failure", () => {
  const rows = Array.from({ length: 25 }, (_, index) => `owner-${index}`);
  const verified: string[] = [];
  let cursor = 0; let ready = false; let failPage = false;
  const calls: string[][] = [];
  const command: ConvexCommand = args => {
    calls.push(args);
    if (args[1] === "organizationMigration:status") return JSON.stringify({ deployment: "https://retained.convex.cloud",
      ...source, expectedRegistryHash: source.registryHash, ready });
    if (args[1] === "organizationMigration:step") {
      const { batchSize } = JSON.parse(args[2]);
      if (batchSize > 10 || failPage) throw new Error("transaction operation budget exceeded");
      const page = rows.slice(cursor, cursor + batchSize);
      verified.push(...page); cursor += page.length;
      // Simulate a failed next transaction, with all prior committed work retained.
      if (cursor === 10) failPage = true;
      return JSON.stringify({ complete: cursor === rows.length });
    }
    if (args[1] === "organizationMigration:finalize") {
      assert.deepEqual(verified, rows); ready = true; return '{"ready":true}';
    }
    return "null";
  };
  assert.throws(() => verifyOrganizationDeployment(command, source, {}), /operation budget/);
  assert.equal(cursor, 10);
  assert.deepEqual(verified, rows.slice(0, 10));
  assert.equal(ready, false);
  assert.ok(!calls.some(args => args[1] === "organizationMigration:finalize" || args[0] === "env"));
  failPage = false;
  const resumeIndex = calls.length;
  verifyOrganizationDeployment(command, source, { ORGANIZATION_MIGRATION_BATCH_SIZE: "3" });
  assert.deepEqual(verified, rows);
  assert.equal(ready, true);
  assert.ok(calls.slice(resumeIndex).filter(args => args[1] === "organizationMigration:step")
    .every(args => JSON.parse(args[2]).batchSize === 3));
  assert.equal(calls.filter(args => args[1] === "organizationMigration:finalize").length, 1);
  assert.deepEqual(calls.at(-1), ["env", "set", "ORGANIZATION_CUTOVER_ENFORCED", "1"]);
});

test("migration batch configuration rejects invalid values before any verification command", () => {
  for (const value of ["", "0", "-1", "101", "1.5", "NaN", "Infinity", "1e1", "01", " 10", "10 "]) {
    let calls = 0;
    assert.throws(() => verifyOrganizationDeployment(() => { calls++; return "null"; }, source,
      { ORGANIZATION_MIGRATION_BATCH_SIZE: value }), /must be an integer from 1 to 100/);
    assert.equal(calls, 0, value);
  }
  for (const value of ["1", "100"]) {
    const sizes: number[] = [];
    const command: ConvexCommand = args => {
      if (args[1] === "organizationMigration:status") return JSON.stringify({ deployment: "https://retained.convex.cloud",
        ...source, expectedRegistryHash: source.registryHash, ready: true });
      if (args[1] === "organizationMigration:step") { sizes.push(JSON.parse(args[2]).batchSize); return '{"complete":true}'; }
      return "null";
    };
    verifyOrganizationDeployment(command, source, { ORGANIZATION_MIGRATION_BATCH_SIZE: value });
    assert.deepEqual(sizes, [Number(value)]);
  }
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
