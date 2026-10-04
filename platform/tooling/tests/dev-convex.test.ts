import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";


test("anonymous CI launcher bounds query execution without changing interactive defaults", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "convex-launcher-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory,"platform/tooling"),{recursive:true});
  for(const name of ["dev-convex.sh","local-dev-deps.ts","node-ts.sh","package.json"]) fs.copyFileSync(new URL("../"+name,import.meta.url),path.join(directory,"platform/tooling",name));
  fs.mkdirSync(path.join(directory,"node_modules/convex"),{recursive:true});
  fs.writeFileSync(path.join(directory,"package.json"),"{}");
  fs.writeFileSync(path.join(directory,"node_modules/convex/package.json"),'{"name":"convex","bin":"fixture.cjs"}');
  fs.writeFileSync(path.join(directory,"node_modules/convex/fixture.cjs"), 'console.log("convex "+process.argv.slice(2).join(" "));console.log(process.env.CONVEX_AGENT_MODE);console.log(process.env.DATABASE_UDF_USER_TIMEOUT_SECONDS??"unset");process.exit(19);');
  fs.writeFileSync(path.join(directory, "npx"), '#!/bin/bash\necho "Unexpected package download" >&2\nexit 127\n', { mode: 0o755 });
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
    const result = spawnSync("bash", [path.join(directory,"platform/tooling/dev-convex.sh")], { cwd: directory, env: { ...clean, ...environment }, encoding: "utf8" });
    assert.equal(result.status, 19, result.stderr);
    assert.equal(result.stdout, `convex dev\nanonymous\n${expected}\n`);
  }
});
