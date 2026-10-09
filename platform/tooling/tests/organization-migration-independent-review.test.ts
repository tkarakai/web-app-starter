import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOrganizationMigration } from "../organization-migration-check.ts";
import { backendSourceDigest } from "../../../.github/actions/deploy-convex/organization-target.ts";

// Expected-safety regressions: these must remain red until the production boundary is fixed.
function sourceFixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "organization-independent-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(file: string, contents: string) {
    const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents);
  }
  write("packages/backend/package.json", '{"type":"module"}');
  symlinkSync(fileURLToPath(new URL("../../../packages/backend/node_modules", import.meta.url)), join(root, "packages/backend/node_modules"));
  write("packages/backend/convex/organizationMigrationRegistry.ts", `export const organizationMigrationRegistry = {
    version: 1, tables: {}, functions: { "known:write": "tenant" }, jobs: {}, components: {}
  };`);
  write("packages/backend/convex/known.ts", 'export const write = mutation({handler(ctx) { return null; }});');
  return { root, write };
}

test("inventory control rejects a direct unregistered TypeScript writer", async t => {
  const f = sourceFixture(t);
  await checkOrganizationMigration(f.root);
  f.write("packages/backend/convex/extra.ts", 'export const write = mutation({handler(ctx) { return ctx.db.insert("projects", {}); }});');
  await assert.rejects(checkOrganizationMigration(f.root), /extra:write/);
});

for (const extension of ["js", "mjs", "cjs", "tsx", "mts", "cts", "jsx"]) {
  test(`inventory rejects unregistered deployable ${extension} writer`, async t => {
    const f = sourceFixture(t);
    f.write(`packages/backend/convex/extra.${extension}`, 'export const write = mutation({handler(ctx) { return ctx.db.insert("projects", {}); }});');
    await assert.rejects(checkOrganizationMigration(f.root), /extra|UNCLASSIFIED|INCOMPLETE|REVIEW_REQUIRED/);
  });
}

for (const [name, content] of [
  ["alias", 'const writer = mutation({handler(ctx) { return ctx.db.insert("projects", {}); }}); export const write = writer;'],
  ["default", 'const writer = mutation({handler(ctx) { return ctx.db.insert("projects", {}); }}); export default writer;'],
  ["star", 'export * from "./platform/customWriter";'],
  ["http", 'import {httpRouter} from "convex/server"; const http = httpRouter(); http.route({path:"/unsafe", method:"POST", handler:httpAction(async (ctx) => new Response(await ctx.runMutation(internal.platform.customWriter.write, {})))}); export default http;'],
  ["cron", 'import {cronJobs} from "convex/server"; const crons = cronJobs(); crons.interval("unsafe", {minutes:1}, internal.platform.customWriter.write, {}); export default crons;'],
] as const) {
  test(`inventory rejects unclassified ${name} export or execution surface`, async t => {
    const f = sourceFixture(t);
    f.write("packages/backend/convex/platform/customWriter.ts", 'export const write = internalMutation({handler(ctx) { return ctx.db.insert("projects", {}); }});');
    f.write(`packages/backend/convex/${name === "star" ? "extra" : name}.ts`, content);
    await assert.rejects(checkOrganizationMigration(f.root), /UNCLASSIFIED|INCOMPLETE|REVIEW_REQUIRED/);
  });
}

test("inventory rejects an unregistered app-installed component", async t => {
  const f = sourceFixture(t);
  f.write("packages/backend/convex/convex.config.ts", 'import {defineApp} from "convex/server"; import writer from "buyer-component/convex.config"; const app = defineApp(); app.use(writer); export default app;');
  await assert.rejects(checkOrganizationMigration(f.root), /COMPONENT|INCOMPLETE|REVIEW_REQUIRED/);
});

test("source binding changes when an imported authorization module outside conventional source roots changes", t => {
  const f = sourceFixture(t);
  mkdirSync(join(f.root, "platform/packages"), { recursive: true });
  f.write("bun.lock", "fixture"); f.write("app.config.ts", "export default {};");
  f.write("packages/backend/convex/known.ts", 'import {allow} from "../../business/policy"; export const write = mutation({handler(ctx) { if (!allow) throw new Error("Denied"); }});');
  f.write("packages/business/policy.ts", "export const allow = false;");
  const before = backendSourceDigest(f.root);
  f.write("packages/business/policy.ts", "export const allow = true;");
  assert.notEqual(backendSourceDigest(f.root), before);
});

