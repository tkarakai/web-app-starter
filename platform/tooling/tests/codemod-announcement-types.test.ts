import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteText } from "../codemods/v2-announcement-types.ts";

test("converts announcement row and ID bindings together without changing app table types", () => {
  const source = `import type { Doc as Row, Id } from "@repo/backend";
  type A = Row<"announcements">; type B = Id<"announcements">; type P = Row<"projects">;`;
  const result = rewriteText(source, "/app/file.ts", "/app");
  assert.match(result, /import\("@repo\/backend"\).Announcement/);
  assert.match(result, /type B = string/);
  assert.match(result, /Doc as Row/);
  assert.doesNotMatch(result, /\bId\b/);
  assert.match(result, /Row<"projects">/);
  assert.equal(rewriteText(result, "/app/file.ts", "/app"), result);
});

test("removes both unused type imports and leaves unrelated Doc and Id definitions alone", () => {
  const source = `import { Doc, Id } from "./_generated/dataModel";
  type A = Doc<'announcements'>; type B = Id<'announcements'>;`;
  const result = rewriteText(source, "/app/packages/backend/convex/example.ts", "/app");
  assert.doesNotMatch(result, /from/);
  assert.match(result, /type B = string/);
  const own = `import { Doc, Id } from "./domain"; type A = Doc<"announcements">;`;
  assert.equal(rewriteText(own, "/app/file.ts", "/app"), own);
});
