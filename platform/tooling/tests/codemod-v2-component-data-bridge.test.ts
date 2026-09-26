import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { addComponent, prepare } from "../codemods/v2-component-data-bridge.ts";
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "component-bridge-test-")); roots.push(root);
  fs.mkdirSync(path.join(root, "packages/backend/convex"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*", "packages/*"] }) + "\n");
  fs.writeFileSync(path.join(root, "packages/backend/package.json"), JSON.stringify({ dependencies: { convex: "1.45.0" } }) + "\n");
  fs.writeFileSync(path.join(root, "packages/backend/convex/convex.config.ts"), 'import { defineApp } from "convex/server";\nconst app = defineApp();\nexport default app;\n');
  fs.writeFileSync(path.join(root, "packages/backend/convex/schema.ts"), "// Original legacy schema must stay intact.\n");
  fs.writeFileSync(path.join(root, "packages/backend/convex/announcements.ts"), "// Original scheduled handlers must stay intact.\n");
  return root;
}
test("check is read-only; applying the bridge preserves legacy files and is idempotent", () => {
  const root = fixture();
  const before = fs.readFileSync(path.join(root, "package.json"), "utf8");
  const planned = prepare(root, source, true);
  assert(planned.length > 10);
  assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), before);
  assert.equal(fs.existsSync(path.join(root, "platform")), false);
  assert.deepEqual(prepare(root, source), planned);
  assert.deepEqual(prepare(root, source), []);
  assert.equal(fs.readFileSync(path.join(root, "packages/backend/convex/schema.ts"), "utf8"), "// Original legacy schema must stay intact.\n");
  assert.equal(fs.readFileSync(path.join(root, "packages/backend/convex/announcements.ts"), "utf8"), "// Original scheduled handlers must stay intact.\n");
});
test("preflights collisions before changing any seam", () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "packages/backend/convex/platform"));
  fs.writeFileSync(path.join(root, "packages/backend/convex/platform/componentMigration.ts"), "// custom code\n");
  const before = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.throws(() => prepare(root, source), /overwrite an existing file/);
  assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), before);
  assert.equal(fs.existsSync(path.join(root, "platform")), false);
});
test("refuses writes through symlinked destinations and incompatible Convex versions", () => {
  const root = fixture(); const outside = fixture();
  fs.symlinkSync(outside, path.join(root, "platform"));
  assert.throws(() => prepare(root, source), /Refusing symlink/);
  fs.unlinkSync(path.join(root, "platform"));
  fs.writeFileSync(path.join(root, "packages/backend/package.json"), JSON.stringify({ dependencies: { convex: "1.0.0" } }));
  assert.throws(() => prepare(root, source), /Convex dependency/);
});
test("component insertion understands a renamed app and ignores commented installations", () => {
  const text = 'const backend = defineApp();\n// backend.use(platformMigrationComponent);\nexport default backend;\n';
  assert.throws(() => addComponent(text), /binding already exists/);
  const ready = addComponent(text.replace('// backend.use(platformMigrationComponent);\n', ''));
  assert.match(ready, /backend.use\(platformMigrationComponent\);/);
  assert.equal(addComponent(ready), ready);
});
