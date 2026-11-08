# Tenancy, plans and billing organizations

Terms: **user** (a person who signs in), **organization** (Better Auth organization), **billing
organization** (an organization with a `billingOrganization` row: the payer), **plan**, **organization
plan** (`organizationPlan` row). There is no "account", "workspace" or seat-based pricing.

## Tables

| Table | Where | Purpose |
|---|---|---|
| `plans` | platform component | Plan catalog, managed by the platform admin |
| `billingOrganizations` | platform component | Marks an organization as a payer; payment method |
| `organizationPlans` | platform component | Which plan an organization uses and which billing organization pays; history via `endedAt` |
| `pendingPlanChoices` | platform tables | A user who must pick a plan before using the app |
| `tenancySetups` | platform tables | Progress of turning a tenancy mode on (batched) |
| `userDeletions` | platform tables | A user's own deletion request during its grace period |
| `organization` (Better Auth) | Better Auth component | Unchanged |
| `appSettings` keys | platform component | `tenancyMode`, `userDeletionGraceDays` |

Code: `components.platform.billing` (rows and their rules), `convex/platform/billingAccess.ts`
(shared helpers), `billing.ts` (users and the plan catalog), `tenancy.ts` (setup) and
`userDeletion.ts`. UI: `TenancyGate` (protected layout), `BillingSection`, `DeleteUserSection`
and `CreateOrganizationDialog` from `@web-app-starter/auth-ui`; the admin app's **Manage → Plans**,
**Configure → Tenancy**, the Users page's scheduled deletions and the Features page's grace period.

Error codes: `TENANCY_NOT_CONFIGURED`, `PLAN_CHOICE_REQUIRED`, `USER_DELETION_SCHEDULED`,
`ORGANIZATION_CREATION_DISABLED`, `NOT_AVAILABLE_FOR_INDIVIDUALS`, `PAYER_REQUIRED`,
`PAYMENT_METHOD_REQUIRED`, `PLAN_IN_USE`, `BILLING_ORGANIZATION_IN_USE`, `BILLING_OWNER_REQUIRED`.

`organizationId` fields are strings into Better Auth's component: every write that sets one checks
that the organization exists. `planId` and `billingOrganizationId` are real `v.id` references.

## Rules

**Plans**
- `priceMonthlyUsdCents`: integer ≥ 0, USD. Can't change once any `organizationPlan` row uses the plan.
- `isFreeForever` never changes. More than one free-forever plan is allowed.
- One free-forever plan is seeded at install; only its `status` can change. It starts as the default.
- Exactly one default plan, and it is `active`. While a tenancy mode is being turned on, the default
  is the free-forever plan; afterwards it can be any active plan.
- Status: `active` can be chosen; `inactive` can't be chosen, existing rows carry on, can be
  reactivated; `archived` is inactive and hidden from the admin's default lists.
- Plans are never deleted.

**Organization plans and payers**
- Every organization without a `billingOrganization` row has exactly one current `organizationPlan`
  (no `endedAt`); a billing organization has 0 or 1.
- The payer of an `organizationPlan` is the `billingOrganization` row it names, nothing else.
- `billingOrganizationId` is empty only on free-forever plans. A downgrade to free-forever clears
  it, except an individual's own billing organization, which stays their payer.
- `planId` and `billingOrganizationId` are never edited: a change ends the row and starts a new one.
- Plan changes: owners and admins of the billing organization named in the current row.
- Changing the payer directly isn't supported this release; downgrade then upgrade achieves it.
- `paymentMethod` (`cash` | `check`, a stand-in for a payment provider) is required while a current
  plan paid by that billing organization isn't free-forever.
- A billing organization can't be deleted while a current `organizationPlan` points to it
  (`BILLING_ORGANIZATION_IN_USE`).

**Organizations and permissions**
- Organizations are created only by platform functions, so the organization and its plan row are
  written in one transaction. Better Auth's `/organization/create` is turned off.
- Every organization, billing or not, manages its own members and invitations (owner and admins).
- In a billing organization, owners and admins act; members view the billing organization, the
  organizations it pays for and their plans (not their members or data). The billing card lists
  those a page at a time (`billing.paidOrganizations`); checking whether a billing organization
  still pays for another reads at most two plan rows.
- Platform-created organizations make their user the owner (the owner invariant forbids admin-only).
- Platform admins get no personal organization, plan or billing, and don't change plans this release.

## Tenancy modes

`tenancyMode` is `individuals` or `organizations`, chosen by the platform admin. There is no "none"
mode. Until chosen, sign-ups and organization creation are refused (`TENANCY_NOT_CONFIGURED`);
existing users keep working. One-way; individuals → organizations may come later.

Turning on either mode needs an active, free-forever default plan. The seeded Free plan is sufficient; additional plans are optional.

