# Security Review: Web & Admin Apps

**Date:** 2026-02-09 (updated after merging latest main)
**Scope:** `apps/web/`, `apps/admin/`, `packages/backend/`, `packages/auth/`, `packages/edge-rate-limit/`

---

## Executive Summary

The codebase demonstrates strong security fundamentals: three-layer authentication, nonce-based CSP, multi-layer rate limiting, and proper access control patterns. Several issues from the initial review have been fixed in the latest main (see [Resolved Findings](#resolved-findings)). The remaining open findings are **2 medium-severity** and **5 low-severity** issues.

**Overall Security Posture: STRONG** - No high or critical vulnerabilities remain. Open issues are defense-in-depth improvements.

---

## Resolved Findings

The following issues from the initial review have been addressed in the latest main:

| Original ID | Issue | Resolution |
|-------------|-------|------------|
| ~~H1~~ | Admin emails exposed to all authenticated users | **Fixed.** `adminEmails.listProtected` now checks `role !== "admin"` before returning emails (`adminEmails.ts:26-28`) |
| ~~M2~~ | Admin app missing edge rate limiting | **Fixed.** Admin proxy now imports from shared `@repo/edge-rate-limit` package and applies `checkEdgeRateLimit()` with 100 req/60s (`admin/src/proxy.ts:12-31`) |
| ~~M3~~ | File upload name not sanitized | **Fixed.** `saveUpload` now calls `assertMaxLength(args.name, MAX_NAME_LENGTH, "NAME")` (`files.ts:28`) |
| ~~M4~~ | User profile theme/timezone not validated | **Fixed.** `theme` validated against `["light", "dark", "system"]` allowlist; `timezone` validated with `assertMaxLength(..., 64)` (`userProfiles.ts:5-6, 52-58`) |
| ~~L6~~ | No string length limits on database fields | **Fixed.** `assertMaxLength` with `MAX_NAME_LENGTH` (255) and `MAX_DESCRIPTION_LENGTH` (5000) enforced in `projects.ts:68-69`, `tasks.ts:38-39`, and `files.ts:28` |

Additionally, the edge rate limiting code was extracted into a shared `@repo/edge-rate-limit` package, eliminating duplication and ensuring consistent behavior across all apps.

---

## Open Findings

### MEDIUM SEVERITY

#### M1. Auth error messages enable email enumeration

**File:** `apps/web/src/components/auth/auth-form.tsx:28-33`

The `formatAuthError` function passes through server error messages (e.g., "User not found" or "User already exists"), which can reveal whether an email address is registered.

```typescript
function formatAuthError(error: { status?: number; message?: string }): string {
  if (error.status === 429) {
    return "Too many attempts. Please wait a moment before trying again.";
  }
  return error.message ?? "An error occurred"; // Leaks server details
}
```

**Recommendation:** Return a generic message for all auth failures:
```typescript
if (error.status === 429) {
  return "Too many attempts. Please wait a moment before trying again.";
}
return "Invalid email or password";
```

#### M5. Email verification disabled

**File:** `packages/backend/convex/auth.ts:107-113`

```typescript
// TODO [SECURITY]: Set requireEmailVerification: true once an email provider
// (Resend, SendGrid, etc.) is configured with a sendVerificationEmail handler.
requireEmailVerification: false,
```

Users can sign up with any email address without verification. Combined with the auto-admin assignment in `databaseHooks.user.create.before`, an attacker who knows an admin email could register with it and get promoted to admin. The risk is now **partially mitigated** because the admin email list is restricted to admin-only access (`listProtected` fix) and sign-up is rate-limited to 5/60s, but email verification remains the proper fix.

**Recommendation:** Enable email verification once an email provider is configured. As an interim measure, consider checking the `adminEmails` table in the `user.create.before` hook and rejecting sign-up attempts that would duplicate an existing admin email.

#### M6. Admin role check uses type assertion bypass

**File:** `apps/admin/src/app/(dashboard)/layout.tsx:25`

```typescript
if (!preloadedUser || (preloadedUser as any).role !== "admin") {
```

The `as any` assertion bypasses TypeScript's type system. If the API response shape changes (e.g., `role` renamed or moved to a nested object), this check would silently pass `undefined !== "admin"` and correctly deny access in this specific case. However, the use of `as any` circumvents compile-time safety on a security-critical code path.

**Recommendation:** Properly type the preloaded user or add explicit runtime validation:
```typescript
const role = typeof preloadedUser === "object" && preloadedUser !== null
  ? (preloadedUser as Record<string, unknown>).role
  : undefined;
if (role !== "admin") { redirect("/api/auth/clear-session"); }
```

---

### LOW SEVERITY

#### L1. Missing `X-XSS-Protection` header

**Files:** `apps/web/next.config.ts`, `apps/admin/next.config.ts`

While the nonce-based CSP provides strong XSS protection, adding the legacy `X-XSS-Protection: 0` header (to explicitly disable the browser's buggy XSS auditor in favor of CSP) is the modern recommendation. Some older references suggest `1; mode=block`, but current OWASP guidance recommends `0` when a strong CSP is in place, because the auditor itself can introduce vulnerabilities.

#### L2. `style-src 'unsafe-inline'` in CSP

**Files:** `apps/web/src/proxy.ts:134`, `apps/admin/src/proxy.ts:64`

Both apps allow inline styles. This is a known trade-off required by Tailwind CSS v4 and is mitigated by the strict CSP on scripts. Document as an accepted risk.

#### L3. Edge rate limiter is per-instance only

**File:** `packages/edge-rate-limit/src/index.ts`

In-memory rate limiting is not shared across serverless instances. A distributed attack could bypass edge limits. This is mitigated by the persistent Better Auth and Convex rate limiting layers and is already documented in `RATE-LIMITING.md`.

#### L4. No file type whitelist on uploads

**File:** `packages/backend/convex/files.ts`

The `saveUpload` mutation validates file size and name length but not content type. Executable files, HTML/SVG files with embedded scripts, etc. could be uploaded. Add a content-type whitelist based on the application's needs.

#### L5. Missing `Cache-Control` on session clear endpoint

**Files:** `apps/web/src/app/api/auth/clear-session/route.ts`, `apps/admin/src/app/api/auth/clear-session/route.ts`

The clear-session endpoint doesn't set `Cache-Control: no-store` headers, meaning the response could be cached by browsers or intermediate proxies.

---

## Strengths

The codebase has several notable security strengths:

| Area | Implementation | Assessment |
|------|----------------|------------|
| **Authentication** | Three-layer system (Proxy, Layout, Client AuthGuard) | Excellent |
| **CSP** | Nonce-based with `strict-dynamic`, `frame-ancestors 'none'` | Strong |
| **Security Headers** | HSTS (2yr), X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy | Comprehensive |
| **Rate Limiting** | Three layers: Edge (per-IP), Better Auth (per-endpoint), Convex (per-user) | Well-designed |
| **Edge Rate Limiting** | Shared `@repo/edge-rate-limit` package used by all apps; fail-closed; configurable via env vars | Consistent |
| **Access Control** | `authedQuery`/`authedMutation` wrappers, `requireProjectAccess()` | Consistent |
| **Input Validation** | `assertMaxLength` utility enforced across all string fields in mutations | Thorough |
| **Session Management** | HttpOnly cookies (Better Auth), multi-tab sync via BroadcastChannel | Solid |
| **Admin Protection** | Protected admin plugin prevents modification of admin accounts; admin email list restricted to admins | Strong |
| **CI Security** | CodeQL, dependency audit, TruffleHog secrets scanning, license compliance | Thorough |
| **Dependencies** | Zero known vulnerabilities (`bun audit`) | Clean |
| **File Uploads** | Server-side size validation, name length validation, metadata from storage (not client) | Proper |
| **Redirect Safety** | All redirects use hardcoded paths, no user input in redirect URLs | Secure |

---

## Recommended Priority

| Priority | Issue | Effort |
|----------|-------|--------|
| **Fix soon** | M1: Auth error enumeration | Small |
| **Fix soon** | M5: Email verification disabled | Medium (requires email provider) |
| **Harden** | M6: Admin role type assertion | Small |
| **Improve** | L1: X-XSS-Protection header | Trivial |
| **Improve** | L4: File type whitelist | Small |
| **Improve** | L5: Cache-Control on clear-session | Trivial |
| **Accept** | L2: style-src unsafe-inline (Tailwind) | N/A - documented trade-off |
| **Accept** | L3: Per-instance edge rate limiter | N/A - mitigated by backend layers |
