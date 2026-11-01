# Organizations

The app's data belongs to **organizations**, and everyone in an organization shares its data.
Accounts can stay signed in without any organization memberships. It is built on Better Auth's
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
- **Several organizations per user.** The sidebar header shows the active organization and opens
  a menu to switch between the user's organizations or create one. A new sign-in starts in the
  organization the user last switched to.
- **An organization page** (the account menu's **Organization** entry, `/dashboard/organization`
  in the reference app): rename; members and roles; invite; the invitations sent, each pending,
  expired or declined, with resend or invite again, and delete (with confirmation); leave (from your own row); and for
  owners a **danger zone** to delete the organization.
- **Notice of lost access.** When someone is removed, or an owner deletes the organization, the
  member's view drops it live and says "You no longer have access to …".
- **Closeable account pages.** Settings and Organization have a header Close control. Opening
  either records the original app location; moving between account pages keeps that location.
  Closing returns there, including after a reload. A direct link with no app origin returns to
  app home. In the sample, the selected project and its tab are part of the URL and restored
  only if that project still belongs to the active organization.
- **No organization is a supported account state.** After losing or deleting the last
  organization, the account stays signed in. The selector shows **No organization** and its
  menu contains only **Create organization**. The empty app header has no organization
  breadcrumb. Empty-state guidance mentions accepting an invitation only when one is pending.
  Organization navigation and app workspace controls disappear; Profile, Security, Theme,
  Sign out and pending invitations remain.
  Creating an organization or accepting an invitation restores the workspace. Reloading,
  signing in again and ordinary backend operations never create a replacement organization.

### Roles

Better Auth's three built-in roles, used as they are:

| Role | Can |
|---|---|
| `owner` | Everything an admin can, plus make others owners, and change or remove owners |
| `admin` | Invite and remove members and admins, change their roles, rename the organization |
| `member` | Use the organization's data |

An organization always keeps at least one owner. Better Auth refuses to remove, demote or let
the last owner leave. The page explains that they must invite another owner and wait for the
invitation to be accepted before leaving; a pending invitation does not count as an owner.
Someone who is not the last owner may leave even their only organization. When an account is
deleted, an organization it owned alone passes to its longest-standing admin (or member).
Only owners can delete an organization; deleting one never deletes its members' accounts.

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
  `invite-member`, `accept-invitation`, `reject-invitation`,
  `remove-member`, `update-member-role`, `leave` and `delete`; `delete` also needs recent
  authentication, which the page asks for first. Roles must be exactly one of `owner`, `admin` or `member`;
  Better Auth's comma-separated role lists are refused. `update` may change only the name. Each needs a fully assured session (email
  verification, MFA and passkey policy met). Platform administrators can't use them, just as
  they can't use the web app.
- **Accepting needs the invited address, verified.** Better Auth matches the signed-in user's
  email to the invitation and requires `emailVerified` (`requireEmailVerificationOnInvitation`).
  This stops someone who registered an address they don't own from joining with it. When the
  email-verification policy is off, sign-up sends no verification email, but the invitation page
  and banner still let the invitee request one. A session that still needs verification or
  enrollment sees what is missing on the invitation page instead of the invitation.
- **Limits:** 10 invitations at once and 30 an hour per inviter (resends included), plus the platform's auth email
  budgets. Up to 100 members per organization and 50 organizations per user.
- **Audited:** creating, renaming, deleting, invitation sent, canceled, deleted, accepted or rejected,
  member removed, member left and role changed (`organization.*` audit actions).
- **Not included:** teams, custom roles, billing, organization management in the admin app, and
  organization-scoped agent capabilities.

## The invitation, step by step

The invitation page (`/accept-invitation/<id>`) shows exactly one state, decided by the
backend. Only the invited address ever sees the organization's name, the inviter or the role.

| The person opening the link | Sees |
|---|---|
| Signed out | "Sign in to view your invitation", with **Sign in** and **Create account**. Nothing about the invitation. The link is remembered, and after sign-in or sign-up (password, passkey, MFA, email verification, security setup) they are brought back to it |
| The invited address, ready | Who invited them, to which organization, as what role: **Accept** (opens the dashboard in it) or **Decline** |
| The invited address, email not yet verified | **Verify email**, which sends the email in place; its link returns here |
| The invited address, security setup outstanding | **Continue**: the dashboard asks for the step, then returns here |
| The invited address, already a member | "You're already in …", with **Open …** |
| Anyone else signed in, including someone who just signed in with the wrong account | "This invitation is for a different account", naming only the account they're signed in with, with **Sign out and switch account** |
| Anyone, once the invitation was accepted, declined, canceled, deleted, replaced or expired, or for an unknown link | "This invitation is no longer valid", without saying which |

