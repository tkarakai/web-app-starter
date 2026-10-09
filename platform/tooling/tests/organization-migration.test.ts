import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../codemods/organization-register-migration.ts";
import { checkOrganizationMigration, registryHash } from "../organization-migration-check.ts";

test("organization registration codemod is check-only, idempotent and preserves custom registrations", t => {
  const root = mkdtempSync(join(tmpdir(), "organization-codemod-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(migrate(root, true), ["packages/backend/convex/organizationMigrationRegistry.ts"]);
  assert.deepEqual(migrate(root), ["packages/backend/convex/organizationMigrationRegistry.ts"]);
  const path = join(root, "packages/backend/convex/organizationMigrationRegistry.ts");
  assert.match(readFileSync(path, "utf8"), /Empty is NOT ready/);
  writeFileSync(path, "custom buyer mappings");
  assert.deepEqual(migrate(root), []); assert.equal(readFileSync(path, "utf8"), "custom buyer mappings");
  assert.deepEqual(migrate(root, true, "custom/convex"), ["custom/convex/organizationMigrationRegistry.ts"]);
  assert.throws(() => migrate(root, false, "../escape"), /inside/);
});
test("source inventory fails closed on a custom unregistered exported API and dynamic scheduled authority", async t => {
  const root = mkdtempSync(join(tmpdir(), "organization-inventory-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const backend = join(root, "packages/backend/convex"); mkdirSync(backend, { recursive: true });
  writeFileSync(join(root, "packages/backend/package.json"), '{"type":"module"}');
  symlinkSync(fileURLToPath(new URL("../../../packages/backend/node_modules", import.meta.url)), join(root, "packages/backend/node_modules"));
  cpSync(fileURLToPath(new URL("../../../packages/backend/convex/organizationMigrationRegistry.ts", import.meta.url)), join(backend, "organizationMigrationRegistry.ts"));
  writeFileSync(join(backend, "custom.ts"), 'export const execute = customTenantBuilder({ handler() {} });');
  await assert.rejects(checkOrganizationMigration(root), /custom:execute/);
  writeFileSync(join(backend, "custom.ts"), 'export const enqueue = mutation({handler(ctx) { ctx.scheduler.runAfter(0, destination, {}); }});');
  await assert.rejects(checkOrganizationMigration(root), /DYNAMIC_JOB_REVIEW_REQUIRED/);
});
test("registry digest is order-independent but changes for function/job/tenant dispositions", () => {
  const base = { version: 1, tables: { private: "private-root" }, functions: { "custom:read": "tenant" }, jobs: {}, components: {} };
  assert.equal(registryHash(base), registryHash({ jobs: {}, components: {}, functions: base.functions, tables: base.tables, version: 1 }));
  assert.notEqual(registryHash(base), registryHash({ ...base, jobs: { "custom:write": "drain" } }));
});
