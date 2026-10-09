import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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

for (const directory of ["apps/landing/out", "apps/custom/out", "packages/ui/out"]) {
  test(`unimported build output lifecycle does not change binding: ${directory}`, t => {
    const f = digestFixture(t);
    f.write("packages/backend/convex/main.ts", "export const allowed = false;");
    f.write("packages/business/policy.ts", "export const allowed = false;");
    const before = f.digest();
    f.write(`${directory}/_next/static/build-one/_buildManifest.js`, "self.__BUILD_MANIFEST = {};");
    f.write(`${directory}/_next/static/chunks/runtime.js`, "self.runtime = 1;");
    assert.equal(f.digest(), before, "creating frontend export artifacts cannot stale backend readiness");
    f.write(`${directory}/_next/static/chunks/runtime.js`, "self.runtime = 2;");
    f.write(`${directory}/_next/static/build-two/_buildManifest.js`, "self.__BUILD_MANIFEST = { rebuilt: true };");
    assert.equal(f.digest(), before, "rebuilding with different bytes and build IDs cannot stale readiness");
    f.write("packages/business/policy.ts", "export const allowed = true;");
    const changedSource = f.digest();
    assert.notEqual(changedSource, before, "ordinary unimported workspace source remains bound");
    rmSync(join(f.root, directory), { recursive: true });
    assert.equal(f.digest(), changedSource, "cleaning output cannot change the source binding");
  });
}

for (const edge of [
  'export { allowed } from "../../business/out/policy.js";',
  'export const load = () => import("../../business/out/policy.js");',
  'export const load = () => require("../../business/out/policy.js");',
]) test(`output runtime dependencies stay bound: ${edge}`, t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", edge);
  f.write("packages/business/out/policy.js", 'export { allowed } from "./nested/authority.js";');
  const authority = "packages/business/out/nested/authority.js";
  f.write(authority, "export const allowed = false;");
  const before = f.digest();
  f.write("packages/business/out/policy.js", 'export { allowed } from "./nested/authority.js"; export const direct = true;');
  const changedDirect = f.digest();
  assert.notEqual(changedDirect, before, "directly imported output bytes stay bound");
  f.write(authority, "export const allowed = true;");
  assert.notEqual(f.digest(), changedDirect, "transitive imports within output directories stay bound");
  rmSync(join(f.root, authority));
  assert.throws(f.digest, /Cannot bind imported organization source/);
  f.write(authority, "export const allowed = false;");
  rmSync(join(f.root, "packages/business/out/policy.js"));
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

test("output imports retain symlink and checkout containment refusal", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", 'export { allowed } from "../../business/out/policy.js";');
  const external = mkdtempSync(join(tmpdir(), "organization-output-external-"));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  writeFileSync(join(external, "policy.js"), "export const allowed = true;");
  f.write("packages/business/out/policy.js", `export { allowed } from ${JSON.stringify(join(external, "policy.js"))};`);
  assert.throws(f.digest, /outside the checkout/);
  rmSync(join(f.root, "packages/business/out/policy.js"));
  symlinkSync(join(external, "policy.js"), join(f.root, "packages/business/out/policy.js"));
  assert.throws(f.digest, /outside the checkout|symbolic links/);
});

test("a workspace output symlink is still refused", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", "export const allowed = false;");
  f.write("apps/landing/source/policy.js", "export const allowed = true;");
  symlinkSync(join(f.root, "apps/landing/source"), join(f.root, "apps/landing/out"));
  assert.throws(f.digest, /symbolic links/);
});

