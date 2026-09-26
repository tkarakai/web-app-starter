import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { migrate, rewriteText } from "../codemods/v2-audit-trail-type.ts";

test("converts backend Doc aliases, keeps app table types and unrelated Doc types", () => {
  const input = `import type { Doc as Row, Id } from "@repo/backend";
type Event = Row<'auditTrail'>;
type Project = Row<"projects">;
type ProjectId = Id<"projects">;`;
  const actual = rewriteText(input, "/app/apps/web/test.ts", "/app");
  assert.match(actual, /type Event = import\("@repo\/backend"\).AuditTrailEvent/);
  assert.match(actual, /Doc as Row/);
  assert.match(actual, /Row<"projects">/);
  assert.equal(rewriteText(actual, "/app/apps/web/test.ts", "/app"), actual);
  const own = `import { Doc } from "./domain"; type Event = Doc<"auditTrail">;`;
  assert.equal(rewriteText(own, "/app/apps/web/test.ts", "/app"), own);
});

test("supports relocated data model imports and removes unused Doc specifiers", () => {
  const input = `import type { Doc, Id } from "../_generated/dataModel.js"; type Event = Doc<"auditTrail">;`;
  const actual = rewriteText(input, "/app/backend/fns/ui/test.ts", "/app", "backend/fns");
  assert.match(actual, /import type \{ Id \}/);
  assert.doesNotMatch(actual, /\bDoc\b/);
  const only = `import type { Doc } from "@repo/backend"; type Event = Doc<"auditTrail">;`;
  assert.doesNotMatch(rewriteText(only, "/app/test.ts", "/app"), /import type/);
});

test("check leaves files unchanged, apply is idempotent and skips platform/generated trees", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "audit-type-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = `import { Doc } from "@repo/backend"; type Event = Doc<"auditTrail">;`;
  for (const file of ["app.ts", "platform/test.ts", "_generated/test.ts"]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), input);
  }
  assert.deepEqual(migrate(root, true), ["app.ts"]);
  assert.equal(readFileSync(path.join(root, "app.ts"), "utf8"), input);
  assert.deepEqual(migrate(root), ["app.ts"]);
  assert.deepEqual(migrate(root), []);
  assert.equal(readFileSync(path.join(root, "platform/test.ts"), "utf8"), input);
});
