# Architecture Patterns

> Detailed guide. See [platform/AGENTS.md](../AGENTS.md) for the quick reference.

## Route Protection (Authentication)

The auth routes, their logic and their default views are platform code in
`@web-app-starter/auth-ui` (`platform/packages/auth-ui`). The web app's route files only
re-export them, so an app gets fixes on upgrade and can still replace any single page with its
own component:

| Route file (`apps/web/src/app/`) | Re-exports from `@web-app-starter/auth-ui` |
|---|---|
| `[locale]/(auth)/layout.tsx` | `AuthLayout` (`/views`): `GuestGuard` + system theme |
| `[locale]/(auth)/sign-in`, `forgot-password`, `reset-password` pages | `SignInView`, `ForgotPasswordView`, `ResetPasswordView` (`/views`) |
| `[locale]/(auth)/sign-up/page.tsx` | See [onboarding ownership and view selection](authentication-and-onboarding.md#onboarding-ownership-and-landing-handoff) |
| `[locale]/(verify-email)/verify-email/page.tsx` | `VerifyEmailView` (`/views`) |
| `[locale]/(invitation)/layout.tsx`, `signup-with-invitation/page.tsx` | `PublicAuthLayout`, `InvitationSignupView` (`/views`) |
| `[locale]/(dashboard)/layout.tsx` | `ProtectedLayout` (`/views`) |
| `[locale]/forbidden/page.tsx` | `ForbiddenView` (`/views`) |
| `api/auth/[...all]/route.ts` | `GET`, `POST` (`/routes/auth`) |
| `api/auth/clear-session/route.ts` | `GET` (`/routes/clear-session`) |

To customise a page, replace its re-export with your own component and build it from the
package's parts: `AuthPageShell` (`/views`), and `AuthForm`, `ForgotPasswordForm`,
`ResetPasswordForm`, `VerifyEmailForm`, `InvitationSignupForm` (root export).

The web app uses a **three-layer** auth system. New protected pages get all three layers by
placing them under `apps/web/src/app/[locale]/(dashboard)/dashboard/`.

Account security UI is also platform code. Import `SecuritySection` from
`@web-app-starter/auth-ui` for the full password/2FA/passkey/session panel, or compose
`ChangePasswordForm`, `TwoFactorSection`, `PasskeySection` and `SessionsList` separately.
Keep the panel under the protected layout and the app's locale/Convex providers. The web
account page owns its surrounding navigation, profile preferences and page layout; its
`components/settings/` security files are compatibility re-exports. Replacing one with an
app component means maintaining that customization yourself.
Security messages use the platform `accountSecurity` namespace. Customize individual strings
through `packages/messages/overrides.json`; the v2 security-message codemod preserves prior
customized wording from the app's `dashboard` namespace.

| Layer | Where | What it does | Speed |
|-------|-------|-------------|-------|
| **Proxy** | `apps/web/src/proxy.ts` calling `authRedirect()` (`@web-app-starter/auth-ui/proxy`) | Cookie-presence check (Edge); the app's proxy adds rate limiting, CSP and locale handling | ~1ms |
| **Layout** | `ProtectedLayout` | Session validation + self-service user preload (RSC), web/admin boundary | ~50ms |
| **AuthGuard** | `AuthGuard` + `SessionAccessGate` | Client-side session watcher and presentation of the backend access decision | Ongoing |

**To add a new protected page:** create it under `src/app/[locale]/(dashboard)/dashboard/`, so its URL
starts with `/dashboard` (the proxy's protected prefix) and it shares the layout's checks. The
`platform-add-page` skill walks through it, including the nav entry and strings.

```
src/app/[locale]/(dashboard)/
  layout.tsx                   <- re-exports ProtectedLayout (shared by all pages)
  dashboard/page.tsx           <- existing page
  dashboard/settings/page.tsx  <- existing page
  dashboard/reports/page.tsx   <- new page, protected by all three layers
```

**To access the current user** in any client component under `(dashboard)/`:

```typescript
import { useAuthUser } from "@web-app-starter/auth-ui";

export function MyComponent() {
  const user = useAuthUser(); // { name?, email? } | null
  return <span>{user?.name ?? "Anonymous"}</span>;
}
```

**To sign out**, call the handler from `useSignOut(redirectTo)` (`@web-app-starter/auth-ui`).

**How the layers work together:**

1. **Proxy** (Edge, instant): `authRedirect()` checks for the session cookie (`<prefix>.session_token`, prefix from `runtime.authCookiePrefix` in `app.config.ts`; names from `@web-app-starter/auth/cookies`). No cookie -> redirect to `/sign-in` (keeping the locale, preferring the `NEXT_LOCALE` cookie). Also redirects authenticated users away from the guest-only auth pages to `/dashboard`, unless `?session_cleared` is set.
2. **Layout** (Server Component): `ProtectedLayout` calls `isAuthenticated()`, then preloads and fetches `api.platform.auth.getCurrentUser` for self-service identity. Invalid sessions go to `/api/auth/clear-session`, which clears the cookies and redirects to sign-in; administrators go to `/forbidden`.
3. **AuthGuard** (Client Component): Subscribes to the Convex user query and watches the Better Auth session. It debounces sign-in redirects for three seconds during token rotation. Its shared `SessionAccessGate` presents the live backend decision; see [session assurance](authentication-and-onboarding.md#85-session-assurance-and-reauthentication) for authorization, limited sessions and retained UI state.

**Backend safety:** `getCurrentUser` returns self-service identity or `null`, so client-side subscriptions degrade gracefully. It is not an application-data authorization helper; use the builders described in [custom endpoints](authentication-and-onboarding.md#86-enrollment-recovery-and-custom-endpoints).

**To protect a route outside `/dashboard` at the proxy:** add its prefix to `protectedPrefixes` in the `authRedirect()` call in `src/proxy.ts`. Guest-only pages are `authRoutes` (`WEB_AUTH_ROUTES` by default).

**Admin** uses the same `authRedirect()`, route handlers, `GuestGuard` broadcast, `ForceSystemTheme` and `useSignOut`; its sign-in and onboarding forms stay admin-specific.

## Guest Pages (Auth Pages)

Guest-only auth pages are wrapped by `GuestGuard` via `AuthLayout`. When a user logs in on another tab:

1. **BroadcastChannel** (instant): The auth form calls `broadcastAuth()` on success. Other tabs' `GuestGuard` receives the message and redirects to `/dashboard`.
2. **Visibility fallback**: When the tab becomes visible, `GuestGuard` calls `authClient.getSession()` to check for an active session and redirects if found.

`GuestGuard` accepts an optional `getRedirectPath` callback for a host-validated sign-in continuation.
The default remains `/dashboard`. Admin uses it to preserve the announcement agent consent
URL on both auth broadcasts and visibility checks; external return URLs are rejected.

**To broadcast auth from a new login flow:** call `broadcastAuth()` from `@web-app-starter/auth-ui` after successful authentication.

## Rate Limiting

The application uses three layers of rate limiting. See [rate-limiting-architecture.md](rate-limiting-architecture.md) for limits, settings and local testing.

| Layer | Scope | Storage | Config |
|-------|-------|---------|--------|
| **Auth requests and delivery** | Auth endpoints and actual auth email attempts | Convex DB (app `rateLimits` table) | `packages/backend/convex/platform/authRateLimits.ts` and `rateLimits.ts` — recipient and deployment budgets; optional verified ingress IP |
| **Convex Functions** | [Authenticated mutation builders](rate-limiting-architecture.md#layer-2-convex-functions-mutations) | Convex DB (`rateLimits` table) | `packages/backend/convex/platform/rateLimits.ts` — env vars via `convex env set` |
| **Edge Proxy** | HTTP page requests (web, admin) | In-memory `Map` (per-instance, capped) | `apps/web/src/proxy.ts`, `platform/apps/admin/src/proxy.ts` — use the shared `@web-app-starter/edge-rate-limit` package |

**Key files:**
- `packages/backend/convex/platform/rateLimits.ts` — Convex rate limit definitions
- `packages/backend/convex/platform/functions.ts` — Authenticated mutation builders
- `platform/packages/edge-rate-limit/` — Shared edge rate limiter (used by the web and admin proxies)
- `platform/packages/auth-ui/src/components/auth-form.tsx` — Client-side 429 error handling

> **Note**: `landing` is a fully static export and does not use edge rate limiting. Rate limiting for static deployments should be handled at the CDN/hosting layer.

**What happens when rate limited:**
- **Auth endpoints**: see [the exhaustion contract and retry guidance](rate-limiting-architecture.md#exhaustion-failures-and-monitoring).
- **Convex mutations**: `ConvexError` with `{ kind: "RateLimited" }`, `useQuery` subscriptions unaffected
- **Edge proxy**: HTTP 429 with `Retry-After` header, plain "Too Many Requests" page

**Queries are NOT rate limited** — they are read-only and used by `useQuery` real-time subscriptions.

## Client vs Server Components

```typescript
// Server Component (default) - no directive needed
// Can use: async/await, direct database access, server-only code
export default async function ServerPage() {
  const data = await fetchData();
  return <div>{data}</div>;
}

// Client Component - requires directive
"use client";
// Can use: useState, useEffect, event handlers, browser APIs
export function ClientComponent() {
  const [state, setState] = useState(false);
  return <button onClick={() => setState(true)}>Click</button>;
}
```

## Convex React Hooks

```typescript
"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend";

export function MyComponent() {
  // Queries subscribe to real-time updates
  const items = useQuery(api.launchItems.list);

  // Mutations for creating/updating/deleting
  const createItem = useMutation(api.launchItems.create);

  const handleCreate = async () => {
    await createItem({ title: "New Item" });
  };

  if (items === undefined) return <Loading />;
  return <ItemList items={items} onCreate={handleCreate} />;
}
```

## Organization primitives and authority

The auth package includes Better Auth's organization client and server schema. Organization roles
(`org-admin`, `member`) are membership roles, not the global `user.role` used for platform
administrator access. Never set a customer's global role to `admin` to represent organization
management, and never treat membership as permission to read another owner's private resources.

Installing the plugin does not make an existing application multi-tenant. Its native organization
HTTP endpoints are denied by the platform's auth endpoint policy; the client namespace is not
permission to use them. Do not call low-level auth-component organization operations from app
clients or bypass the platform policy. See [customer onboarding](authentication-and-onboarding.md#71-step-1--create-account-email--password)
for signup behavior. Application-data scope and a preserving migration must be implemented
before enabling collaborative customer access.

### Parent enrollment setup API

`api.platform.organizationEnrollment` exposes **setup only**, with an explicit `organizationId`:

- `begin({ organizationId, name, slug })`: starts/resumes collaboration setup for the personal
  owner with a recent ordinary application session. It preserves the organization ID and data.
- `status({ organizationId })`: returns live scoped assurance plus non-secret setup progress.
  This is self-service state, not authorization to access tenant data or manage members.
- `verifyCredential({ organizationId, password })`: verifies the current credential against
  administrator password policy and records a recent proof of its exact hash.
- `acknowledgeRecovery({ organizationId, password, codes })`: requires recent strong proof,
  a verified TOTP factor, the current password and two distinct codes from the current set.
  The parent decrypts/validates one captured set and records its exact encrypted fingerprint.

These operations derive identity and session from authentication, require live membership and an
active organization, reject operator and auth-only sessions, and recheck action snapshots in the
recording transaction. Revocation, credential changes or recovery regeneration racing validation
fail closed. Failed password/code attempts consume committed account budgets. Never log passwords
or recovery codes or persist them in browser storage.

Setup assurance reports `scope: "user"` (authority) and `securityScope: "admin"` (requirements).
Verified email and MFA are mandatory; the administrator passkey setting applies, invalid settings
fail closed, magic-link and recovery-only sessions are ineligible, and the four-hour absolute
session clock is measured from the original authentication. Recent password proof cannot restart
that clock. Pending setup does **not** elevate the identity's ordinary user policy, so abandoning
setup preserves personal access. Promotion candidates likewise keep their current member role.
An ordinary status with `allowed: true` does not satisfy the scoped setup requirements.

No public completion or member-management endpoint is exposed here: successful setup still leaves
collaboration/promotion pending. Activation, elevated future-login enforcement, factor-change
last-admin protection, preserving tenant cutover, member invitation admission and their browser
flows must be integrated before collaborative customer access can be enabled. Do not activate it
by directly calling the component's completion primitive.

The canonical server-only operations live in
`packages/backend/convex/platform/betterAuth/organizations.ts`. They require explicit organization
and actor IDs; these arguments are not authentication. Before integrating them, parent wrappers
must derive the actor from a live session, enforce session assurance and bind the requested tenant
context. Password verification and recovery-code acknowledgment are parent responsibilities;
the component does not accept a password or validate a submitted recovery code. When calling
`acknowledgeRecovery`, pass `backupCodesProof`: the SHA-256 fingerprint of the exact encrypted
recovery material the parent decrypted and validated, not a fresh snapshot taken afterward.
The component compares that proof atomically with the current factor and rejects a changed set;
completion checks it again. Regeneration requires renewed validation and acknowledgment.

`provisionPersonal` is idempotent for a personal owner and is reserved for trusted new-customer
admission or explicit preserving migration, never signup to join an existing organization.
Auth signup persists `customerAdmission`
only after server-side public/customer-invitation admission succeeds. This field is not accepted
from clients or returned in Better Auth user output. `resumeCustomerProvisioning` retries that
intent after account creation and before session creation, atomically creating the personal
organization and first membership. A failed after-hook does not lose the intent; subsequent
sign-in retries it, even if public admission has closed. Unmarked legacy, member-only and operator
accounts do not acquire personal organizations on login. Existing accounts require explicit
preserving migration, not an inferred signup intent. Unknown customer intent fails closed. Operator
sign-in ignores stale customer intent and never provisions a tenant. Development operator fixtures
use a server-only signup option guarded by the full local fixture authorization; ordinary HTTP
signup cannot select it. This option does not exist for hosted operator onboarding.

`beginCollaboration` keeps the organization personal while enrollment is pending; promotion likewise
keeps a peer's role as `member`.
Initial completion requires verified email, a recent proof matching the current credential hash,
a verified enabled two-factor row and recorded acknowledgment matching its current backup-code
material. Enrollment stores hashes, not plaintext credentials or recovery codes. A passkey is
required when the trusted caller sets `requirePasskey`, including completed-enrollment retries.
Completion atomically grants membership authority and, for collaboration, renames and activates
the same organization ID. Management authority is rechecked against the live user and verified
factor; a stored `org-admin` role alone is insufficient.

Member removal, demotion and leaving protect the last enrolled administrator in the same mutation
and preserve global identity and other memberships. The org-admin directory scopes both pagination
cursors and returned rows to the requested organization. Platform operators instead receive only
organization metadata and org-admin names/emails through `contacts`; `setLifecycle` disables or
reactivates customer access through these component operations without deleting memberships. They have component
regression coverage in `packages/backend/convex/platform/organizations.test.ts`; signup/provisioning
HTTP behavior is covered by `customerProvisioning.test.ts`. Parent collaboration/session-policy
integration, organization invitation flows, application-data migration and browser flows remain
outstanding.

## Platform data component

`@web-app-starter/convex-platform` owns audit events, app settings and announcements. The
app installs it with `app.use(platform)` in `packages/backend/convex/convex.config.ts`. Keep
that hook. App code calls the existing `api.platform.auditTrail`, `api.platform.appSettings`
and `api.platform.announcements` wrappers; those wrappers check identity, permissions and
rate limits. Direct `ctx.db` access from app code cannot reach component data.

Announcement scheduling, cancellation, tie-breaking and audit writes run inside the
component. The wrapper renders announcement URL variables from the app environment and
combines stored email templates with the app-branded defaults. The component needs no new
environment variables. Client announcement IDs are strings; use the exported `Announcement`
type from `@repo/backend` for row data. Never cast them to the app data model’s IDs.

For backend tests, use the shared factory in `convex/test.modules.ts`; see [testing](testing.md).
The legacy app tables remain during the data-migration transition, but new writes and reads
use the component. Historical rows must be migrated before the old schema is removed.

### Waitlists and invitations

Waitlist entries, invitation tokens and admin invitations live in the platform component.
Use the existing `api.platform.waitlist.*`, `api.platform.waitlistTokens.*` and
`api.platform.adminInvitations.*` wrappers. Their component IDs are opaque strings;
row types are exported as `WaitlistEntry`, `InvitationToken` and `AdminInvitation`
from `@repo/backend`. Do not query these tables through the app database.

Wrappers resolve Better Auth sessions, enforce roles and rate limits, and schedule the
app's email transport. The component owns token hashes, claim/revoke transitions and
onboarding state. See [administrator enrollment](authentication-and-onboarding.md#6-admin-onboarding-flow)
for the account-binding and activation contract. Bootstrap, local seeds and E2E fixtures
use the same component storage.

For paginated waitlist and admin-invitation queries, import `usePaginatedQuery` from
`convex-helpers/react`. Loaded pages are not reactive, and cursors contain index values
(they are not secrets). Reload the list after mutations when fresh rows are needed. A full
page reports `isDone: false`; fetch the next page even when the previous one looked final.
Waitlist pagination excludes admin addresses before selecting a page, so hidden admins do
not shorten visible pages or cause entries to be skipped.

### Protected admin addresses

`adminEmails` is stored in the platform component. The admin-only
`api.platform.adminEmails.listProtected` wrapper returns addresses; backend auth hooks
use `internal.platform.adminEmails.list`. Its rows have the exported `AdminEmail` type.
Protected-admin changes and password-reset policy lookup read this API,
so they use the same state as invitation claims and bootstrap. Component functions are
trusted backend entry points and cannot be called directly by clients.

`userProfiles`, Better Auth sessions and rate-limit state stay in `convex/platform/`
and the host database/components. They do not read the platform component database
directly; settings and protected-address queries cross its typed API boundary.
