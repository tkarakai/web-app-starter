import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reset-db-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tooling = path.join(root, "platform/tooling");
  fs.mkdirSync(tooling, { recursive: true });
  for (const name of ["dev-nuke-db.sh", "dev-reset-db.ts", "dev-processes.ts", "node-ts.sh", "package.json"]) fs.copyFileSync(new URL(`../${name}`, import.meta.url), path.join(tooling, name));
  const backend = path.join(root, "packages/backend");
  const state = path.join(backend, ".convex/local/default");
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, "db.sqlite3"), "old data");
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(home, ".convex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".convex/config.json"), '{"accessToken":"fixture-token"}');
  for (const name of ["npx", "convex"]) fs.writeFileSync(path.join(root, name), '#!/bin/sh\necho "CLI must not run" >&2\nexit 91\n', { mode: 0o755 });
  const run = () => spawnSync("bash", [path.join(tooling, "dev-nuke-db.sh"), "--yes"], { env: { ...process.env, HOME: home, PATH: `${root}${path.delimiter}${process.env.PATH}` }, encoding: "utf8" });
  return { root, backend, state, home, run };
}

test("logged-in reset deletes project state and stale pointers without invoking CLI or changing credentials", t => {
  const f = fixture(t);
  const env = path.join(f.backend, ".env.local");
  fs.writeFileSync(env, '# keep\nCUSTOM=value\nCONVEX_DEPLOYMENT=local:broken\nCONVEX_URL=http://localhost:3210\nexport CONVEX_SITE_URL=http://localhost:3211\n');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.state), false);
  assert.equal(fs.readFileSync(env, "utf8"), '# keep\nCUSTOM=value\n');
  assert.equal(fs.readFileSync(path.join(f.home, ".convex/config.json"), "utf8"), '{"accessToken":"fixture-token"}');
  assert.equal(f.run().status, 0);
});

test("reset works before first configuration", t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(fs.existsSync(path.join(f.backend, ".env.local")), false);
});

test("redirected state refuses reset without deleting external data or env", t => {
  const f = fixture(t);
  const external = path.join(f.root, "external");
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, "db.sqlite3"), "preserved");
  fs.rmSync(f.state, { recursive: true });
  fs.symlinkSync(external, f.state);
  const env = path.join(f.backend, ".env.local");
  fs.writeFileSync(env, "CONVEX_DEPLOYMENT=anonymous:test\n");
  assert.equal(f.run().status, 1);
  assert.equal(fs.readFileSync(path.join(external, "db.sqlite3"), "utf8"), "preserved");
  assert.equal(fs.readFileSync(env, "utf8"), "CONVEX_DEPLOYMENT=anonymous:test\n");
});

test("failed process ownership validation leaves database and environment untouched", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, ".dev-processes.json"), JSON.stringify({ root: "/another-checkout", services: {} }));
  const env = path.join(f.backend, ".env.local");
  fs.writeFileSync(env, "CONVEX_DEPLOYMENT=anonymous:test\n");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /another checkout/);
  assert.equal(fs.readFileSync(path.join(f.state, "db.sqlite3"), "utf8"), "old data");
  assert.equal(fs.readFileSync(env, "utf8"), "CONVEX_DEPLOYMENT=anonymous:test\n");
});
