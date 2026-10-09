# App-operator organization workflow

The admin app's **Manage → Organizations** page lists canonical organization metadata. Open an
organization to see its availability and its current designated contact. The existing **App
operators** page remains limited to operator identities.

The directory displays the organization's name, availability, membership-management experience and
creation date. It paginates on the server; changing the signed-in operator resets page cursors. A
detail link captures the immutable organization ID. Names and session preferences never select the
authorization context.

The contact card shows only the current designated, eligible org-admin contact returned by the
backend. If no contact is designated or the designated person is no longer eligible, the card says
that no current contact is available. It does not fall back to other administrators or reveal an
ordinary member directory. Operators cannot change the contact or organization membership.

**Disable organization** and **Reactivate organization** require confirmation and recent app-operator
proof. Disabling preserves accounts and data while preventing access to this organization; other
authorized organizations and account security remain available. Reactivating preserves ownership and
normal security requirements. Provisioning organizations cannot be changed from this screen. If the
organization's availability changes while a confirmation is open, that confirmation is disabled and
the operator must review the current state again.

A lost session or permission clears the organization view and its open confirmation. A fresh-sign-in
prompt is offered when the server rejects stale proof. There is no automatic retry of a privileged
write after reauthentication. Query failures display safe fixed copy, never raw server exception
payloads.

The screen has no membership counts, private resources, credentials, sessions, ordinary user controls,
or identity-security details. The same field allowlist is used in the rendered page and confirmation
portal. This UI is a projection of `api.platform.organizations.list`, `get` and `setLifecycle`; backend
authorization remains authoritative for every call.

## Extending and checking the admin UI

Routes live under the existing protected `(dashboard)/manage/organizations` tree. Components are in
`platform/apps/admin/src/components/organizations/`. Admin is English-only: its new organization
copy is stored in the admin-local `src/messages/en.json`, while shared auth/security controls continue
to use the platform English catalogue. App-owned web catalogues are not imported by admin.

Run focused checks from the repository root:

```sh
CI=true bun run --cwd platform/apps/admin typecheck
CI=true bun run --cwd platform/apps/admin test:unit organizations
```

`platform/apps/admin/qa/e2e/organizations.spec.ts` exercises real operator navigation, availability
changes and preserved private project access with disposable local identities. It also checks that
customer identity/credential/project values do not appear in the page or confirmation portal. To run
against an existing authorized local environment without starting a server:

```sh
E2E_BASE_URL=http://localhost:3001 DEV_FIXTURE_SECRET_FILE=/path/to/local-fixture.env \
  CI=true bun run --cwd platform/apps/admin test:e2e qa/e2e/organizations.spec.ts --workers=1
```

Use the actual admin origin and paired local fixture file from that environment. The fixture helper
rejects hosted backend targets. The test creates new disposable identities and a private project;
it never borrows or changes a real customer's organization. The authentication guard is also covered
by an unauthenticated route test. The unit suite exercises actual DOM/dialog portals, stale context,
permission loss, pagination and recent-proof recovery; it is not browser evidence.
