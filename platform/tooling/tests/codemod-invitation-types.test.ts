import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteText } from "../codemods/v2-invitation-types.ts";

test("migrates all invitation row and ID types while preserving app types and aliases", () => {
  const source = `import type { Doc as Row, Id } from "@repo/backend";
  type A = Row<"waitlistEntries">; type B = Row<"adminInvitations">; type C = Row<"invitationTokens">;
  type D = Id<"waitlistEntries">; type E = Id<'adminInvitations'>; type F = Id<"invitationTokens">; type P = Row<"projects">;`;
  const result = rewriteText(source, "/app/file.ts", "/app");
  for (const name of ["WaitlistEntry", "AdminInvitation", "InvitationToken"]) assert.ok(result.includes(`import("@repo/backend").${name}`));
  assert.match(result, /type D = string; type E = string; type F = string/);
  assert.match(result, /Doc as Row/);
  assert.doesNotMatch(result, /\bId\b/);
  assert.match(result, /Row<"projects">/);
  assert.equal(rewriteText(result, "/app/file.ts", "/app"), result);
});

test("removes unused data-model bindings and ignores similarly named domain types", () => {
  const source = `import { Doc, Id } from "./_generated/dataModel"; type A = Doc<'waitlistEntries'>; type B = Id<'waitlistEntries'>;`;
  const result = rewriteText(source, "/app/packages/backend/convex/example.ts", "/app");
  assert.doesNotMatch(result, /from/);
  assert.match(result, /type B = string/);
  const own = `import { Doc } from "./domain"; type A = Doc<"waitlistEntries">;`;
  assert.equal(rewriteText(own, "/app/file.ts", "/app"), own);
});
