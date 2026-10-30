# Organizations

Every user works inside an **organization**, and the app's data belongs to organizations, not
to individual users. Everyone in an organization shares its data. It is built on Better Auth's
[organization plugin](https://www.better-auth.com/docs/plugins/organization), configured in
`packages/backend/convex/platform/organizationPlugin.ts`.

## What users get

- **A personal organization at sign-up**, named after them (they can rename it). Someone who never
  invites anyone never has to think about organizations.
- **Invitations by email.** Owners and admins invite an address with a role. The email links to
  `/accept-invitation/<id>`. An existing user also sees the invitation as a banner on the
  dashboard. A new user creates an account from the link, even when public sign-up is closed
  (waitlist or invite-only). Invitations expire after 7 days; inviting the same address again
  replaces the pending invitation.
- **Several organizations per user.** Users can create organizations and accept invitations to
  others. The sidebar header shows the active organization. It becomes a switcher for anyone in
  more than one. A new sign-in starts in the organization the user last switched to.
- **Settings → Organization**: rename, members and roles, invite, resend or cancel pending
  invitations, leave, create another organization.

### Roles

Better Auth's three built-in roles, used as they are:

| Role | Can |
|---|---|
| `owner` | Everything an admin can, plus make others owners, and change or remove owners |
| `admin` | Invite and remove members and admins, change their roles, rename the organization |
| `member` | Use the organization's data |

An organization always keeps at least one owner. Better Auth refuses to remove, demote or let
the last owner leave. When an account is deleted, an organization it owned alone passes to its
longest-standing admin (or member). Users can't leave their only organization.

All three roles read and write the same app data. If your app needs finer rules (for example,
only admins delete projects), check `ctx.organizationRole` in your functions.

## How it works

- **Active organization.** Better Auth stores it on the session (`session.activeOrganizationId`).
  On every request, the backend checks that the user is still a member of it, and otherwise falls
  back to their oldest membership. Removing someone takes effect on their next request.
- **Reads are Convex queries** over Better Auth's tables, so the UI updates live:
  `api.platform.organizations.mine` (memberships and active), `.active` (settings view),
  `.myInvitations`, `.invitation`.
- **Writes go through Better Auth** (`authClient.organization.*`), which checks the roles. The
  session-assurance plugin admits only these routes: `create`, `update`, `set-active`,
  `invite-member`, `cancel-invitation`, `accept-invitation`, `reject-invitation`,
  `remove-member`, `update-member-role` and `leave`. Each needs a fully assured session (email
  verification, MFA and passkey policy met). Platform administrators can't use them, just as
  they can't use the web app.
- **Accepting needs the invited address, verified.** Better Auth matches the signed-in user's
  email to the invitation and requires `emailVerified` (`requireEmailVerificationOnInvitation`).
  This stops someone who registered an address they don't own from joining with it.
- **Limits:** 10 invitations at once and 30 an hour per inviter, plus the platform's auth email
  budgets. Up to 100 members per organization and 50 organizations per user.
- **Audited:** creating, renaming, invitation sent, canceled, accepted or rejected, member
  removed, member left and role changed (`organization.*` audit actions).
- **Not included:** deleting an organization (app data would need a cascade), teams, custom
  roles, billing, organization management in the admin app, and organization-scoped agent
  capabilities.

## Scoping your data

Use the organization builders from `./platform/functions` for every table of app data:

- `orgQuery` gives the handler `ctx.organizationId` and `ctx.organizationRole` (as well as
  `ctx.user` and `ctx.ownerId`). It returns `null` when signed out or without an organization.
- `orgMutation` adds the same to `authedMutation`. A user with no organization gets a personal
  one first.
- `getOrgAuth(ctx)` resolves the same thing inside an internal function called from an action.

The rules:

1. Give the table `organizationId: v.string()` and an index `by_organization`.
2. Stamp `organizationId: ctx.organizationId` on insert. Keep `ownerId: ctx.ownerId` if you
   want to show who created a row.
3. Read through the index: `.withIndex("by_organization", q => q.eq("organizationId", ctx.organizationId))`.
4. Before changing or returning a row by ID, check `row.organizationId === ctx.organizationId`.
   Answer `null` or a not-found error, never "forbidden".
5. **Never take an organization ID as an argument.** The active organization comes from the
   session only.
6. A child table can inherit its parent's organization instead, as the sample does: tasks and
   uploads have no `organizationId`, and every access goes through
   `requireProjectAccess(ctx, projectId)`.

Use `authedQuery`/`authedMutation` (user-scoped, `ctx.ownerId`) only for data that is
deliberately personal and follows the user across organizations, such as preferences.
`orgQuery` and `orgMutation` are not exposed to agent surfaces.

The `platform-add-table` skill does all of this.

## UI building blocks

From `@web-app-starter/auth-ui`:

| Export | Use |
|---|---|
| `OrganizationSwitcher` | Sidebar header: product mark and name, active organization; switcher for multi-organization users. `onSwitch` lets you clear state that belongs to the old organization |
| `OrganizationSection` | The Settings → Organization tab |
| `OrganizationInvitations` | Pending-invitation banner for the dashboard |
| `CreateOrganizationDialog` | The create dialog, if you want it elsewhere |
| `useOrganizations()` | The caller's organizations and the active one |
| `AcceptInvitationView` (`/views`) | The `/accept-invitation/[id]` page; re-export it from the route |

`ProtectedLayout` also includes `EnsureOrganization`, which gives a signed-in user without an
organization a personal one. The sign-up view shows the account form for `?invitation=` links
whatever the onboarding mode. The backend admits that sign-up only for an address with a
pending invitation.

## Adopting organizations in an existing app

The platform side arrives with the upgrade. New accounts get a personal organization; your
existing functions, which use `authedQuery`/`authedMutation`, keep working per user. To adopt:

1. Mount the UI. Put `OrganizationSwitcher` in your sidebar header, `OrganizationSection` on a
   settings page (the reference app uses `/dashboard/settings?tab=organization`) and
   `OrganizationInvitations` at the top of your dashboard. Add the route
   `src/app/[locale]/(invitation)/accept-invitation/[id]/page.tsx` re-exporting
   `AcceptInvitationView`, as `apps/web` does.
2. Scope your tables as above, and migrate their existing rows as below.
3. Translate any app strings you add (`platform-add-strings`). The platform's own strings ship
   in every platform locale.

## Upgrading existing data

Releases before organizations stored app data per user (`ownerId`). Existing users get a
personal organization on their next visit, or when a migration needs one. Their data must move
into it, so that they keep it and nobody else sees it. Convex refuses to deploy a schema that
existing rows violate, so this takes two releases
([widen, migrate, narrow](convex-migrations.md)):

1. **Widen and migrate.** Add `organizationId: v.optional(v.string())` and the
   `by_organization` index. Switch the functions to `orgQuery`/`orgMutation` and the access
   checks to the organization. Add a migration to `convex/migrations.ts`:

   ```ts
   import { personalOrganizationForOwner } from "./platform/organizationAccess";

   export const bookmarksToOrganizations = migration({
     table: "bookmarks",
     migrateOne: async (ctx, row) => {
       if (row.organizationId) return;
       const organizationId = await personalOrganizationForOwner(ctx, row.ownerId);
       if (organizationId) return { organizationId };
     },
   });
   ```

   `personalOrganizationForOwner` picks an organization the owner *owns*, never one they were
   only invited to, so private data can't land in someone else's organization. It returns
   `null` when the owner's account no longer exists. Those rows stay unassigned and unreachable,
   as they were. Deploys run `convex run migrations` automatically. Until a row is migrated, it
   matches no organization: it is hidden, never exposed.
2. **Narrow**, in a later release once every deployment has migrated: make `organizationId`
   required. Delete or reassign any rows the migration left unassigned first. Convex rejects the
   deploy while any remain.

The sample's `projects` table follows exactly this path. Its migration is
`projectsToOrganizations`, and the release after the one that introduced organizations narrows
it.