An existing user also sees pending invitations as a banner on the dashboard, with **Accept** or
**Decline** (or **Verify email** first).
Multiple invitations appear as a vertical list of separate cards, each naming the inviter and
organization with its own actions. The same reactive list remains visible on account pages,
so new invitations arrive even while the user stays in Settings. Responding to one leaves the
others available.

On the inviting side, the organization page lists each invited address once, with its latest
invitation: **pending** (with its expiry; resend), **expired** (resend), or
**declined** for 30 days (invite again). Owners and admins can delete an invitation in any
state, after confirming (`api.platform.organizations.deleteInvitation`). Deleting the row removes
all unaccepted invitations to that address in the active organization, so an older declined or
expired invitation cannot take its place. Their links then read as no longer valid. Accepted
records are retained; a current member appears in the members list instead.

## Deleting an organization

Owners delete an organization from the danger zone, typing its name to confirm and
re-authenticating if they last signed in more than a few minutes ago. Better Auth removes the
organization, its members and its invitations at once, so nobody can reach anything in it from
then on. Members who had it open see the notice of lost access; anyone left without an
organization, including an owner who deleted their only one, stays signed in without one.
If the user still belongs to another organization, it becomes active instead.

The app's own rows are removed afterwards by **`convex/organizationData.ts`**, which the platform
calls until it reports that nothing is left:

```ts
import { organizationDataCleanup } from "./platform/functions";

export const deleteOrganizationData = organizationDataCleanup(async (ctx, organizationId) => {
  const rows = await ctx.db.query("bookmarks")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(100);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length === 0; // true once nothing is left
});
```

Delete a bounded batch per call, cover every table that belongs to an organization (and their
child rows and stored files), and return `true` only when none remain. The sample's version
removes projects with their tasks and uploads. Without the file, a deleted organization's rows
simply stay in the database, unreachable.

## Scoping your data

Use the organization builders from `./platform/functions` for every table of app data:

- `orgQuery` gives the handler `ctx.organizationId` and `ctx.organizationRole` (as well as
  `ctx.user` and `ctx.ownerId`). It returns `null` when signed out or without an organization.
- `orgMutation` adds the same to `authedMutation`. A signed-in user with no membership gets
  `NO_ORGANIZATION`; the mutation never creates an organization as a side effect.
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
| `OrganizationSwitcher` | Sidebar header: product mark and name, active organization, and a menu to switch or create. `onSwitch` lets you clear state that belongs to the old organization |
| `OrganizationSection` | The organization page's content: name, members, invitations, danger zone |
| `OrganizationInvitations` | Pending-invitation banner; keep it reachable without a membership, including from account settings |
| `NoOrganization` | Empty workspace with guidance and an explicit create action; account navigation remains outside it |
| `useAccountNavigation()` | `open("settings" | "organization")`, account-page hrefs and `close()`, preserving a validated original app location |
| `AccountPageCloseButton` | Localized header Close control using that return location; direct links fall back to app home |
| `CreateOrganizationDialog` | The create dialog, if you want it elsewhere |
| `useOrganizations()` | The caller's organizations and the active one |
| `AcceptInvitationView` (`/views`) | The `/accept-invitation/[id]` page; re-export it from the route |

`ProtectedLayout` also includes `OrganizationAccessNotice`, which shows the notice of lost
access without creating organizations, and `ResumeInvitation`, which
returns a user to an invitation link they opened while signed out. The sign-up view shows the account form for `?invitation=` links
whatever the onboarding mode. The backend admits that sign-up only for an address with a
pending invitation.

## Adopting organizations in an existing app

The platform side arrives with the upgrade. New accounts get a personal organization; your
existing functions, which use `authedQuery`/`authedMutation`, keep working per user. To adopt:

