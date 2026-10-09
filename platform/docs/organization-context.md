# Organization context and private app data

Organization membership is customer authority, not platform-operator authority. A customer's
Better Auth global role remains `user`; organization membership supplies `org-admin` or `member`.
Do not grant the global `admin` role to represent an organization administrator.

## Resolve, then capture an explicit context

- `api.platform.tenantContext.mine({})` returns the caller's canonical memberships, organization
  metadata/lifecycle, role and `personalOrganizationId`. It does not provision or guess an organization.
  `mappingRequired` means no canonical context is available; it is not permission to invent a mapping.
- `api.platform.tenantContext.get({ organizationId })` resolves that exact immutable ID against
  the current customer, membership, session assurance and active organization lifecycle.
- The personal experience may hide an organization picker. Resolve its canonical personal ID,
  then supply that ID with every tenant operation. A slug or conversation ID is not tenant authority.
- Capture the selected ID before starting async work. Another tab's `activeOrganizationId` preference
  must never redirect a queued request, upload, download or retry. The server does not use that
  preference as an authorization fallback.
- Missing/empty IDs, removed memberships, disabled organizations, operator identities and auth-only
  sessions fail closed. Re-enabling an organization does not recreate accounts or change row ownership.

These APIs return no join capabilities, credentials, recovery material or other members' directory.
They are not collaboration activation or member-management APIs. Setup/admission contracts are in
[architecture](architecture.md#parent-enrollment-setup-api) and
[authentication and onboarding](authentication-and-onboarding.md).

## App-owned tenant tables

Use `tenantQuery` / `tenantMutation` from `./platform/tenantFunctions` for organization-owned data.
The builders add a **required** `organizationId: v.string()` argument and give handlers
`ctx.organizationId`, `ctx.organization`, `ctx.user` and `ctx.ownerId`. Do not redefine that argument.
They enforce live customer/session/membership/lifecycle authorization; mutations also rate-limit.
Unlike `authedQuery`, a tenant query throws on an unavailable context rather than returning signed-out
`null`. Skip reactive queries until a signed-in, available context has been resolved; handle removal
and suspension as unavailable state, not an invitation to try another ID silently.

For the starter's private-resource policy, persist both organization and owner and check **both**:

```ts
// schema.ts — a new app table
bookmarks: defineTable({
  organizationId: v.string(),
  ownerId: v.string(),
  title: v.string(),
  createdAt: v.number(),
}).index("by_organization_owner", ["organizationId", "ownerId"]),
```

```ts
// convex/bookmarks.ts — app zone
import { v } from "convex/values";
import { tenantMutation, tenantQuery } from "./platform/tenantFunctions";

export const list = tenantQuery({
  args: {},
  handler: ctx => ctx.db.query("bookmarks")
    .withIndex("by_organization_owner", q => q
      .eq("organizationId", ctx.organizationId).eq("ownerId", ctx.ownerId))
    .collect(),
});

export const remove = tenantMutation({
  args: { id: v.id("bookmarks") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.organizationId !== ctx.organizationId || row.ownerId !== ctx.ownerId) {
      throw new Error("BOOKMARK_NOT_FOUND");
    }
    await ctx.db.delete(id);
  },
});
```

For example, invoke `api.bookmarks.list` with `{ organizationId: capturedOrganizationId }`.
An org-admin role does not grant access to another member's private rows. Shared-resource semantics
need a separately designed policy; do not remove owner checks accidentally. A role or the context's
management-state hint alone does not authorize member/security administration.

Every child operation must verify the parent's organization **and** owner, as well as the child's
provenance. Never resolve a child solely by its row ID or owner. Storage transfers must authorize
before work and reauthorize before attachment/disclosure; do not expose permanent blob URLs or
accept arbitrary client-supplied storage IDs as ownership proof.

## Sample APIs and the legacy bridge

The sample exposes `api.tenantProjects`, `api.tenantTasks` and `api.tenantFiles` with required explicit
organization context. These are private-owner APIs, not collaborative sharing or operator tools.
File lists omit storage IDs; transfers return bytes only after authorization. Conflicting parent,
owner or blob aliases are quarantined rather than silently claimed.

The existing `api.projects`, `api.tasks` and `api.files` are a transitional **legacy-private** bridge:

- Unmarked historical identities can retain their own unscoped private data without an invented org.
- A sole active personal context can retain that private bridge; multiple/collaborative contexts
  require explicit APIs. Operators cannot use the bridge to read customer app data.
- Pending customer provisioning/member acceptance cannot bypass admission by writing legacy rows.
- The bridge rejects organization-tagged rows. Strict tenant APIs reject untagged rows; an owner
  match never supplies a missing organization ID.

Optional organization fields/indexes are only the widening step for existing sample tables. They do
not migrate historical records or convert the existing app UI. Preserve identities, credentials,
rows and bytes; explicitly classify mappings and apply
[widen–migrate–narrow](convex-migrations.md) with an old-writer barrier before cutover. Do not reset data,
backfill by guesswork or activate collaboration while preserving migration/security gates are open.

## Operator and agent boundaries

`adminQuery` / `adminMutation` in `./platform/functions` mean **canonical platform operator**, not
organization administrator. They reject mixed customer/operator identities; writes need recent
current authentication. Generic Better Auth `/admin/*` APIs are denied; the admin app uses guarded
operator-target APIs instead. Identity deletion and global role conversion are unavailable until
reviewed ownership mappings can preserve dependent state.

`api.platform.organizations.list/get/setLifecycle` expose operator control metadata and org-admin
contacts only. They do not expose ordinary member directories, factors, sessions or private resources.
Operator audit reads project reviewed new operator events; private/unclassified history is retained
but hidden. Reserved email addresses alone do not establish operator identity.

Tenant builders are deliberately not native capabilities. Existing MCP/CLI/A2A/WebMCP tools remain
operator-only; do not register tenant tables, member ceremonies or component primitives in that
catalogue. Unknown captured operations fail closed. See
[agentic integration](agentic-announcements.md) for the executable exposure inventory and authority
cutover contract.