for (const condition of ["node", "browser", "convex", "module", "require", "nested-node-subpath", "node-spec", "node-test", "wildcard-spec", "wildcard-test", "root-wildcard-spec"]) {
  test(`actual Convex bundler conditions keep workspace output bound: ${condition}`, async t => {
    const f = digestFixture(t);
    const requireBranch = condition === "require";
    const entry = `packages/backend/convex/main.${requireBranch ? "cjs" : "mjs"}`;
    const suffix = condition.endsWith("-spec") ? ".spec" : condition.endsWith("-test") ? ".test" : "";
    const wildcard = condition === "nested-node-subpath" || condition.includes("wildcard-");
    const output = condition.startsWith("root-") ? "" : "out/";
    const active = `packages/policy/${output}active${suffix}.${requireBranch ? "cjs" : "mjs"}`;
    const exports = wildcard
      ? { "./*": { node: { import: `./${output}*.mjs` }, default: "./out/fallback.mjs" } }
      : requireBranch ? { import: "./out/fallback.mjs", require: "./out/active.cjs" }
        : { [suffix ? "node" : condition]: `./out/active${suffix}.mjs`, default: "./out/fallback.mjs" };
    f.write("packages/policy/package.json", JSON.stringify({ name: "@private/policy", type: "module", exports }));
    f.write("packages/policy/out/fallback.mjs", "export const value = false;");
    f.write(active, requireBranch ? "exports.value = false;" : "export const value = false;");
    f.write(entry, requireBranch ? 'exports.allowed = () => require("@private/policy").value;'
      : `import { value } from "@private/policy${wildcard ? `/active${suffix}` : ""}"; export const allowed = () => value;`);
    mkdirSync(join(f.root, "packages/backend/node_modules/@private"), { recursive: true });
    symlinkSync(join(f.root, "packages/policy"), join(f.root, "packages/backend/node_modules/@private/policy"));
    // Use the exact installed bundler consumed by Convex, without deployment or
    // output files, and execute both resulting tiny bundles as the behavior oracle.
    const { buildSync } = createRequire(realpathSync(fileURLToPath(new URL("../../../packages/backend/node_modules/convex/package.json", import.meta.url))))("esbuild");
    const observe = async () => {
      const bundle = buildSync({ absWorkingDir: f.root, entryPoints: [entry], bundle: true, write: false,
        metafile: true, format: "esm", platform: condition === "browser" ? "browser" : "node", conditions: ["convex", "module"], logLevel: "silent" });
      assert.ok(Object.keys(bundle.metafile.inputs).includes(active));
      const loaded = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
      return (loaded.allowed ?? loaded.default.allowed)();
    };
    assert.equal(await observe(), false);
    const before = f.digest();
    f.write(active, requireBranch ? "exports.value = true;" : "export const value = true;");
    assert.equal(await observe(), true);
    assert.notEqual(f.digest(), before, "a condition-selected authority change must invalidate the receipt");
    if (suffix) {
      f.write("packages/policy/unrelated.test.ts", "throw new Error('not a runtime import');");
      const withoutUnrelatedTests = f.digest();
      f.write("packages/policy/unrelated.test.ts", "throw new Error('still not a runtime import');");
      assert.equal(f.digest(), withoutUnrelatedTests, "unrelated test harnesses stay outside the runtime graph");
      f.write(active, 'export { value } from "./policy.test.mjs";');
      f.write(`packages/policy/${output}policy.test.mjs`, "export const value = false;");
      const beforeTransitive = f.digest();
      assert.equal(await observe(), false);
      f.write(`packages/policy/${output}policy.test.mjs`, "export const value = true;");
      assert.equal(await observe(), true);
      assert.notEqual(f.digest(), beforeTransitive, "test-named transitive runtime imports stay bound");
    }
    f.write(active, requireBranch ? 'exports.value = require("./missing.cjs").value;' : 'export { value } from "./missing.mjs";');
    assert.throws(f.digest, /Cannot bind imported organization source/);
  });
}

