---
name: platform-add-table
description: Use to add a new Convex table for app data - schema entry, indexes, authenticated queries and mutations with ownership checks, generated types and backend tests. Also covers adding fields to an app table.
---

# Add an app table

The backend is one Convex project in `packages/backend/convex/`. Platform functions live in
`convex/platform/` (platform zone: never edit) and are called as `api.platform.<module>`; your
modules live at the `convex/` root and are called as `api.<module>`. `schema.ts` is a **seam**:
it spreads the platform's tables (`...platformTables`, the platform hook) and the sample domain's
(`...sampleTables` from `sampleTables.ts`), then lists yours. Background:
`platform/docs/code-style.md` (Convex section), `platform/docs/testing.md` (convex-test) and
`platform/docs/convex-migrations.md`.

## Rules

- **Add, don't edit.** Add your table at the end of the schema object in `schema.ts`, after the
  spreads. Keep the `...platformTables` spread, and never reuse a platform table name (see
  `convex/platform/tables.ts`; Better Auth's component tables are separate).
- **One module per table**, named in camelCase after it: `convex/bookmarks.ts`. Never put app
  modules in `convex/platform/`.
- **Authenticated by default.** Use `authedQuery` and `authedMutation` from `./platform/functions`:
  handlers get `ctx.ownerId`; `authedQuery` returns `null` when signed out (safe for `useQuery`),
  `authedMutation` throws `NOT_AUTHENTICATED` and applies the global mutation rate limit.
  Both enforce live session assurance and current verification/MFA/passkey/enrollment policy.
  For **organization-owned app data**, use `tenantQuery` / `tenantMutation` from
  `./platform/tenantFunctions` instead. They add a required explicit `organizationId` argument,
  resolve live customer/membership/lifecycle authority, and reject unavailable contexts rather than
  returning signed-out `null`. Persist and check organization **and** owner; see
  [organization context](../../docs/organization-context.md) for the tenant-table pattern and
  legacy-private bridge limits. Capture the ID before async work; never fall back to a session preference.
  Use `appOperatorQuery` / `appOperatorMutation` only for **canonical app-operator** controls; organization
  administrators do not qualify. Operator writes additionally require recent authentication. Do not substitute `auth.getCurrentUser`, raw Better Auth user lookup or account MFA flags
  for authorization; those can represent a limited enrollment/recovery session. See
  [session assurance](../../docs/authentication-and-onboarding.md#85-session-assurance-and-reauthentication).
  Use plain `query`/`mutation` only for data that is deliberately public.
- **Own your rows.** For tenant data store `organizationId: v.string()` and `ownerId: v.string()`
  and index both (`by_organization_owner`). Identity-private rows use the owner index (`by_owner`). Every read filters by
  `ctx.ownerId` and, for tenant rows, `ctx.organizationId` through the index. Existing-row writes
  check both fields before changing data. Tenant children must also match their parent's organization
  and owner; the scoped sample uses `requireTenantProject` from `./tenantAccess`.
  `requireProjectAccess` from `./projectAccess` is only the sample's legacy-private bridge, not a
  replacement for explicit tenant authorization.
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
   cd packages/backend && env -u CONVEX_AGENT_MODE bunx convex dev --once
   ```

   This starts a local backend for this checkout, pushes the functions, regenerates and exits.
   Commit everything it regenerates under `convex/_generated/` and
   `convex/platform/betterAuth/_generated/` and
   `platform/packages/convex-platform/src/component/_generated/`, even lines unrelated to your table: generated files are
   committed as generated, never trimmed by hand.
4. **Tests.** `packages/backend/convex/<table>.test.ts` with convex-test. Use the shared test factory so scheduled audit writes reach the component, and cover: required fields are enforced, the owner index returns only
   that owner's rows, and each pure helper your module exports.

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

7. **Use it** with `{ organizationId: capturedOrganizationId }` for tenant APIs; skip queries until
   a live context is available. Identity-private APIs can use `useQuery(api.<table>.list)` and `useMutation(api.<table>.add)`
   (`import { api } from "@repo/backend"`). Handle `undefined` (loading) and `null` (signed out).

## Worked example

This example illustrates identity-private ownership, **not** tenant isolation. For organization-owned
bookmarks, use the explicit-context schema/builders/example in
[organization context](../../docs/organization-context.md); do not deploy an owner-only domain table
as a multi-tenant table.

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

import { assertMaxLength, authedMutation, authedQuery, MAX_NAME_LENGTH } from "./platform/functions";

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
