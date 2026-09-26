---
name: platform-add-table
description: Use to add a new Convex table for app data - schema entry, indexes, authenticated queries and mutations with ownership checks, generated types and backend tests. Also covers adding fields to an app table.
---

# Add an app table

The backend is one Convex project in `packages/backend/convex/`. Its `schema.ts` is a **seam**:
the platform's tables and yours live side by side. Background: `platform/docs/code-style.md`
(Convex section), `platform/docs/testing.md` (convex-test) and `platform/docs/convex-migrations.md`.

## Rules

- **Add, don't edit.** Add your table at the end of the schema object in `schema.ts`. Never
  change or remove a platform table (`userProfiles`, `adminEmails`, `appSettings`,
  `waitlistEntries`, `invitationTokens`, `adminInvitations`, `announcements`, `auditTrail`, the
  rate-limit and migration tables, and Better Auth's component tables).
- **One module per table**, named in camelCase after it: `convex/bookmarks.ts`.
- **Authenticated by default.** Use `authedQuery` and `authedMutation` from `./functions`:
  handlers get `ctx.ownerId`; `authedQuery` returns `null` when signed out (safe for `useQuery`),
  `authedMutation` throws `NOT_AUTHENTICATED` and applies the global mutation rate limit.
  Use plain `query`/`mutation` only for data that is deliberately public.
- **Own your rows.** Store `ownerId: v.string()` and index it (`by_owner`). Every read filters by
  `ctx.ownerId` through the index; every write to an existing row loads it and checks
  `row.ownerId === ctx.ownerId` first. Rows that belong to a project go through
  `requireProjectAccess(ctx, projectId)` from `./functions`.
- **Validate everything.** `v` validators on every argument and field; string lengths with
  `assertMaxLength(value, MAX_NAME_LENGTH, "TITLE")`.
- **Errors are codes**, not text: `throw new Error("BOOKMARK_NOT_FOUND")`. Give each code a
  translated message with the `platform-add-strings` skill.
- **Queries by index.** Use `.withIndex(...)`, not `.filter(...)`, for anything that can grow.
- **Changing an existing table** that has data: adding a table, an optional field or an index is
  safe to deploy directly. Removing, renaming or narrowing needs widen, migrate, narrow
  (`platform/docs/convex-migrations.md`).
- **Never edit `convex/_generated/`** by hand; regenerate it.

## Steps

1. **Schema.** Add the table at the end of `packages/backend/convex/schema.ts`, with indexes for
   every query you will run.
2. **Functions.** Create `packages/backend/convex/<table>.ts` with the queries and mutations.
3. **Generate types.** `convex/_generated/` must list the new module, or `api.<table>` won't
   typecheck. With `bun run dev` running, Convex regenerates it on save. Without it, run once
   from the backend package:

   ```bash
   cd packages/backend && CONVEX_AGENT_MODE=anonymous bunx convex dev --once
   ```

   This starts a local backend for this checkout, pushes the functions, regenerates and exits.
   Commit everything it regenerates under `convex/_generated/` and
   `convex/betterAuth/_generated/`, even lines unrelated to your table: generated files are
   committed as generated, never trimmed by hand.
4. **Tests.** `packages/backend/convex/<table>.test.ts` with convex-test. Pass the module glob
   (monorepo requirement) and cover: required fields are enforced, the owner index returns only
   that owner's rows, and each pure helper your module exports.

   ```ts
   import { convexTest } from "convex-test";
   import { describe, expect, test } from "vitest";
   import schema from "./schema";

   const modules = import.meta.glob("./**/*.*s");
   ```

5. **Audit (optional).** If the action matters for security or support, record it with
   `scheduleAuditEvent` and add the action to `auditTrailConstants.ts`
   (`platform/docs/audit-trail-architecture.md`).
6. **Check.**

   ```bash
   bun run test:convex
   bun run lint && bun run typecheck
   ```

7. **Use it** from an app with `useQuery(api.<table>.list)` and `useMutation(api.<table>.add)`
   (`import { api } from "@repo/backend"`). Handle `undefined` (loading) and `null` (signed out).

## Worked example

**Task:** signed-in users of the web app can save bookmarks: a URL and a title. They can list
their own bookmarks, newest first, and remove one. Nobody sees another user's bookmarks.

`schema.ts`, at the end of the schema object:

```ts
  bookmarks: defineTable({
    url: v.string(),
    title: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),
```

`convex/bookmarks.ts`:

```ts
import { v } from "convex/values";

import { assertMaxLength, authedMutation, authedQuery, MAX_NAME_LENGTH } from "./functions";

export const MAX_URL_LENGTH = 2048;

/** Accept only absolute http(s) URLs. Throws INVALID_URL otherwise. */
export function normalizeBookmarkUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("INVALID_URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("INVALID_URL");
  return url.toString();
}

export const list = authedQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("bookmarks")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.ownerId))
      .order("desc")
      .collect();
  },
});

export const add = authedMutation({
  args: { url: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    assertMaxLength(args.url, MAX_URL_LENGTH, "URL");
    assertMaxLength(args.title, MAX_NAME_LENGTH, "TITLE");
    return ctx.db.insert("bookmarks", {
      url: normalizeBookmarkUrl(args.url),
      title: args.title.trim(),
      ownerId: ctx.ownerId,
      createdAt: Date.now(),
    });
  },
});

export const remove = authedMutation({
  args: { id: v.id("bookmarks") },
  handler: async (ctx, args) => {
    const bookmark = await ctx.db.get(args.id);
    if (!bookmark || bookmark.ownerId !== ctx.ownerId) throw new Error("BOOKMARK_NOT_FOUND");
    await ctx.db.delete(args.id);
  },
});
```

`convex/bookmarks.test.ts` inserts bookmarks for two owners with `t.run`, asserts the
`by_owner` index returns only the first owner's, asserts an insert without `url` is rejected,
and tests `normalizeBookmarkUrl` (accepts `https://example.com`, rejects `javascript:alert(1)`
and `not a url` with `INVALID_URL`). Then regenerate types (step 3).

**Done when** `bun run test:convex`, `bun run lint` and `bun run typecheck` pass and
`convex/_generated/api.d.ts` lists `bookmarks`.
