import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { migrate, transformConfig } from "../codemods/v2-secret-safe-e2e.ts";

const source = `import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./custom-tests", reporter: [["html"]],
use: { baseURL: "http://localhost:4101", trace: "on-first-retry", screenshot: "only-on-failure" },
projects: [{ name: "custom", use: { channel: "chrome", video: "on" } }] });\n`;
test("codemod disables all config captures while preserving custom app settings and is idempotent", () => {
  const first = transformConfig(source, "../../platform/tooling/e2e/secret-safe-reporter.ts");
  assert.equal(transformConfig(first, "../../platform/tooling/e2e/secret-safe-reporter.ts"), first);
  for (const text of ['testDir: "./custom-tests"', 'baseURL: "http://localhost:4101"', 'channel: "chrome"']) assert.ok(first.includes(text));
  assert.ok(!first.includes('"on-first-retry"') && !first.includes('"only-on-failure"') && !first.includes('video: "on"'));
  const result = ts.transpileModule(first, { compilerOptions: { target: ts.ScriptTarget.ESNext }, reportDiagnostics: true });
  assert.equal(result.diagnostics?.length, 0);
  assert.ok(first.includes('reporter: [["../../platform/tooling/e2e/secret-safe-reporter.ts"]]'));
  assert.ok(first.includes('from "../../platform/tooling/e2e/secret-safe-config.ts"'));
});
test("codemod handles empty config and refuses dynamic custom capture configuration", () => {
  const first = transformConfig('export default defineConfig({});', "./safe.ts");
  assert.equal(transformConfig(first, "./safe.ts"), first);
  assert.equal(ts.transpileModule(first, { reportDiagnostics: true }).diagnostics?.length, 0);
  assert.throws(() => transformConfig('export default defineConfig(makeConfig());', "./safe.ts"), /Custom Playwright/);
  assert.throws(() => transformConfig('export default defineConfig({ use: customUse });', "./safe.ts"), /Custom use/);
  assert.throws(() => transformConfig('export default defineConfig({ use: {}, ...customConfig });', "./safe.ts"), /Custom config spread/);
  assert.throws(() => transformConfig('export default defineConfig({ use: { trace: "on", ...customUse } });', "./safe.ts"), /later config spread/);
  assert.throws(() => transformConfig('export default defineConfig({ use: { trace: "off", [captureName]: "on" } });', "./safe.ts"), /Computed config/);
  assert.throws(() => transformConfig('export default defineConfig({ projects: [{ use: {}, ...customProject }] });', "./safe.ts"), /Custom project/);
  assert.throws(() => transformConfig('export default defineConfig({ projects: [...customProjects] });', "./safe.ts"), /Custom project/);
});
test("check is read-only, script/dependency migration is narrow and repeatable, symlinks and custom commands refuse", t => {
  const root = mkdtempSync(join(tmpdir(), "safe-codemod-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "custom/app"); mkdirSync(app, { recursive: true });
  const manifest = { name: "custom", scripts: { "test:e2e": "playwright test", "test:e2e:ui": "playwright test --ui", build: "keep-me" }, devDependencies: { "@playwright/test": "^1.63.0" } };
  writeFileSync(join(root, "package.json"), '{"name":"buyer"}\n');
  writeFileSync(join(app, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(app, "playwright.config.ts"), source);
  assert.equal(migrate(root, true, "custom/app").length, 3);
  assert.equal(readFileSync(join(app, "playwright.config.ts"), "utf8"), source);
  assert.equal(migrate(root, false, "custom/app").length, 3);
  assert.deepEqual(migrate(root, true, "custom/app"), []);
  const next = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  assert.equal(next.scripts.build, "keep-me");
  assert.equal(next.scripts["test:e2e"], "../../platform/tooling/node-ts.sh ../../platform/tooling/e2e/secret-safe-playwright.ts");
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies["@playwright/test"], "^1.63.0");
  next.scripts["test:e2e"] = "custom runner --keep"; writeFileSync(join(app, "package.json"), JSON.stringify(next));
  assert.throws(() => migrate(root, false, "custom/app"), /Custom test:e2e/);
  symlinkSync(app, join(root, "alias")); assert.throws(() => migrate(root, false, "alias"), /symlinked/);
  assert.throws(() => migrate(root, false, "../outside"), /inside/);
});
