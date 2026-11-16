/** The admin E2E suite shares one backend's global settings across its spec files. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const admin = fileURLToPath(new URL("../../apps/admin/", import.meta.url));

// The agentic specs turn the global agent surfaces (MCP, CLI, WebMCP, A2A) on and off, and each
// cleans up by disabling them. Run in parallel, one file's cleanup disabled WebMCP while another
// file was using it (SURFACE_DISABLED). platform:upgrade runs `test:e2e` in the caller's
// environment, usually without CI=true, so the suite must be serial in every mode.
test("admin E2E runs on one worker in every mode, because its specs toggle shared global settings", () => {
  const config = readFileSync(path.join(admin, "playwright.config.ts"), "utf8");
  const mutators = readdirSync(path.join(admin, "qa/e2e")).filter(file => file.endsWith(".spec.ts") && /getByRole\("switch", \{ name: [`"]Enable /.test(readFileSync(path.join(admin, "qa/e2e", file), "utf8")));
  assert.ok(mutators.length > 1, "several admin spec files toggle global surfaces");
  assert.match(config, /^\s*workers: 1,/m, "workers must be 1 regardless of CI");
  assert.match(config, /^\s*fullyParallel: false,/m, "tests within a file must not run in parallel either");
});
