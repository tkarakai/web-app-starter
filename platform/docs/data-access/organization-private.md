# Private data within an organization

Use this when the organization owns the records, but each member sees only their own:
private work notes, individual drafts or member-specific submissions. Access requires current
organization membership **and** record ownership. Start with the
[shared rules and setup](../data-access-models.md).

If the person should keep their data independently after leaving the organization, choose
[individual accounts](individual-accounts.md) instead. Shared payment alone is not a reason
to make data organization-owned.

## Schema

Add this entry to the app's `schema.ts`:

<!-- data-access-schema -->
```ts
privateNotes: defineTable({
  organizationId: v.string(),
  ownerId: v.string(),
  body: v.string(),
  createdAt: v.number(),
})
  .index("by_organization_owner", ["organizationId", "ownerId"])
  .index("by_organization", ["organizationId"]),
```

The compound index serves the private list. The org-only index is for organization cleanup,
not a public endpoint returning everybody's private notes.

## Functions

Create `packages/backend/convex/privateNotes.ts`:

<!-- data-access-file: privateNotes.ts -->
```ts
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  assertMaxLength, MAX_DESCRIPTION_LENGTH, orgMutation, orgQuery,
} from "./platform/functions";

type AccessCtx = Pick<QueryCtx, "db"> & { organizationId: string; ownerId: string };

export async function requirePrivateNote(
  ctx: AccessCtx, id: Id<"privateNotes">,
): Promise<Doc<"privateNotes">> {
  const note = await ctx.db.get(id);
  if (!note || note.organizationId !== ctx.organizationId || note.ownerId !== ctx.ownerId) {
    throw new Error("NOTE_NOT_FOUND");
  }
  return note;
}

export const list = orgQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: (ctx, args) => ctx.db.query("privateNotes")
    .withIndex("by_organization_owner", q => q
      .eq("organizationId", ctx.organizationId).eq("ownerId", ctx.ownerId))
    .order("desc").paginate(args.paginationOpts),
});

export const get = orgQuery({
  args: { id: v.id("privateNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id);
    return note?.organizationId === ctx.organizationId && note.ownerId === ctx.ownerId
      ? note : null;
  },
});

export const add = orgMutation({
  args: { body: v.string() },
  handler: (ctx, args) => {
    assertMaxLength(args.body, MAX_DESCRIPTION_LENGTH, "BODY");
    return ctx.db.insert("privateNotes", {
      body: args.body, organizationId: ctx.organizationId,
      ownerId: ctx.ownerId, createdAt: Date.now(),
    });
  },
});

export const update = orgMutation({
  args: { id: v.id("privateNotes"), body: v.string() },
  handler: async (ctx, args) => {
    await requirePrivateNote(ctx, args.id);
    assertMaxLength(args.body, MAX_DESCRIPTION_LENGTH, "BODY");
    await ctx.db.patch(args.id, { body: args.body });
  },
});

export const remove = orgMutation({
  args: { id: v.id("privateNotes") },
  handler: async (ctx, args) => {
    await requirePrivateNote(ctx, args.id);
    await ctx.db.delete(args.id);
  },
});
```

`requirePrivateNote` needs already authorized context from `org*` or `getOrgAuth`. Reuse it for
children/files; do not authorize them using the shared sample's project guard. No role check
grants an exception: an org owner/admin sees only their own private notes under this recipe.

## Organization membership and lifecycle

Use the normal [organization UI](../organizations.md#ui-building-blocks), with a private notes
page instead of a shared notes page. Explain to users that notes are private from colleagues,
but belong to the organization and become inaccessible after departure. Keep account settings
and invitations reachable with zero memberships.

Add a bounded `privateNotes.by_organization` deletion batch to the app's organization cleanup,
including notes whose owners left. Cleanup is privileged internal retention/deletion work;
it does not need to expose those records through an admin read endpoint. Org owners retain
the ability to delete the organization and all its data.

Removing a membership immediately blocks org access, but does not automatically delete or
transfer these app rows. Under this example, rejoining the same org with the same account
restores access to retained notes. If your business promise requires permanent removal,
reassignment or export on departure, implement that explicit app lifecycle before promising it.
Account deletion also needs a deliberate retention/erasure policy.

## Validate your adaptation

- Alice and Bob in the same org cannot list/get/update/remove each other's private notes.
- Repeat that denial with Bob as org admin and owner; management role does not bypass privacy.
- Every pagination page contains only the current org and canonical owner.
- Alice cannot access even her own note while another org is active.
- Removal blocks her access despite a stale session selection; no-membership writes fail.
- Rejoining restores only her retained notes under this example's stated policy.
- Children, files, counts, search and exports do not reveal another member's private data.
