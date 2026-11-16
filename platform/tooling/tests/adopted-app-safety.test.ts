/** Platform tests run in adopted apps too (`test:dev-scripts` in `platform:upgrade`). */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const tests = path.dirname(fileURLToPath(import.meta.url));

// removeSample() overwrites app-owned files (organizationData.ts, the auth and validation tests)
// from the adoption templates. Replaying it on a copy of an adopted app's own code and then
// running that app's suites erases the app's changes in the copy and fails its tests, so such
// tests must skip once `.platform-base.json` records the adoption.
test("tests that replay sample removal on the repository's own app skip in adopted apps", () => {
  const offenders: string[] = [];
  for (const file of readdirSync(tests).filter(name => name.endsWith(".test.ts"))) {
    const source = readFileSync(path.join(tests, file), "utf8");
    for (const block of source.split(/\ntest\(/).slice(1)) {
      if (!block.includes("removeSample(") || !/cpSync\(path\.join\(REPO, "(packages|apps)\//.test(block)) continue;
      const header = block.slice(0, block.indexOf("=>"));
      if (!header.includes(".platform-base.json")) offenders.push(`${file}: ${block.slice(0, block.indexOf(",")).trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});
