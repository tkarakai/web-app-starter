# Shared organization workspace

Use this when members collaborate on the same objects. The organization owns the records;
`ownerId` records who created them, not who may access them. This matches the reference app's
projects. Start with the [shared rules and setup](../data-access-models.md).

## Schema

Add this entry to the app's `schema.ts`:

<!-- data-access-schema -->
```ts
teamNotes: defineTable({
  organizationId: v.string(),
  ownerId: v.string(),
  body: v.string(),
  createdAt: v.number(),
}).index("by_organization", ["organizationId"]),
```

## Functions

Create `packages/backend/convex/teamNotes.ts`:

<!-- data-access-file: teamNotes.ts -->
```ts
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  assertMaxLength, MAX_DESCRIPTION_LENGTH, orgMutation, orgPaginatedQuery, orgQuery,
} from "./platform/functions";

type AccessCtx = Pick<QueryCtx, "db"> & { organizationId: string };

export async function requireTeamNote(
  ctx: AccessCtx, id: Id<"teamNotes">,
): Promise<Doc<"teamNotes">> {
  const note = await ctx.db.get(id);
  if (!note || note.organizationId !== ctx.organizationId) throw new Error("NOTE_NOT_FOUND");
  return note;
}

export const list = orgPaginatedQuery({
  args: {},
  handler: (ctx, args) => ctx.db.query("teamNotes")
    .withIndex("by_organization", q => q.eq("organizationId", ctx.organizationId))
    .order("desc").paginate(args.paginationOpts),
});

export const get = orgQuery({
  args: { id: v.id("teamNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id);
    return note?.organizationId === ctx.organizationId ? note : null;
  },
});

export const add = orgMutation({
  args: { body: v.string() },
  handler: (ctx, args) => {
    assertMaxLength(args.body, MAX_DESCRIPTION_LENGTH, "BODY");
    return ctx.db.insert("teamNotes", {
      body: args.body, organizationId: ctx.organizationId,
      ownerId: ctx.ownerId, createdAt: Date.now(),
    });
  },
});

export const update = orgMutation({
  args: { id: v.id("teamNotes"), body: v.string() },
  handler: async (ctx, args) => {
    await requireTeamNote(ctx, args.id);
    assertMaxLength(args.body, MAX_DESCRIPTION_LENGTH, "BODY");
    await ctx.db.patch(args.id, { body: args.body });
  },
});

export const remove = orgMutation({
  args: { id: v.id("teamNotes") },
  handler: async (ctx, args) => {
    await requireTeamNote(ctx, args.id);
    await ctx.db.delete(args.id);
  },
});
```

`requireTeamNote` is an app helper, not an authenticated endpoint. Only call it with context
already authorized by `org*` or `getOrgAuth`. Your child/file functions can reuse it after
resolving that context. Do not replace the organization check with creator ownership.

## UI, roles and cleanup

Mount the [organization UI](../organizations.md#ui-building-blocks). Members select the active
workspace; these functions accept no organization argument. Without a membership, the paginated
`list` returns an empty finished page (`page: []`, `isDone: true`, `continueCursor: ""`),
and `get` returns `null`. Show the workspace empty state while preserving account controls/invitations.
Call `add` with `expectedOrganizationId` set to the active organization the form was opened
for; on `ORGANIZATION_CHANGED` keep the draft and let the user check where it goes.

Every member can read and edit these notes. If, for example, only owners/admins may delete,
add an explicit `ctx.organizationRole` check **after** the row's organization check in `remove`.
That is a rule using the three existing roles, not support for custom roles.

Add a bounded `teamNotes.by_organization` deletion batch to your existing
`organizationData.ts` handler. Do not delete a departed creator's shared notes merely because
their `ownerId` is no longer a member. Account deletion and organization deletion are different
events; decide whether to retain or redact creator attribution.

## Validate your adaptation

- Alice and Bob in the same active org can read/edit/delete each other's notes.
- A member of another org cannot list/get/change them, including by guessed IDs.
- Switching orgs changes the list and blocks direct IDs from the previous workspace.
- Removal revokes access on the next request, including a stale active-org selection.
- An `add` composed for an org the caller has since left or switched away from is refused
  (`ORGANIZATION_CHANGED`) and writes nothing anywhere.
- With no memberships, `list` returns an empty finished page, `get` returns `null`, writes
  refuse `NO_ORGANIZATION`, and no org is created.
- Org cleanup removes its notes and preserves personal data and other orgs' notes.
