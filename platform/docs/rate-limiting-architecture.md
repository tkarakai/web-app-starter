# Rate Limiting Architecture

This document describes the rate limiting implementation across the application stack.

## Overview

Rate limiting is implemented at three layers, each targeting a different attack surface and operating at a different point in the request lifecycle.

```
Client Request
  │
  ├─ Page request → Layer 3: Edge Proxy → React page
  │                 Per-IP, in-memory
  │
  ├─ Auth request → Layer 1: Auth request and email budgets → Better Auth
  │                 Recipient/deployment, database-backed
  │                 Includes direct Convex HTTP requests; bypasses edge proxy
  │
  └─ Authenticated mutation → Layer 2: Convex mutation budget → Mutation
                               Per-user, database-backed
```

## Layer 1: Authentication requests and email delivery

Better Auth's built-in limiter is disabled. The platform uses durable Convex token buckets in
its app-level `rateLimits` table, through `platform/authRateLimits.ts` and
`platform/rateLimits.ts` in the backend. Separate mutations commit request usage before the
handler runs and atomically reserve email capacity before calling the email provider.
Limits apply across instances and survive restarts.

Every auth route, including installed plugin endpoints and unknown routes, consumes the
request budget. OPTIONS and an explicit GET allowlist for session polling, Convex tokens/key
discovery and health/error pages are exempt. Email-producing callbacks also share delivery
budgets, independent of the route or claimed client IP. Recipients are trimmed and lowercased
before hashing; plus tags and dots are not stripped. Keys contain hashes, not email addresses.

### Default limits

| Budget | Refill | Burst | Scope |
| --- | --- | --- | --- |
| Auth requests | 1,000/minute | 250 | Deployment |
| Verified ingress IP requests | 100/minute | 50 | IP, only when configured as described below |
| Password sign-in / email OTP verification | 3/10 seconds | 3 | Normalized recipient |
| Signup / email OTP password reset | 5/minute | 5 | Normalized recipient, separate named request budgets |
| Magic link, verification, OTP send, password-reset request | 3/minute | 3 | Normalized recipient, separate named request budgets |
| Auth email reservations | 3/minute | 3 | Normalized recipient across message types |
| Auth email reservations | 60/minute | 20 | Deployment |
| Auth email reservations | 1,000/24 hours | 1,000 | Deployment |

These are token buckets with continuous refill, not calendar windows or hard rolling-window
quotas. A full bucket permits its initial burst plus tokens replenished during a period.
The 24-hour budget refills about one token every 86.4 seconds. Set provider-side quotas and
billing alerts as well; invitation and other transactional mail have separate delivery paths.
Recovery-code password reauthentication has its own shared per-account 5/minute, burst-5 budget.
Better Auth's own OTP/TOTP challenge-attempt checks remain in place.

Routes mapped to the same request budget share its capacity: password sign-in and email-OTP
verification share `authSignIn`; password-reset link requests, email-OTP reset requests and
the deprecated reset alias share `authPasswordResetRequest`. The authoritative route mapping
is `AUTH_RECIPIENT_LIMITS` in `packages/backend/convex/platform/rateLimits.ts`. Recipient
request keys are extracted from JSON and form-encoded email bodies; unreadable bodies still
consume deployment and any configured trusted-IP request budgets.

### Deployment configuration and IP trust