for (const kind of ["package-imports", "self-reference", "module-field", "browser-field", "imports-bare", "browser-bare", "module-spec-field", "main-spec-field", "browser-spec-field", "module-extensionless-field"]) {
  test(`runtime package alternatives remain bound: ${kind}`, async t => {
    const f = digestFixture(t);
    const entry = "packages/backend/convex/main.mjs";
    let active = "packages/policy/out/active.mjs";
    if (kind === "imports-bare" || kind === "browser-bare") {
      active = "packages/alternate/out/active.mjs";
      f.write("packages/policy/package.json", JSON.stringify({ name: "@private/policy", type: "module", exports: "./main.mjs",
        ...(kind === "imports-bare" ? { imports: { "#policy": { node: "@private/alternate", default: "./fallback.mjs" } } }
          : { browser: { "./fallback.mjs": "@private/alternate" } }) }));
      f.write("packages/policy/main.mjs", kind === "imports-bare" ? 'export { value } from "#policy";' : 'export { value } from "./fallback.mjs";');
      f.write("packages/policy/fallback.mjs", "export const value = false;");
      f.write("packages/alternate/package.json", '{"name":"@private/alternate","type":"module","exports":"./out/active.mjs"}');
      f.write(entry, 'import { value } from "@private/policy"; export const allowed = () => value;');
      for (const [from, name, to] of [["backend", "policy", "policy"], ["policy", "alternate", "alternate"]]) {
        mkdirSync(join(f.root, `packages/${from}/node_modules/@private`), { recursive: true });
        symlinkSync(join(f.root, `packages/${to}`), join(f.root, `packages/${from}/node_modules/@private/${name}`));
      }
    } else if (kind === "package-imports") {
      active = "packages/backend/out/active.mjs";
      f.write("packages/backend/package.json", JSON.stringify({ type: "module", imports: { "#policy": { node: "./out/active.mjs", default: "./out/fallback.mjs" } } }));
      f.write("packages/backend/out/fallback.mjs", "export const value = false;");
      f.write(entry, 'import { value } from "#policy"; export const allowed = () => value;');
    } else {
      const manifest: Record<string, unknown> = { name: "@private/policy", type: "module" };
      if (kind === "self-reference") {
        manifest.exports = { "./selected": { node: "./out/active.mjs", default: "./out/fallback.mjs" } };
        f.write("packages/policy/bridge.mjs", 'export { value } from "@private/policy/selected";');
        f.write(entry, 'import { value } from "../../policy/bridge.mjs"; export const allowed = () => value;');
      } else {
        manifest.main = "./out/fallback.mjs";
        if (kind.includes("-spec-") || kind === "module-extensionless-field") {
          const extensionless = kind === "module-extensionless-field";
          active = `packages/policy/out/active.spec.${extensionless ? "js" : "mjs"}`;
          manifest[kind.split("-")[0]] = `out/active.spec${extensionless ? "" : ".mjs"}`;
        } else if (kind === "module-field") manifest.module = "./out/active.mjs";
        else manifest.browser = { "./out/fallback.mjs": "./out/active.mjs" };
        f.write(entry, 'import { value } from "@private/policy"; export const allowed = () => value;');
        mkdirSync(join(f.root, "packages/backend/node_modules/@private"), { recursive: true });
        symlinkSync(join(f.root, "packages/policy"), join(f.root, "packages/backend/node_modules/@private/policy"));
      }
      f.write("packages/policy/package.json", JSON.stringify(manifest));
      f.write("packages/policy/out/fallback.mjs", "export const value = false;");
    }
    f.write(active, "export const value = false;");
    const { buildSync } = createRequire(realpathSync(fileURLToPath(new URL("../../../packages/backend/node_modules/convex/package.json", import.meta.url))))("esbuild");
    const observe = async () => {
      const bundle = buildSync({ absWorkingDir: f.root, entryPoints: [entry], bundle: true, write: false,
        metafile: true, format: "esm", platform: kind.endsWith("field") || kind === "browser-bare" ? "browser" : "node", conditions: ["convex", "module"], logLevel: "silent" });
      assert.ok(Object.keys(bundle.metafile.inputs).includes(active));
      const loaded = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
      return loaded.allowed();
    };
    const before = f.digest(); assert.equal(await observe(), false);
    f.write(active, "export const value = true;");
    assert.equal(await observe(), true); assert.notEqual(f.digest(), before);
    f.write(active, 'export { value } from "./missing.mjs";');
    assert.throws(f.digest, /Cannot bind imported organization source/);
  });
}

for (const condition of ["node", "require"]) test(`workspace package without a default import branch remains supported: ${condition}`, t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", 'export { allowed } from "@private/policy";');
  f.write("packages/policy/package.json", JSON.stringify({ name: "@private/policy", exports: { [condition]: "./_generated/policy.js" } }));
  f.write("packages/policy/_generated/policy.js", "export const allowed = false;");
  f.write("packages/policy/_generated/policy.d.ts", "export declare const allowed: boolean;");
  mkdirSync(join(f.root, "packages/backend/node_modules/@private"), { recursive: true });
  symlinkSync(join(f.root, "packages/policy"), join(f.root, "packages/backend/node_modules/@private/policy"));
  const before = f.digest();
  f.write("packages/policy/_generated/policy.d.ts", "export declare const allowed: false;");
  assert.equal(f.digest(), before);
  f.write("packages/policy/_generated/policy.js", "export const allowed = true;");
  assert.notEqual(f.digest(), before);
  rmSync(join(f.root, "packages/policy/_generated/policy.js"));
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

test("runtime package binding excludes ambient local state but retains explicit imports", t => {
  const f = digestFixture(t);
  f.write("package.json", '{"name":"monorepo","private":true}');
  f.write("packages/backend/convex/main.ts", "export const allowed = false;");
  const before = f.digest();
  for (const directory of [".convex/local/default", ".next", ".turbo", ".cache", "coverage", "artifacts", "playwright-report", "test-results"]) {
    const file = `packages/backend/${directory}/config.json`;
    f.write(file, '{"syntheticState":1}'); assert.equal(f.digest(), before);
    f.write(file, '{"syntheticState":2}'); assert.equal(f.digest(), before);
    rmSync(join(f.root, file)); assert.equal(f.digest(), before);
  }
  f.write("apps/landing/out/chunk.js", "self.runtime = 1;");
  assert.equal(f.digest(), before, "a monorepo manifest must not retain unrelated frontend output");
  f.write("packages/backend/convex/main.ts", 'export { allowed } from "../.convex/policy.js";');
  f.write("packages/backend/.convex/policy.js", "export const allowed = false;");
  const imported = f.digest();
  f.write("packages/backend/.convex/policy.js", "export const allowed = true;");
  assert.notEqual(f.digest(), imported);
  rmSync(join(f.root, "packages/backend/.convex/policy.js"));
  assert.throws(f.digest, /Cannot bind imported organization source/);
});

test("an excluded-state conditional package target fails closed", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", 'export { allowed } from "@private/policy";');
  f.write("packages/policy/package.json", JSON.stringify({ name: "@private/policy", exports: { node: "./.convex/policy.js", default: "./out/policy.js" } }));
  f.write("packages/policy/.convex/policy.js", "export const allowed = true;");
  f.write("packages/policy/out/policy.js", "export const allowed = false;");
  mkdirSync(join(f.root, "packages/backend/node_modules/@private"), { recursive: true });
  symlinkSync(join(f.root, "packages/policy"), join(f.root, "packages/backend/node_modules/@private/policy"));
  assert.throws(f.digest, /metadata references local state/);
});