test("source binding includes Convex-supported TSX source", t => {
  const f = sourceFixture(t);
  mkdirSync(join(f.root, "platform/packages"), { recursive: true });
  f.write("bun.lock", "fixture"); f.write("app.config.ts", "export default {};");
  f.write("packages/backend/convex/policy.tsx", "export const allow = false;");
  const before = backendSourceDigest(f.root);
  f.write("packages/backend/convex/policy.tsx", "export const allow = true;");
  assert.notEqual(backendSourceDigest(f.root), before);
});

test("source binding includes deployment function-root configuration", t => {
  const f = sourceFixture(t);
  mkdirSync(join(f.root, "platform/packages"), { recursive: true });
  f.write("bun.lock", "fixture"); f.write("app.config.ts", "export default {};");
  const beforeConfig = backendSourceDigest(f.root);
  f.write("packages/backend/convex.json", '{"functions":"other/"}');
  assert.notEqual(backendSourceDigest(f.root), beforeConfig);
});

for (const [name, declaration] of [
  ["parentheses", 'export const write = (mutation({handler(ctx) { return ctx.db.insert("projects", {}); }}));'],
  ["as", 'export const write = mutation({handler(ctx) { return ctx.db.insert("projects", {}); }}) as RegisteredMutation;'],
  ["satisfies", 'export const write = mutation({handler(ctx) { return ctx.db.insert("projects", {}); }}) satisfies RegisteredMutation;'],
  ["conditional", 'export const write = enabled ? mutation({handler(ctx) { return ctx.db.insert("projects", {}); }}) : mutation({handler() { return null; }});'],
  ["commonjs", 'exports.write = mutation({handler(ctx) { return ctx.db.insert("projects", {}); }});'],
  ["later initialized binding", 'export let write; write = mutation({handler(ctx) { return ctx.db.insert("projects", {}); }});'],
] as const) {
  test(`inventory rejects an unregistered ${name} registered-function export`, async t => {
    const f = sourceFixture(t);
    f.write(`packages/backend/convex/extra.${name === "commonjs" ? "cjs" : "ts"}`, declaration);
    await assert.rejects(checkOrganizationMigration(f.root), /INCOMPLETE|REVIEW_REQUIRED/);
  });
}

for (const [name, handler] of [
  ["scheduler alias", 'const scheduler = ctx.scheduler; return scheduler.runAfter(0, internal.platform.customWriter.write, {});'],
  ["scheduler element access", 'return ctx.scheduler["runAfter"](0, internal.platform.customWriter.write, {});'],
  ["computed scheduler method", 'const method = "runAfter"; return ctx.scheduler[method](0, internal.platform.customWriter.write, {});'],
  ["destructured scheduler method", 'const { runAfter } = ctx.scheduler; return runAfter(0, internal.platform.customWriter.write, {});'],
  ["renamed scheduler with computed method", 'const s = ctx.scheduler; const method = "runAfter"; return s[method](0, internal.platform.customWriter.write, {});'],
] as const) {
  test(`inventory rejects an unclassified job through ${name}`, async t => {
    const f = sourceFixture(t);
    f.write("packages/backend/convex/known.ts", `export const write = mutation({handler(ctx) { ${handler} }});`);
    await assert.rejects(checkOrganizationMigration(f.root), /INCOMPLETE|REVIEW_REQUIRED/);
  });
}