Set these on the Convex deployment, from `packages/backend/`, using `bunx convex env set`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUTH_EMAIL_RATE_PER_MINUTE` | `60` | Deployment email reservation capacity replenished per minute |
| `AUTH_EMAIL_BURST` | `20` | Deployment short-term email capacity |
| `AUTH_EMAIL_RATE_PER_DAY` | `1000` | Long-term reservation capacity and refill per 24 hours |
| `AUTH_TRUSTED_IP_HEADER` | Unset | Optional verified ingress-overwritten single-IP header |

Size email budgets for expected enrollment/reset volume and the provider's quota. Defaults
are active without configuration. The old `AUTH_RATE_LIMIT_*` variables do not configure
this implementation.

Leave `AUTH_TRUSTED_IP_HEADER` unset unless you have verified that **every reachable ingress**
(including a direct Convex HTTP URL) overwrites that header with one authoritative IP address.
A client-supplied `X-Forwarded-For` or `X-Real-IP` is not proof of origin. Comma-separated
chains and malformed addresses are ignored. No hosting-specific overwrite guarantee is assumed;
verify it using real requests before enabling the additional IP budget. Recipient and deployment
budgets apply regardless of headers, so rotating a forged header cannot evade those limits.
Better Auth's session IP metadata is separate and is not used to choose these buckets.

### Exhaustion, failures and monitoring

A denied request budget returns HTTP 429 with `Retry-After` in seconds and `Cache-Control: no-store`.
Honor that delay, surface the error in custom clients and require an explicit later retry.
Delivery-budget denials on public conditional-mail routes retain the normal HTTP 200 body
and headers: verification email (including custom templates), password-reset links, and
email-OTP verification/reset requests, including the deprecated reset alias. This prevents
exhaustion from revealing whether an account exists or is verified, even when concurrent
requests consume the last capacity. Email-OTP sign-in also follows this contract when signup
is disabled. Acknowledgement does not promise delivery; retry later if no email arrives.
Unconditional sends, including two-factor OTP and signup-enabled email-OTP sign-in, retain
HTTP 429 and the retry headers on delivery denial. Ineligible requests spend no mail tokens.
There is no unbounded retry queue. Provider failures still consume reserved capacity, because
an ambiguous failure may already have delivered a message. There are no automatic refunds or
provider retries. A denied delivery reservation does not consume the other delivery buckets.
Expired capacity refills normally; repeated denials do not extend the wait.

OTP sends reserve capacity after request/session validation and send eligibility checks, before
changing challenge state. Ineligible requests consume request budgets only. A later failure or
concurrent account change can still prevent delivery after a reservation; reservations are not refunded.
Competing sends atomically reuse an unexpired code with remaining verification attempts.
Reuse retains its original expiry and attempt count.
A resend replaces an exhausted or expired challenge; email OTP and two-factor OTP retain their
separate attempt limits. A throttled resend preserves the last delivered code, including when
the library attempts a delete-and-retry fallback after challenge creation fails. The platform
emits `AUTH_EMAIL_BUDGET_EXHAUSTED` with the budget name at most once per
five minutes per deployment, with no recipient, code or message contents. Alert on this event
in your log sink and monitor HTTP 429 volume and provider usage. A shared deployment budget
can temporarily delay legitimate mail during abuse; choose capacity and operational alerts for
your app's traffic. No remote log-alert integration is installed automatically.

---

## Layer 2: Convex Functions (Mutations)

**Scope**: All authenticated mutations (every function built with `authedMutation`)

**How it works**: Uses `convex-helpers/server/rateLimit` with `defineRateLimits`. A single global rate limit (`mutationGlobal`) is checked in the `authedMutation` builder, so every mutation call is rate limited per user. The token state is stored in the `rateLimits` table in the Convex database (persistent, works across all Convex instances).

**Configuration files**:
- `packages/backend/convex/platform/rateLimits.ts` — Rate limit definitions
- `packages/backend/convex/platform/functions.ts` — Integration in `authedMutation`
- `packages/backend/convex/schema.ts` — `rateLimitTables` spread into schema

### Default Limits

| Name | Algorithm | Rate | Period | Burst Capacity | Scope |
|------|-----------|------|--------|----------------|-------|
| `mutationGlobal` | Token bucket | 30 tokens/min | 60s | 10 tokens | Per user (`ownerId`) |

Token bucket means: tokens accumulate continuously at 30/minute. Users can make up to 10 requests in quick succession (burst), then must wait for tokens to replenish. This allows normal interactive usage while blocking automated abuse.

Queries are not rate limited: they are read-only and back `useQuery` subscriptions, which would break if throttled.

### Environment Variables

Set via `convex env set <KEY> <VALUE>`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MUTATION_RATE_LIMIT_RATE` | `30` | Tokens added per period |
| `MUTATION_RATE_LIMIT_PERIOD` | `60000` | Period in milliseconds |
| `MUTATION_RATE_LIMIT_CAPACITY` | `10` | Maximum burst capacity |

### What Happens When Rate Limited

- **Server**: `convex-helpers` throws a `ConvexError` with data `{ kind: "RateLimited", name: "mutationGlobal", retryAt: <timestamp> }`. The mutation is aborted — no database changes occur.
- **Client**: The `useMutation` promise rejects with a `ConvexError`. Components with try/catch show the error. `useQuery` subscriptions continue working normally.
- **User sees**: An error in the component that triggered the mutation. Real-time data remains live and updating.
- **Recovery**: Wait for tokens to replenish (refills at 30/minute).

### Handling ConvexError in Components

Pattern for catching rate limit errors in mutation-calling components:

```typescript
import { ConvexError } from "convex/values";

try {
  await createProject({ name, description });
} catch (err) {
  if (err instanceof ConvexError) {
    const data = err.data as { kind?: string; retryAt?: number };
    if (data?.kind === "RateLimited") {
      const waitSeconds = data.retryAt
        ? Math.ceil((data.retryAt - Date.now()) / 1000)
        : 5;
      setError(`Too many requests. Please wait ${waitSeconds} seconds.`);
      return;
    }
  }
  setError("An error occurred.");
}
```

---

## Layer 3: Edge Proxy (HTTP Requests)

**Scope**: All HTTP page requests to the web and admin apps (excludes API routes, static assets, and prefetch requests)

**How it works**: An in-memory fixed window counter (`Map<ip, {count, resetAt}>`) in the Next.js proxy (Edge Runtime). Checks happen before auth redirects and CSP header generation, so abusive requests are rejected immediately with minimal processing.

**Configuration files**:
- `apps/web/src/proxy.ts` — Web app proxy integration
- `platform/apps/admin/src/proxy.ts` — Admin app proxy integration
- `@web-app-starter/edge-rate-limit` (`platform/packages/edge-rate-limit/`) — the shared rate limiter