**What the install allows** comes from a stored check (`tenancy.check`): a background scan of
every user and organization, 100 per transaction, whose progress and result are kept in the
platform's `tenancyChecks` table. The admin tenancy page starts one when there is none or the
last has expired, shows its progress, and offers **Check again**; `tenancy.status` reads the
stored result and the plans, never every user. `configure` accepts a result at most 10 minutes
old (`TENANCY_CHECK_REQUIRED`, `TENANCY_CHECK_EXPIRED`): until a mode is chosen, sign-ups and
organization creation are refused, so the counts rarely change, and a short age bounds every way
they could. What can change within it is checked again where it matters: `configure` re-reads
the plans and the owners it is given, and an individuals setup re-checks every organization and
user in its own batches. An install with more than 2,000 users or organizations can't turn a
mode on from the admin page (`TENANCY_INSTALL_TOO_LARGE`).

**Fresh install:** after the first platform admin is set up, the admin app shows only the tenancy
step. **Existing deployment:** the upgrade's migration gives every organization a free-forever
`organizationPlan`, independent of mode.

### Individuals
- Precondition: every organization has exactly one member and every user exactly one organization
  (fresh installs).
- Turning on: each user's organization gets a `billingOrganization` row; its plan row names it as
  payer.
- New users: personal organization + billing row + plan row, all on the same organization.
- No organization UI, no Create organization, no invitations. The server refuses organization
  delete, leave, invite, remove-member and role changes.
- The user sees "Billing details".

### Organizations
- With existing users and no organization of more than one member, the admin selects a billing
  user and an admin (may be the same user) and names both organizations: a new billing
  organization (billing user = owner, no plan) and one new shared organization with every existing
  user as a member (admin = owner), on free-forever, paid by that billing organization. Existing
  personal organizations keep their free-forever plans.
- If shared organizations already exist (an existing deployment), that step is skipped: existing
  organizations keep their free-forever plans with no payer.
- On an empty install nothing is created; the first billing organization appears when a user
  upgrades.
- New users: personal organization on free-forever (self sign-up or platform-admin invitation), or
  only the organization they were invited into.
- Create organization: owners and admins of a billing organization, from its screen; any active
  plan; that billing organization pays (shown in the dialog); the creator becomes owner.

### Sign-up plan picker
Shown only while more than one plan is active. A required step after sign-up (like email verification), shown when sign-up creates a personal
organization. The organization sits on free-forever until the user picks; the default is
pre-selected. A non-free-forever plan needs a payment method, and is handled as an upgrade (below):
in organizations mode it creates a new billing organization the user owns. Organization-invited
sign-ups skip the picker.

### Upgrading a free-forever organization with no payer
By its owner or admin, in one mutation: pick an existing billing organization they own or
administer, or create one (named in the dialog, with a payment method; individuals: a billing row
on the same organization; organizations: a new organization they own). The current plan row ends;
a new one starts with the paid plan and payer.

## Deletion

Everything is deleted except billing history (`plan`, `billingOrganization`, `organizationPlan`)
and the audit trail. Billing rows copy `organizationName` when created. Deleting an organization
ends its plan row and sets `deletedAt` on its billing row.

Deleting an organization ends its plan and marks its billing row deleted on every path: its
owner's delete, the platform admin's (`adminOrganizations.remove`) and account deletion emptying
it. A billing organization stays in use only while a current plan of another organization
names it.

**User deletion** follows today's membership rules (ownership passes to the longest-standing admin,
else member; organizations left empty are deleted with their app data), plus: refused while the
user is the last member (`BILLING_ORGANIZATION_IN_USE`), or the last owner
(`BILLING_OWNER_REQUIRED`), of a billing organization that pays for current plans. Every path
takes the same steps (`beginUserDeletion` and `finishUserDeletion` in `userDeletion.ts`): the
checks, then the cleanup record, then the user, then memberships and user data. Better Auth's
delete hooks run them for its admin delete and a scheduled self-deletion; the admin agent's
`users_remove` (`api.platform.agentUsers.remove`) runs them in one transaction.