for (const [name, file, body] of [
  ["HTTP", "http", 'import {httpRouter} from "convex/server"; const router = httpRouter(); router["route"]({path:"/unregistered",method:"POST",handler:httpAction(async () => new Response("data"))}); export default router;'],
  ["cron", "crons", 'import {cronJobs} from "convex/server"; const crons = cronJobs(); crons["interval"]("unregistered", {minutes:1}, internal.platform.customWriter.write, {}); export default crons;'],
] as const) {
  test(`a classified ${name} container does not hide unclassified element-access registrations`, async t => {
    const f = sourceFixture(t);
    f.write("packages/backend/convex/organizationMigrationRegistry.ts", `export const organizationMigrationRegistry = {
      version: 1, tables: {}, functions: { "known:write": "tenant", "${file}:default": "platform-control" }, jobs: {}, components: {}
    };`);
    f.write(`packages/backend/convex/${file}.ts`, body);
    await assert.rejects(checkOrganizationMigration(f.root), /INCOMPLETE|REVIEW_REQUIRED/);
  });
}

test("HTTP registrations imported from app-owned workspace helpers cannot evade classification", async t => {
  const f = sourceFixture(t);
  f.write("packages/backend/convex/organizationMigrationRegistry.ts", `export const organizationMigrationRegistry = {
    version: 1, tables: {}, functions: { "known:write": "tenant", "http:default": "platform-control" }, jobs: {}, components: {}
  };`);
  f.write("packages/backend/convex/http.ts", 'import {httpRouter} from "convex/server"; import {registerBuyerRoutes} from "../../business/routes"; const router = httpRouter(); registerBuyerRoutes(router); export default router;');
  f.write("packages/business/routes.ts", 'export function registerBuyerRoutes(router) { router.route({path:"/unclassified",method:"POST",handler:httpAction(async () => new Response("data"))}); }');
  await assert.rejects(checkOrganizationMigration(f.root), /INCOMPLETE|REVIEW_REQUIRED/);
});

test("HTTP registration helper resolved through the backend tsconfig alias is classified", async t => {
  const f = sourceFixture(t);
  f.write("packages/backend/convex/organizationMigrationRegistry.ts", `export const organizationMigrationRegistry = {
    version: 1, tables: {}, functions: { "known:write": "tenant", "http:default": "platform-control" }, jobs: {}, components: {}
  };`);
  f.write("packages/backend/convex/tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{"@buyer/*":["../../business/*"]}}}');
  f.write("packages/backend/convex/http.ts", 'import {httpRouter} from "convex/server"; import {registerBuyerRoutes} from "@buyer/routes"; const router = httpRouter(); registerBuyerRoutes(router); export default router;');
  f.write("packages/business/routes.ts", 'export function registerBuyerRoutes(router) { router.route({path:"/unclassified",method:"POST",handler:httpAction(async () => new Response("data"))}); }');
  await assert.rejects(checkOrganizationMigration(f.root), /INCOMPLETE|REVIEW_REQUIRED/);
});

test("a custom Convex function root cannot deploy unclassified code behind the default root's registry", async t => {
  const f = sourceFixture(t);
  f.write("packages/backend/convex.json", '{"functions":"custom/"}');
  f.write("packages/backend/custom/extra.ts", 'export const write = mutation({handler(ctx) { return ctx.db.insert("projects", {}); }});');
  // The production guard calls this without an explicit backendPath; it must
  // honor the actual Convex configuration or reject this unsupported layout.
  await assert.rejects(checkOrganizationMigration(f.root), /INCOMPLETE|REVIEW_REQUIRED|ROOT|REGISTRY|ENOENT/);
});

for (const directory of ["tests", "dist", ".policy"]) {
  test(`an imported authorization module in ${directory} is bound or explicitly refused`, t => {
    const f = sourceFixture(t);
    mkdirSync(join(f.root, "platform/packages"), { recursive: true });
    f.write("bun.lock", "fixture"); f.write("app.config.ts", "export default {};");
    const imported = `packages/business/${directory}/policy.ts`;
    f.write("packages/backend/convex/known.ts", `import {allow} from "../../business/${directory}/policy"; export const write = mutation({handler(ctx) { if (!allow) throw new Error("Denied"); }});`);
    f.write(imported, "export const allow = false;");
    let before: string;
    try { before = backendSourceDigest(f.root); } catch (error) { assert.match(String(error), /source|import|review/i); return; }
    f.write(imported, "export const allow = true;");
    assert.notEqual(backendSourceDigest(f.root), before);
  });
}
