import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const helper = "apps/landing/qa/helpers/configuration-acceptance.ts";

test("adoption retains configuration-aware landing components and browser scenarios", {
  skip: !existsSync(path.join(root, helper)), timeout: 120_000,
}, () => {
  const output = execFileSync(path.join(root, "platform/tooling/node-ts.sh"), [helper, "--components"], {
    cwd: root, encoding: "utf8", timeout: 110_000,
  });
  assert.match(output, /PASS: adopted landing configuration matrix; source app.config.ts preserved/);
});
