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
| `[locale]/(auth)/sign-in`, `sign-up`, `forgot-password`, `reset-password` pages | `SignInView`, `SignUpView`, `ForgotPasswordView`, `ResetPasswordView` (`/views`) |
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

| Layer | Where | What it does | Speed |
|-------|-------|-------------|-------|
| **Proxy** | `apps/web/src/proxy.ts` calling `authRedirect()` (`@web-app-starter/auth-ui/proxy`) | Cookie-presence check (Edge); the app's proxy adds rate limiting, CSP and locale handling | ~1ms |
| **Layout** | `ProtectedLayout` | Full session validation + user preload (RSC), admin/banned/MFA rules | ~50ms |
| **AuthGuard** | `AuthGuard` | Client-side session watcher + redirect | Ongoing |

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
2. **Layout** (Server Component): `ProtectedLayout` calls `isAuthenticated()` for full session validation, then `preloadAuthQuery(api.platform.auth.getCurrentUser)` to SSR the user data. Stale sessions go to `/api/auth/clear-session`, which clears the cookies and redirects to sign-in.
3. **AuthGuard** (Client Component): Subscribes to the Convex user query for real-time updates and watches the Better Auth session. If the session is invalidated while the page is open, redirects immediately.

**Backend safety:** The `getCurrentUser` Convex query returns `null` (not throws) when unauthenticated, so client-side subscriptions degrade gracefully instead of crashing.

**To protect a route outside `/dashboard` at the proxy:** add its prefix to `protectedPrefixes` in the `authRedirect()` call in `src/proxy.ts`. Guest-only pages are `authRoutes` (`WEB_AUTH_ROUTES` by default).

**Admin** uses the same `authRedirect()`, route handlers, `GuestGuard` broadcast, `ForceSystemTheme` and `useSignOut`; its sign-in and onboarding forms stay admin-specific.

## Guest Pages (Auth Pages)

Guest-only auth pages are wrapped by `GuestGuard` via `AuthLayout`. When a user logs in on another tab:

1. **BroadcastChannel** (instant): The auth form calls `broadcastAuth()` on success. Other tabs' `GuestGuard` receives the message and redirects to `/dashboard`.
2. **Visibility fallback**: When the tab becomes visible, `GuestGuard` calls `authClient.getSession()` to check for an active session and redirects if found.

**To broadcast auth from a new login flow:** call `broadcastAuth()` from `@web-app-starter/auth-ui` after successful authentication.

## Rate Limiting

The application uses three layers of rate limiting. See [rate-limiting-architecture.md](rate-limiting-architecture.md) for limits, settings and local testing.

| Layer | Scope | Storage | Config |
|-------|-------|---------|--------|
| **Better Auth** | Auth endpoints (sign-in, sign-up) | Convex DB (betterAuth component `rateLimit` table) | `packages/backend/convex/platform/auth.ts` — env vars via `convex env set` |
| **Convex Functions** | All `authedMutation` calls | Convex DB (`rateLimits` table) | `packages/backend/convex/platform/rateLimits.ts` — env vars via `convex env set` |
| **Edge Proxy** | HTTP page requests (web, admin) | In-memory `Map` (per-instance, capped) | `apps/web/src/proxy.ts`, `platform/apps/admin/src/proxy.ts` — use the shared `@web-app-starter/edge-rate-limit` package |

**Key files:**
- `packages/backend/convex/platform/rateLimits.ts` — Convex rate limit definitions
- `packages/backend/convex/platform/functions.ts` — Global mutation rate limit in `authedMutation`
- `platform/packages/edge-rate-limit/` — Shared edge rate limiter (used by the web and admin proxies)
- `platform/packages/auth-ui/src/components/auth-form.tsx` — Client-side 429 error handling

> **Note**: `landing-static` is a fully static export and does not use edge rate limiting. Rate limiting for static deployments should be handled at the CDN/hosting layer.

**What happens when rate limited:**
- **Auth endpoints**: HTTP 429, auth form shows "Too many attempts. Please wait a moment before trying again."
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
onboarding state. An admin invitation grants the admin-email entry only after a valid
token is claimed. Bootstrap, local seeds and E2E fixtures use the same component storage.

For paginated waitlist and admin-invitation queries, import `usePaginatedQuery` from
`convex-helpers/react`. Loaded pages are not reactive, and cursors contain index values
(they are not secrets). Reload the list after mutations when fresh rows are needed. A full
page reports `isDone: false`; fetch the next page even when the previous one looked final.
Waitlist pagination excludes admin addresses before selecting a page, so hidden admins do
not shorten visible pages or cause entries to be skipped.
