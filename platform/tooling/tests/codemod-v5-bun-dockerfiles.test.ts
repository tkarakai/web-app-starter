import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { migrate, migrateContent } from "../codemods/v5-bun-dockerfiles.ts";

const stock = "ARG NODE_VERSION=24\nARG BUN_VERSION=1.4.2\nFROM oven/bun:${BUN_VERSION} AS bun\n";

test("bumps only the exact stock Bun argument", () => {
  assert.equal(migrateContent(stock), stock.replace("BUN_VERSION=1.4.2", "BUN_VERSION=1.4.4"));
  assert.equal(migrateContent(migrateContent(stock)), migrateContent(stock));
  for (const own of ["ARG BUN_VERSION=1.4.3\n", "ARG BUN_VERSION=1.4.20\n", "# ARG BUN_VERSION=1.4.2\n", "ENV BUN_VERSION=1.4.2\n"]) assert.equal(migrateContent(own), own);
});

test("check is read-only, migration is idempotent, other files and a missing directory are fine", t => {
  const root = mkdtempSync(join(process.cwd(), ".v5-bun-dockerfiles-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(migrate(root), []);
  const dir = join(root, "infra/aws/docker");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "next-app.Dockerfile"), stock);
  writeFileSync(join(dir, "next-app.Dockerfile.dockerignore"), "ARG BUN_VERSION=1.4.2\n");
  assert.deepEqual(migrate(root, true), ["infra/aws/docker/next-app.Dockerfile"]);
  assert.equal(readFileSync(join(dir, "next-app.Dockerfile"), "utf8"), stock);
  assert.deepEqual(migrate(root), ["infra/aws/docker/next-app.Dockerfile"]);
  assert.match(readFileSync(join(dir, "next-app.Dockerfile"), "utf8"), /^ARG BUN_VERSION=1\.4\.4$/m);
  assert.equal(readFileSync(join(dir, "next-app.Dockerfile.dockerignore"), "utf8"), "ARG BUN_VERSION=1.4.2\n");
  assert.deepEqual(migrate(root), []);
  assert.throws(() => migrate(root, false, "../outside"), /inside the app root/);
});
