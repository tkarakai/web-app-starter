# Individual accounts

Use this when people buy a service for themselves: personal notes, learning progress or a
budget. The data belongs to the person and follows them across organization changes.
Start with the [shared rules and setup](../data-access-models.md).

## Schema

Add this entry to the app's `schema.ts`:

<!-- data-access-schema -->
```ts
personalNotes: defineTable({
  ownerId: v.string(),
  body: v.string(),
  createdAt: v.number(),
}).index("by_owner", ["ownerId"]),
```

## Functions

Create `packages/backend/convex/personalNotes.ts`:

<!-- data-access-file: personalNotes.ts -->
```ts
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  assertMaxLength, authedMutation, authedQuery, MAX_DESCRIPTION_LENGTH,
} from "./platform/functions";

export const list = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: (ctx, args) => ctx.db.query("personalNotes")
    .withIndex("by_owner", q => q.eq("ownerId", ctx.ownerId))
    .order("desc").paginate(args.paginationOpts),
});

export const get = authedQuery({
  args: { id: v.id("personalNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id);
    return note?.ownerId === ctx.ownerId ? note : null;
  },
});

export const add = authedMutation({
  args: { body: v.string() },
  handler: async (ctx, args) => {
    assertMaxLength(args.body, MAX_DESCRIPTION_LENGTH, "BODY");
    return ctx.db.insert("personalNotes", {
      body: args.body, ownerId: ctx.ownerId, createdAt: Date.now(),
    });
  },
});

export const update = authedMutation({
  args: { id: v.id("personalNotes"), body: v.string() },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id);
    if (!note || note.ownerId !== ctx.ownerId) throw new Error("NOTE_NOT_FOUND");
    assertMaxLength(args.body, MAX_DESCRIPTION_LENGTH, "BODY");
    await ctx.db.patch(args.id, { body: args.body });
  },
});

export const remove = authedMutation({
  args: { id: v.id("personalNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id);
    if (!note || note.ownerId !== ctx.ownerId) throw new Error("NOTE_NOT_FOUND");
    await ctx.db.delete(args.id);
  },
});
```

The owner is stamped by the server. Even if Alice and Bob join the same organization, Bob
cannot read or change Alice's notes. Invitations, administrator status within an organization
and organization deletion do not change this rule.

## Customer experience and limits

Build the dashboard around personal data, without requiring `useOrganizations()` to report an
active org before rendering it. Keep the platform protected layout and account security UI;
omit organization management from your app navigation if it is irrelevant. Do not gate this
personal page behind the sample's `NoOrganization` workspace state.

This produces an individual-service experience with the current primitives. **It does not
disable the organization backend.** Signup still creates a personal organization, and its
organization routes remain enabled. The current `features.invitations` setting concerns user
onboarding invitations, not a switch disabling Better Auth organization invitations. There is
no supported configuration option that disables all organization provisioning/operations.
If that is a hard product requirement, request a platform extension rather than editing its
auth hooks. The personal-data rule remains safe even if someone calls organization routes.

Keep personal rows out of `organizationData.ts`. Define account deletion/retention cleanup for
them separately; deleting a Better Auth user does not automatically delete your app tables.
An employer paying for this service does not acquire note access. Billing/sponsorship would
be separate app functionality, not implemented by this example.

## Validate your adaptation

- Alice can list/get/update/remove hers; Bob cannot do so even as an org owner or admin.
- Lists, including every pagination page, contain only the caller's records.
- A signed-in account with zero memberships can still use these functions.
- Switching, joining or leaving organizations does not move or reveal personal notes.
- A migrated account whose canonical `ownerId` differs from Better Auth's user ID keeps access.
- Anonymous or limited sessions cannot read or write; forged ownership arguments are rejected.
- Any attached files and exports repeat the same user-ownership rule.
