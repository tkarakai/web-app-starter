# Choose a data access model

Choose ownership and audience per table. An app can use several models at once; organization
membership does not have to mean access to every record. The reference app chooses shared
organization data, but its policy is not a requirement for your business tables.

| Your service | Guide | Builder and row check |
| --- | --- | --- |
| Individuals use their own data | [Individual accounts](data-access/individual-accounts.md) | `authed*`; `row.ownerId === ctx.ownerId` |
| Members collaborate on the same objects | [Shared workspace](data-access/shared-workspace.md) | `org*`; `row.organizationId === ctx.organizationId` |
| Each member has private data inside an organization | [Organization-private data](data-access/organization-private.md) | `org*`; both organization and owner match |
| Private drafts and shared work coexist | [Private and shared data](data-access/private-and-shared.md) | Compose the private and shared rules; publish explicitly |

All examples use existing platform primitives and app-owned files under
`packages/backend/convex/`. Use `platform-add-table` to apply a recipe. Preserve the
`...platformTables` schema hook. The guides' table snippets are additions inside `defineSchema`;
import `defineTable` from `convex/server` and `v` from `convex/values` in `schema.ts`.
Do not edit platform files to apply a model.

## What the builders enforce

`authedQuery`/`authedMutation` enforce live session assurance and provide `ctx.user` and
`ctx.ownerId`. `orgQuery`/`orgMutation` also resolve the active organization and recheck current
membership, providing `ctx.organizationId` and `ctx.organizationRole`. They **do not filter
database reads or authorize individual rows for you**. The app's functions do that.

Unauthenticated or limited sessions get `null` from queries and refusal from mutations. With
no organization membership, org queries return `null` and org mutations throw `NO_ORGANIZATION`;
personal functions continue to work. A stale organization selection falls back to another
current membership, if one exists. See [organizations](organizations.md) for membership and UI.

Use `ctx.ownerId` consistently for app ownership. It can differ from `ctx.user._id` on migrated
accounts; Better Auth membership IDs and app owner IDs are not interchangeable. Do not use
email, names or the browser's user ID as ownership authority. New rows take owner and scope
from server context, never arguments. `ownerId` is access ownership in the personal/private
recipes and creator attribution in the shared recipe.

## Carry the rule through every access path

- List through the recipe's ownership index and paginate on the server. Direct-ID reads and
  every update/delete repeat the same rule. Return not-found for inaccessible IDs.
- A child inherits its parent's complete rule. Authorize the parent before listing, counting,
  creating, editing or deleting children; never trust a supplied parent/storage ID alone.
- File upload, finalization, listing, download and deletion must use that same parent guard.
  The sample's `requireProjectAccess` checks only organization equality: it does not make a
  new private table's files private. Follow [private file storage](private-file-storage.md)
  for trusted upload provenance and byte delivery; adapt your app-owned guards too.
- Counts, search, exports, notifications and subscriptions must use the same audience. Do not
  expose private titles, pre-filter totals or bearer file URLs through an alternate endpoint.
- Actions must recheck through an internal query/mutation using `getAuth` or `getOrgAuth` before
  reading or committing data, including after an external upload. Do not replace the check with
  a raw user lookup. Org builders are not exposed as agent capabilities.
- These builders are for authenticated requests, not a tenant-aware job or API-key framework.
  Scheduled work needs an explicit app-owned scope and execution policy; do not infer it later
  from someone's active UI organization.

The examples give all permitted readers edit/delete rights, except publication, which requires
the private record's owner. Add action checks using the existing `ctx.organizationRole` if your
app needs them. `owner` and `admin` do not bypass a private-record owner check. Custom roles
and configurable RBAC are not included by these recipes.

## UI and lifecycle

Use app-owned pages under the protected dashboard layout. Handle query `undefined` as loading,
`null` as unavailable/signed out or lacking organization context, and a paginated result with
`page: []` as an accessible empty list. Translate labels and error codes in app messages.

For org data, mount the organization controls described in [organizations](organizations.md).
Reset or partition drafts, selections and query pagination on organization changes; keep account
controls and invitations available without a membership. A create mutation uses the active org
at execution time. Session selection is shared across tabs: it does not pin a draft to the org
where editing began. Avoid automatic delayed/offline submission of org creates across switches;
a strict cross-tab write-intent guarantee needs an additional application design.

User-owned data follows the person and must not be deleted by organization cleanup. Org-owned
data belongs in `convex/organizationData.ts`, including rows whose creator has left. Decide user
deletion, retention/export and custody policies explicitly. Private here describes application
access control, not encryption from the service operator. Org owners can delete the organization
and its private data even when they cannot read those private records.

## Apply and verify

1. Copy only the selected recipe's schema entries and app modules. The mixed guide composes
   the organization-private and shared modules. Keep or remove the sample separately.
2. Regenerate types with the normal local backend (`bun run dev`, or from `packages/backend`,
   `env -u CONVEX_AGENT_MODE bunx convex dev --once`). Do not edit generated files manually.
3. Add your org-owned rows to the existing cleanup handler. Keep its other table cleanup intact;
   use bounded batches and report done only when all covered rows and files are gone.
4. Add [backend tests](testing.md#convex-backend-test-pattern) with real Better Auth sessions.
   Exercise two users in the same org, a user in another org, anonymous/limited sessions,
   organization switching and membership removal. Each guide lists its expected outcomes.
5. Run `bun run test:convex`, `bun run lint` and `bun run typecheck`. For UI changes, also test
   real navigation, switching, empty states and file access using the app's normal E2E command.

For an existing table, preserve its current privacy during the transition. Adding a table is
straightforward; moving existing data or narrowing fields follows
[widen, migrate, narrow](convex-migrations.md). Joining an org never authorizes sharing old
personal data. The organizations backfill helper deliberately assigns legacy records to a
private organization; do not replace that with the current active org. Only change audience
through a reviewed, explicit operation.
