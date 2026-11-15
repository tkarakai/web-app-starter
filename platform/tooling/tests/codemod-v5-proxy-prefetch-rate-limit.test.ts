import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { migrate, migrateContent } from "../codemods/v5-proxy-prefetch-rate-limit.ts";

// Self-contained: adopted apps run this test against their own files, which may differ.
// The matcher as shipped from v2.0.0 to v4.1.0 (identical in each), and as v5.0.0 ships it.
const head = 'export const config = {\n  matcher: [\n    {\n      source: "/((?!api|_next/static).*)",\n';
const tail = "    },\n  ],\n};\n";
const shipped = head + '      missing: [\n        { type: "header", key: "next-router-prefetch" },\n        { type: "header", key: "purpose", value: "prefetch" },\n      ],\n' + tail;
const current = head + "      // Prefetch headers are client-controlled: page requests must share the rate limit.\n" + tail;

test("turns the shipped proxy into v5's, and leaves v5's alone", () => {
  assert.equal(migrateContent(shipped), current);
  assert.equal(migrateContent(current), current);
});

test("keeps a customized matcher for review", () => {
  const custom = shipped.replace('{ type: "header", key: "purpose", value: "prefetch" },', '{ type: "header", key: "x-internal" },');
  assert.equal(migrateContent(custom), custom);
});

test("check is read-only, migration is idempotent and a missing file is fine", t => {
  const root = mkdtempSync(join(process.cwd(), ".v5-proxy-prefetch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(migrate(root), []);
  mkdirSync(join(root, "apps/web/src"), { recursive: true });
  const file = join(root, "apps/web/src/proxy.ts");
  writeFileSync(file, shipped);
  assert.deepEqual(migrate(root, true), ["apps/web/src/proxy.ts"]);
  assert.equal(readFileSync(file, "utf8"), shipped);
  assert.deepEqual(migrate(root), ["apps/web/src/proxy.ts"]);
  assert.equal(readFileSync(file, "utf8"), current);
  assert.deepEqual(migrate(root), []);
});
