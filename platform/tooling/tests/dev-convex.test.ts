import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const launcher = fileURLToPath(new URL("../dev-convex.sh", import.meta.url));

test("anonymous CI launcher bounds query execution without changing interactive defaults", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "convex-launcher-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "npx"), '#!/bin/bash\nprintf "%s\\n" "$*" "$CONVEX_AGENT_MODE" "${DATABASE_UDF_USER_TIMEOUT_SECONDS-unset}"\nexit 19\n', { mode: 0o755 });
  const clean: Record<string, string | undefined> = { ...process.env, PATH: directory + path.delimiter + process.env.PATH };
  delete clean.CI;
  delete clean.DATABASE_UDF_USER_TIMEOUT_SECONDS;
  for (const [environment, expected] of [
    [{}, "unset"],
    [{ CI: "false" }, "unset"],
    [{ CI: "true" }, "5"],
    [{ CI: "true", DATABASE_UDF_USER_TIMEOUT_SECONDS: "2" }, "2"],
    [{ DATABASE_UDF_USER_TIMEOUT_SECONDS: "3" }, "3"],
  ] as const) {
    const result = spawnSync("bash", [launcher], { env: { ...clean, ...environment }, encoding: "utf8" });
    assert.equal(result.status, 19, result.stderr);
    assert.equal(result.stdout, `convex dev\nanonymous\n${expected}\n`);
  }
});
