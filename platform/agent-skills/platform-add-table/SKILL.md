---
name: platform-add-table
description: Use to add a Convex app table or fields, choosing user-owned, organization-shared or organization-private access with schema, indexes, functions, generated types and backend tests.
---

# Add an app table

The backend is one Convex project in `packages/backend/convex/`. Platform functions live in
`convex/platform/` (platform zone: never edit) and are called as `api.platform.<module>`; your
modules live at the `convex/` root and are called as `api.<module>`. `schema.ts` is a **seam**:
it spreads the platform's tables (`...platformTables`, the platform hook) and the sample domain's
(`...sampleTables` from `sampleTables.ts`), then lists yours. Background:
`platform/docs/code-style.md` (Convex section), `platform/docs/testing.md` (convex-test) and
`platform/docs/convex-migrations.md`. Read `platform/docs/data-access-models.md` and the selected
recipe before choosing builders and indexes; read `platform/docs/organizations.md` for org lifecycle.

## Rules

- **Add, don't edit.** Add your table at the end of the schema object in `schema.ts`, after the
  spreads. Keep the `...platformTables` spread, and never reuse a platform table name (see
  `convex/platform/tables.ts`; Better Auth's component tables are separate).
- **One module per table**, named in camelCase after it: `convex/bookmarks.ts`. Never put app
  modules in `convex/platform/`.
- **Choose ownership and audience.** Follow the app's declared model. Use `authedQuery` and
  `authedMutation` with owner checks for user-owned data, including an individual-only service.
  Use `orgQuery`/`orgMutation` with org checks for shared data, and **both org and owner checks**
  for member-private org data. Compose those recipes for mixed apps. If intent is unspecified,
  determine whether colleagues should see the records before implementing; do not silently
  turn personal data into shared data. Builders add context, not automatic row filtering.
  With `orgQuery` and `orgMutation` from `./platform/functions`:
  handlers get `ctx.organizationId` (the caller's active organization, membership re-checked on
  every call), `ctx.organizationRole` (`owner`, `admin` or `member`) and `ctx.ownerId`. `orgQuery`
  returns `null` when signed out or without a membership (safe for `useQuery`); `orgMutation`
  throws `NO_ORGANIZATION` for a signed-in user without a membership and `NOT_AUTHENTICATED`
  when signed out, and applies the global mutation rate limit. Both enforce live session assurance and current
  verification/MFA/passkey/enrollment policy. `authed*` provides `ctx.user` and `ctx.ownerId`
  without requiring org membership. Use canonical `ctx.ownerId` for app ownership; it may
  differ from the Better Auth user ID on migrated accounts.
  Use `adminMutation` for administrative writes: it adds admin-role and recent-authentication
  checks. Do not substitute `auth.getCurrentUser`, raw Better Auth user lookup or account MFA flags
  for authorization; those can represent a limited enrollment/recovery session. See
  [session assurance](../../docs/authentication-and-onboarding.md#85-session-assurance-and-reauthentication).
  Use plain `query`/`mutation` only for data that is deliberately public.
- **Scope org-owned rows.** Store `organizationId: v.string()` and index it (`by_organization`); keep
  `ownerId: v.string()` too if you want to show who created a row. Every read filters by
  `ctx.organizationId` through the index; every read or write of a row by ID loads it and checks
  `row.organizationId === ctx.organizationId` first, answering not-found otherwise. **Never take an
  organization ID as an argument.** Only the shared recipe permits every member to read/write.
  Member-private rows also check `row.ownerId === ctx.ownerId` on IDs and list through an
  `organizationId, ownerId` compound index. Owners/admins get no implicit private-data exception.
  User-owned rows instead use an owner-leading index with `authed*` and owner checks.
  Check `ctx.organizationRole` where only owners/admins should act on accessible shared data.
  Children/files inherit the complete parent policy. Sample project rows go through
  `requireProjectAccess(ctx, projectId)` from `./projectAccess` (part of the sample domain; keep it if you keep projects).
- **Validate everything.** `v` validators on every argument and field; string lengths with
  `assertMaxLength(value, MAX_NAME_LENGTH, "TITLE")`.
- **Errors are codes**, not text: `throw new Error("BOOKMARK_NOT_FOUND")`. Give each code a
  translated message with the `platform-add-strings` skill.
- **Queries by index.** Use `.withIndex(...)`, not `.filter(...)`, for anything that can grow.
- **Changing an existing table** that has data: adding a table, an optional field or an index is
  safe to deploy directly. Removing, renaming or narrowing needs widen, migrate, narrow
  (`platform/docs/convex-migrations.md`). Moving an existing per-user table to organizations is
  exactly that; follow "Upgrading existing data" in `platform/docs/organizations.md`.
- **Never edit `convex/_generated/`** by hand; regenerate it.

## Steps

1. **Schema.** Add the table at the end of `packages/backend/convex/schema.ts`, with indexes for
   every query you will run. State whether `ownerId` controls access or only creator attribution.
2. **Functions.** Create `packages/backend/convex/<table>.ts` with the queries and mutations.
   For an organization's table, also delete its rows in `packages/backend/convex/organizationData.ts`
   (a bounded batch per call; "Deleting an organization" in `platform/docs/organizations.md`), so
   deleting the organization removes them.
3. **Generate types.** `convex/_generated/` must list the new module, or `api.<table>` won't
   typecheck. With `bun run dev` running, Convex regenerates it on save. Without it, run once
   from the backend package:

   ```bash
   cd packages/backend && env -u CONVEX_AGENT_MODE bunx convex dev --once
   ```

   This starts a local backend for this checkout, pushes the functions, regenerates and exits.
   Commit everything it regenerates under `convex/_generated/` and
   `convex/platform/betterAuth/_generated/` and
   `platform/packages/convex-platform/src/component/_generated/`, even lines unrelated to your table: generated files are
   committed as generated, never trimmed by hand.
4. **Tests.** `packages/backend/convex/<table>.test.ts` with convex-test. Use the shared test
   factory so scheduled audit writes reach the component. Cover required fields, every page
   of the selected audience's list, and pure helpers. Exercise the functions with real Better
   Auth sessions (`convex/platform/organizations.test-helpers.ts` and
   `convex/organization-projects.test.ts`): cross-user IDs for personal data, cross-org IDs for
   org data, and same-org peers including owners/admins for private org data. Check switching,
   removal and zero memberships: personal functions work; org functions refuse. Raw index
   tests alone do not establish authorization.

   ```ts
   import { createTestEnv } from "./test.modules";
   import { describe, expect, test } from "vitest";

   const t = createTestEnv(); // root module glob + registered platform component
   ```

5. **Audit (optional).** If the action matters for security or support, record it with
   `scheduleAuditEvent` from `./platform/auditTrailHelpers`. Actions are a platform list
   (`@web-app-starter/convex-platform/constants`); if none fits, ask the platform maintainers for one
   (`platform/docs/audit-trail-architecture.md`).
6. **Check.**

   ```bash
   bun run test:convex
   bun run lint && bun run typecheck
   ```

7. **Use it** from an app with `useQuery(api.<table>.list)` and `useMutation(api.<table>.add)`
   (`import { api } from "@repo/backend"`). Handle `undefined` (loading) and `null` (signed out).
   Org-scoped results follow the active organization: when the user switches, subscribed queries
   rerun. Personal results follow the user. Reset org-specific drafts/pagination on switching.

## Worked example

This example deliberately chooses the **shared workspace** recipe. For individual, private
or mixed data, use the corresponding worked guide in `platform/docs/data-access/` instead.

**Task:** signed-in users of the web app can save bookmarks: a URL and a title. Everyone in an
organization shares its bookmarks: they can list them, newest first, and remove one. Nobody
outside the organization sees them.

`schema.ts`, at the end of the schema object:

```ts
  bookmarks: defineTable({
    url: v.string(),
    title: v.string(),
    organizationId: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_organization", ["organizationId"]),
```

`convex/bookmarks.ts`:

```ts
import { v } from "convex/values";

import { assertMaxLength, MAX_NAME_LENGTH, orgMutation, orgQuery } from "./platform/functions";

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

export const list = orgQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("bookmarks")
      .withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
      .order("desc")
      .collect();
  },
});

export const add = orgMutation({
  args: { url: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    assertMaxLength(args.url, MAX_URL_LENGTH, "URL");
    assertMaxLength(args.title, MAX_NAME_LENGTH, "TITLE");
    return ctx.db.insert("bookmarks", {
      url: normalizeBookmarkUrl(args.url),
      title: args.title.trim(),
      organizationId: ctx.organizationId,
      ownerId: ctx.ownerId,
      createdAt: Date.now(),
    });
  },
});

export const remove = orgMutation({
  args: { id: v.id("bookmarks") },
  handler: async (ctx, args) => {
    const bookmark = await ctx.db.get(args.id);
    if (!bookmark || bookmark.organizationId !== ctx.organizationId) throw new Error("BOOKMARK_NOT_FOUND");
    await ctx.db.delete(args.id);
  },
});
```

`convex/bookmarks.test.ts` inserts bookmarks for two organizations with `t.run`, asserts the
`by_organization` index returns only the first organization's, asserts an insert without `url` is rejected,
and tests `normalizeBookmarkUrl` (accepts `https://example.com`, rejects `javascript:alert(1)`
and `not a url` with `INVALID_URL`). Then regenerate types (step 3).

**Done when** `bun run test:convex`, `bun run lint` and `bun run typecheck` pass and
`convex/_generated/api.d.ts` lists `bookmarks`.
