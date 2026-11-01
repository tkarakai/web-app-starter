# Private and shared data in one organization

Use this when people need private drafts alongside a shared workspace. The simplest model is
two tables with different policies, using the same organization membership. Start with the
[shared rules and setup](../data-access-models.md), then copy both
[organization-private](organization-private.md) (`privateNotes`) and
[shared workspace](shared-workspace.md) (`teamNotes`) schemas/modules.

## Compose the existing recipes

Present a **My drafts** area using `api.privateNotes.list` and a **Team notes** area using
`api.teamNotes.list`. Keep independent pagination state for each query; both lists use the
active organization. Do not fetch all private records and hide other people's drafts in the
browser. Do not concatenate independently paginated lists and pretend they have one global
sort/cursor. Two lists avoid that extra query/index design.

Private records stay private when someone joins the organization, gets promoted or edits a
shared note. Their audience changes only through an explicit publishing operation.

## Publish a shared copy

The following action creates a new shared note from the caller's private draft in the active
org, leaving the private original in place. Show a confirmation explaining that all current
and future members will be able to read, edit and delete the shared copy. Repeating publication
creates another copy; this example does not deduplicate retries or keep the copies synchronized.
Add an app-owned idempotency design if your flow needs automatic retries.

Create `packages/backend/convex/notePublishing.ts`:

<!-- data-access-file: notePublishing.ts -->
```ts
import { v } from "convex/values";
import { orgMutation } from "./platform/functions";
import { requirePrivateNote } from "./privateNotes";

export const publish = orgMutation({
  args: { id: v.id("privateNotes") },
  handler: async (ctx, args) => {
    const draft = await requirePrivateNote(ctx, args.id);
    return ctx.db.insert("teamNotes", {
      body: draft.body, organizationId: ctx.organizationId,
      ownerId: ctx.ownerId, createdAt: Date.now(),
    });
  },
});
```

The mutation checks ownership and org membership, then reads and copies in one transaction.
It does not accept a target organization, owner or unchecked body. Someone else's draft cannot
be published by guessing its ID. An org admin has no exception. The shared copy contains no
back-reference or metadata exposing the private draft. Deleting a shared copy cannot recall
content that a member already downloaded or copied.

Files require a separate explicit publication policy: the example copies only text. Do not
copy a private storage ID into a shared row. Preserve upload provenance, authorize source and
destination, and implement safe reference/deletion semantics or create a separately owned
object. See [private files](../private-file-storage.md).

## Cleanup and evolution

In `organizationData.ts`, remove bounded batches from **both** org-owned tables, then return
done only when both and any associated children/files are gone. Preserve unrelated user-owned
`personalNotes` if you also use the individual model. Keep existing cleanup for other app tables.

For an app whose only org-owned tables are these two text-note tables, the complete handler is
below. In an existing app, merge these batches into its handler rather than replacing other
cleanup. The individual guide's `personalNotes` is deliberately absent.

<!-- data-access-file: organizationData.ts -->
```ts
import { organizationDataCleanup } from "./platform/functions";

export const deleteOrganizationData = organizationDataCleanup(async (ctx, organizationId) => {
  const privateRows = await ctx.db.query("privateNotes")
    .withIndex("by_organization", q => q.eq("organizationId", organizationId)).take(100);
  const sharedRows = await ctx.db.query("teamNotes")
    .withIndex("by_organization", q => q.eq("organizationId", organizationId)).take(100);
  for (const row of [...privateRows, ...sharedRows]) await ctx.db.delete(row._id);
  return privateRows.length === 0 && sharedRows.length === 0;
});
```

You can instead use a single table with `visibility: private | organization` when you need the
same record/ID to change audience. That requires an owner-only visibility mutation, private
defaults, safe existing-data migration and indexed queries for both audiences. These examples
deliberately use two tables; they do not provide a single-table audience/grant engine or a
combined paginated feed.

## Validate your adaptation

- Alice's draft is absent from Bob's list and direct-ID reads before publication.
- Bob, including as org admin/owner, cannot publish or edit Alice's private draft.
- After Alice publishes, Bob can access/edit the shared copy, while the private original remains
  inaccessible and unchanged. Another organization cannot access either.
- Changing orgs before publication makes the old draft ID not-found; removal revokes publishing.
- Publishing fails without creating a shared row if source ownership or membership fails.
- Shared edits do not update the private draft; future members see published copies only.
- Organization cleanup covers both tables and preserves user-owned/other-org rows.