The landing app is a static export with no server-side proxy; rate-limit it at the CDN or hosting layer.

### Default Limits

| App | Window | Max Requests | Map Size Cap |
|-----|--------|-------------|-------------|
| Web | 60s | 200 | 10,000 IPs |
| Admin | 60s | 100 | 10,000 IPs |

### Environment Variables

Set in `.env.local` or deployment config:

| Variable | Default (web) | Default (admin) | Description |
|----------|-------------|-------------------|-------------|
| `EDGE_RATE_LIMIT_WINDOW` | `60` | `60` | Window in seconds |
| `EDGE_RATE_LIMIT_MAX` | `200` | `100` | Max requests per window |
| `EDGE_RATE_LIMIT_MAP_MAX_SIZE` | `10000` | `10000` | Max tracked IPs |

### Map Size Cap and Fail-Closed Behavior

The in-memory IP tracker has a configurable maximum size (default 10,000 entries). This prevents memory exhaustion from DDoS attacks using many unique IPs.

**When the map is full:**
1. A cleanup pass runs, evicting expired entries
2. If the map is still at capacity, **new IPs are rejected with 429** (fail-closed)
3. Existing tracked IPs continue to be served normally

### Limitations

- **Per-instance only**: Each serverless/edge instance has its own counter. The effective limit scales with the number of instances.
- **Not persistent**: Counters reset on deployment. This is acceptable because the edge layer is a first line of defense, not the primary rate limiting.
- **Excluded routes**: API routes (`/api/*`), static assets (`/_next/static/*`, `/_next/image/*`), and prefetch requests are not rate limited at the edge. Auth API routes are protected by Layer 1; other API routes need their own protection.

### What Happens When Rate Limited

- **Server**: Returns HTTP 429 with headers:
  - `Retry-After`: Seconds until the window resets
  - `X-RateLimit-Limit`: Maximum requests per window
  - `X-RateLimit-Remaining`: `0`
  - `X-RateLimit-Reset`: Unix timestamp (ms) when the window resets
- **Response body**: Plain text "Too Many Requests"
- **User sees**: A plain "Too Many Requests" page. This should only trigger under genuine abuse conditions (200+ page loads in 60 seconds is far beyond normal browsing).
- **Recovery**: Wait for the window to reset (default 60 seconds).

---

## Response Headers

All successful responses from the web and admin proxies include rate limit headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed per window |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Unix timestamp (ms) when the window resets |

These headers allow clients and monitoring tools to track rate limit status proactively.

---

---

## Local Testing

You can set artificially low rate limits to manually trigger rate limiting in a running dev environment.

### Layer 1: Authentication email

Use a disposable local deployment and a local email sink (never real recipients). Defaults
allow three magic-link requests to the same address in a burst; the fourth returns 429.
Rotate recipients to test the shared burst, or temporarily lower its capacity:

```bash
cd packages/backend
bunx convex env set AUTH_EMAIL_RATE_PER_MINUTE 1
bunx convex env set AUTH_EMAIL_BURST 1
```

Send to two different fixture addresses via `/api/auth/sign-in/magic-link`; the second must
not reach the email sink, even with a different forwarded-IP header. Wait for `Retry-After`
and retry. Backend regressions also cover concurrency, provider failure and installed routes:
`bun run --cwd packages/backend test:convex convex/platform/authRateLimits.test.ts` from the repo root.

### Layer 2: Convex Mutations

Set via the Convex CLI (run from `packages/backend/`):

```bash
cd packages/backend
bunx convex env set MUTATION_RATE_LIMIT_RATE 1
bunx convex env set MUTATION_RATE_LIMIT_PERIOD 5000
bunx convex env set MUTATION_RATE_LIMIT_CAPACITY 1
```

**Test**: Sign in, open a project, and try creating/updating/deleting tasks rapidly (more than 1 action per 5 seconds). A red toast notification appears: "Too many requests. Please wait N seconds."

### Layer 3: Edge Proxy

Set in the app's `.env.local` file and restart the dev server:

```bash
# apps/web/.env.local
EDGE_RATE_LIMIT_WINDOW=5
EDGE_RATE_LIMIT_MAX=2
```

```bash
bun run dev:stop && bun run dev:web
```

**Test**: Rapidly refresh the page 3+ times within 5 seconds. You'll see a plain "Too Many Requests" response. The response headers include `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining`.

### Restoring Defaults

Remove the Convex environment variables (they fall back to code defaults):

```bash
cd packages/backend
bunx convex env unset AUTH_EMAIL_RATE_PER_MINUTE
bunx convex env unset AUTH_EMAIL_BURST
bunx convex env unset MUTATION_RATE_LIMIT_RATE
bunx convex env unset MUTATION_RATE_LIMIT_PERIOD
bunx convex env unset MUTATION_RATE_LIMIT_CAPACITY
```

For edge rate limiting, remove or comment out the overrides in `.env.local` and restart:

```bash
bun run dev:stop && bun run dev:web
```

> **Note**: Convex env var changes take effect immediately (no restart needed). Edge env var changes require a dev server restart.