- **Self-deletion** (every mode, web settings): needs recent authentication; schedules deletion
  after `userDeletionGraceDays` (admin-configurable, default 14); signs the user out everywhere;
  emails them. During the grace period, sign-in offers only **Cancel deletion** or **Continue with
  deletion and sign out**. At the due time the checks run again; a failure blocks it (state
  `blocked`, user emailed). Platform admins see scheduled and blocked deletions with the countdown,
  and can cancel one. While it is pending the user doesn't count as an owner who can act: where
  they were the only one, the request makes a successor an owner too
  ([organizations](organizations.md#roles)).
- **Platform admin's delete**: immediate, same checks.
- Audit: `user.deletion.requested`, `.canceled`, `.completed`, `.blocked`.

## Local development and E2E

The dev seed and E2E fixtures turn on organizations mode with an inactive paid plan
(`tenancy.ensureFixtureTenancy`, local backends only), so fixture users never see the plan picker.

Account deletion removes the user's platform profile (including a migrated owner ID), pending
plan choice and scheduled deletion request. Billing history and audit records remain. The
optional, idempotent `userData:deleteUserData` internal mutation handles app-owned user data.
It receives `{userId, ownerId}`. Existing apps without `packages/backend/convex/userData.ts`
continue to bundle and delete platform-owned records; no adoption action is required unless
the app has user-owned data to remove. Add that cleanup in the optional mutation. Shared organization data remains governed by
`organizationData.ts` and is removed only when the organization itself is deleted.

Deletion cancellation and execution serialize on the request row. A scheduled job carries its
request identity; a canceled or superseded job cannot delete a later request. Once execution
atomically claims the request (`deleting`), cancellation refuses with `USER_DELETION_IN_PROGRESS`.

Execution is a Convex action, which runs at most once: one killed mid-run (a deploy, a crash,
the 10-minute limit) leaves the request `deleting` with nothing scheduled, and the user possibly
half deleted. The admin deletion list (`userDeletion.list`) reports such a request as `stale`
(shown as **Stalled**): its job failed, was canceled, finished without moving the request on, or
has been running for over 15 minutes. **Retry deletion** (`userDeletion.adminRetry`) runs it
again under a new run token, so a late run of the dead one does nothing; where the user row is
already gone it continues into the cleanup below. A stale deletion can be cancelled, by the user
or an administrator, only while the user row and its sign-in accounts are intact (`cancelable`
in the list); otherwise cancelling refuses with `USER_DELETION_INCOMPLETE` and only a retry
finishes it. A retry is audited as `user.deletion.retried`.

Tenancy setup checks owner membership capacity before accepting configuration and again before
each batch that creates owners. Each batch runs inside a scheduled mutation (`advanceSetup`),
which Convex runs exactly once: a batch that throws, or exceeds its share of the transaction's
limits, rolls back and the same mutation records the setup as failed. Failed batches appear as
stopped in the admin tenancy page. Should a batch's mutation itself fail or be canceled, the
setup stays `running` with nothing scheduled; `status` then reports it as `stale` and Retry setup
accepts it like a failed one. Correct the prerequisite and use Retry setup; replacement owners can be selected
before the billing/shared organizations are created. After that, if the shared organization's
owner was banned, made a platform admin or deleted between batches, so it has no owner who can
act, Retry setup takes a new owner for it (`retry({ adminUserId })`, shown when `status` reports
`canReplaceAdmin`), and recreates it, on its plan and payer, if it was deleted. Completed
batches are retained. Individuals mode refuses joins that would share an organization while
its setup runs, and the setup checks, a batch at a time, that every organization still has one
member and every application user one organization before committing
(`TENANCY_INDIVIDUALS_NOT_ALLOWED` otherwise). Each member the shared step adds costs the same
whatever the shared organization's size: the ownership checks read its owners, not its members.

Users still to become platform admins (a pending admin invitation or a protected admin address)
are not application users for setup: they are never owner candidates nor added to the shared
organization, and they don't count against Plans for Individuals. Completing admin enrollment
goes through the same ownership check as any role change.

Before auth deletion, the platform stores cleanup inputs (including a migrated profile owner ID)
in `userDeletionCleanups`, with a scheduled run of the cleanup job. Once the user row is gone,
the job removes the user's memberships one organization per transaction (handing over ownership
or deleting an emptied organization as above), then the app-owned and platform-owned data; each
step runs as a scheduled mutation that records its own failure. Cleanup retries are independent
of the deleted account and of the original destructive job. The admin deletion list shows a
pending cleanup with how many memberships it has removed; a failed step retries automatically up
to five attempts, after which an administrator can use **Retry cleanup**, as they can for a
cleanup whose run died (`stale`). Retry is refused (`USER_CLEANUP_RUNNING`) while it is running
normally. The list shows at most 200 deletion requests and 200 cleanups, and says when there are
more (`more`).
Cancellation cannot discard cleanup after auth deletion. The recovery record is removed only
when membership, app-owned and platform-owned cleanup has completed.

A payer's dependency check and deletion marker commit together. Billing authorization reads that
marker, so sponsorship and payer deletion serialize before Better Auth removes any members.

Cancellation also rechecks the ownership invariant. If the user was demoted while their deletion
was pending and the remaining owners can no longer act, canceling refuses with
`OWNER_SUCCESSOR_REQUIRED`. Make another member an owner before retrying cancellation.
Eligibility checks are invalidated by transactional membership and user changes before setup
starts; rerun the check after `TENANCY_CHECK_CHANGED`.