1. Mount the UI. Put `OrganizationSwitcher` in your sidebar header, `OrganizationSection` on its
   own page linked from your account menu (the reference app uses `/dashboard/organization`)
   and `OrganizationInvitations` at the top of your dashboard. Add the route
   `src/app/[locale]/(invitation)/accept-invitation/[id]/page.tsx` re-exporting
   `AcceptInvitationView`, as `apps/web` does.
   Use `useOrganizations()` to hide workspace and organization navigation when
   `activeOrganizationId` is null, and render `NoOrganization` instead of app data. Keep
   account controls and invitations reachable in that state, including from Settings.
   Open account pages through `useAccountNavigation()` (or its hrefs) and put
   `AccountPageCloseButton` in their headers. The return location is carried in `returnTo`,
   restricted to app routes under `/dashboard`, and cannot target another account screen or
   an external site. Locale changes keep the return location in the current locale.
2. Scope your tables as above, and migrate their existing rows as below. Add
   `convex/organizationData.ts` so deleting an organization removes their rows.
3. Translate any app strings you add (`platform-add-strings`). The platform's own strings ship
   in every platform locale.

## Upgrading existing data

Releases before organizations stored app data per user (`ownerId`). The backfill chooses or
creates a private organization when assigning their legacy rows; visiting the app does not
provision a new one. Their data must move
into it, so that they keep it and nobody else sees it. Convex refuses to deploy a schema that
existing rows violate, so this takes two deployment stages
([widen, migrate, narrow](convex-migrations.md)):

1. **Widen and migrate.** Add `organizationId: v.optional(v.string())` and the
   `by_organization` index. Switch the functions to `orgQuery`/`orgMutation` and the access
   checks to the organization. Add a migration in its own module, say
   `convex/bookmarkMigrations.ts`, and list `internal.bookmarkMigrations.bookmarksToOrganizations`
   in the runner at the bottom of `convex/migrations.ts`:

   ```ts
   import { migration } from "./migrations";
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

   `personalOrganizationForOwner` picks an organization the owner owns *alone* with no pending
   invitation, or creates a new personal one, so private data can't land where anyone else can
   see it (even if the user was invited into another organization as an owner before the
   migration ran). It returns
   `null` when the owner's account no longer exists. Those rows stay unassigned and unreachable,
   as they were. Deploys run `convex run migrations` automatically. Until a row is migrated, it
   matches no organization: it is hidden, never exposed.
2. **Narrow**, once the target deployment has migrated: make `organizationId`
   required. Delete or reassign any rows the migration left unassigned first. Convex rejects the
   deploy while any remain.

The sample's `projects.organizationId` is now required. Its backfill remains
`projectsToOrganizations` in `convex/sampleMigrations.ts` for intermediate deployments.
Tasks and uploads inherit the organization through their project; they need no separate field.

### Deployments that have not migrated yet

The deploy action installs the schema and functions **before** running migrations. If existing
projects have no organization, deploying the required schema fails before the backfill can be
installed. Run the following intermediate stage for **each** affected deployment, including
production; waiting for another release or retrying the same schema is insufficient.

1. Prepare a task branch at your app's intermediate organizations revision: it must include
   the organization code and `sampleMigrations.projectsToOrganizations`, with
   `projects.organizationId: v.optional(v.string())` in
   `packages/backend/convex/sampleTables.ts`. For the unmodified starter, this is commit
   `b81d0a10` (organizations, #360); run `bun install --frozen-lockfile` in that checkout.
   For a customized app, first merge that organizations implementation into your own app
   and deploy the intermediate result before taking the contraction. Preserve the app's
   tables, functions and configuration; do not deploy the stock starter over a customized app.
2. Deploy that intermediate revision through your normal deployment process. From
   `packages/backend`, run `bunx convex run migrations` with the same target credentials
   (`CONVEX_DEPLOY_KEY`, or `--prod` for an authenticated production target). Automatic deploys
   already invoke it. It starts scheduled batches: in the Convex dashboard's `migrations` table,
   wait until `sampleMigrations:projectsToOrganizations` has `isDone: true` and no error.
3. Inspect `projects` in that target's dashboard for missing `organizationId`. Completion does
   not imply every row was assigned: deleted creators log `PROJECT_WITHOUT_OWNER_ACCOUNT`
   and their projects stay unassigned. Explicitly reassign those projects only to an organization
   whose ownership you have verified, or delete them and their dependent tasks, upload records
   and stored files under your retention policy. The backfill never guesses an orphan's owner
   or deletes their data automatically.
4. Take the contraction revision (`organizationId: v.string()`), run `bun run ci:quick`, and
   deploy the required schema.
   **Done when:** every retained project has an organization and the deployment succeeds.

If a required-schema deploy has already failed, use the same intermediate steps and then retry.
Do not disable schema validation to bypass the migration.