test("an explicit runtime package resolving to the monorepo root fails closed", t => {
  const f = digestFixture(t);
  f.write("package.json", '{"name":"monorepo","exports":"./root.js"}');
  f.write("root.js", "export const allowed = true;");
  f.write("packages/backend/convex/main.ts", 'export { allowed } from "monorepo";');
  mkdirSync(join(f.root, "packages/backend/node_modules"), { recursive: true });
  symlinkSync(f.root, join(f.root, "packages/backend/node_modules/monorepo"));
  assert.throws(f.digest, /dedicated package directory/);
});

test("runtime metadata refuses relative package escapes and wildcard package names", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", 'export { allowed } from "#policy";');
  for (const [target, error] of [["../alternate/out/policy.js", /escapes its package/], ["@private/*", /explicit dependency package name/]] as const) {
    f.write("packages/backend/package.json", JSON.stringify({ imports: { "#policy": { node: target, default: "./policy.js" } } }));
    f.write("packages/backend/policy.js", "export const allowed = false;");
    assert.throws(f.digest, error);
  }
});

test("root package wildcard data remains bound and refuses ambiguous ambient state", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", 'export { allowed } from "@private/policy";');
  f.write("packages/policy/package.json", JSON.stringify({ name: "@private/policy", exports: { ".": "./index.js", "./*.json": "./*.json" } }));
  f.write("packages/policy/index.js", "export const allowed = false;");
  f.write("packages/policy/en.json", '{"allowed":false}');
  mkdirSync(join(f.root, "packages/backend/node_modules/@private"), { recursive: true });
  symlinkSync(join(f.root, "packages/policy"), join(f.root, "packages/backend/node_modules/@private/policy"));
  const before = f.digest();
  f.write("packages/policy/en.json", '{"allowed":true}');
  assert.notEqual(f.digest(), before);
  f.write("packages/policy/.convex/config.json", '{"privateState":true}');
  assert.throws(f.digest, /root pattern overlaps local state/);
});

test("explicit wildcard source directories retain nested state-like implementation names", t => {
  const f = digestFixture(t);
  f.write("packages/backend/convex/main.ts", 'export { allowed } from "#policy/.convex/policy";');
  f.write("packages/backend/package.json", JSON.stringify({ imports: { "#policy/*": { node: "./out/*.js", default: "./fallback.js" } } }));
  f.write("packages/backend/fallback.js", "export const allowed = false;");
  f.write("packages/backend/out/.convex/policy.js", "export const allowed = false;");
  const before = f.digest();
  f.write("packages/backend/out/.convex/policy.js", "export const allowed = true;");
  assert.notEqual(f.digest(), before);
});

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

for (const directory of ["services/functions", ".service/functions", "services/.functions", "services/tests/functions", "services/out/functions", "services/out", "services/.convex/functions"]) {
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

for (const directory of ["dist", "out"]) for (const edge of ["paths", "workspace-exports"]) test(`${edge} in ${directory} cannot hide JS behind a TS sibling`, t => {
  const f = digestFixture(t);
  const policy = `packages/business/${directory}/policy`;
  if (edge === "paths") {
    f.write("packages/backend/convex/tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@buyer/*": [`../../business/${directory}/*`] } } }));
    f.write("packages/backend/convex/main.ts", 'export { allowed } from "@buyer/policy.js";');
  } else {
    f.write("packages/business/package.json", JSON.stringify({ name: "@buyer/policy", type: "module", exports: { import: `./${directory}/policy.js` } }));
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
  for (const file of ["bun.lock", "app.config.ts"]) writeFileSync(join(root, file), "initial");
  writeFileSync(join(root, "packages/backend/package.json"), '{"type":"module"}');
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
