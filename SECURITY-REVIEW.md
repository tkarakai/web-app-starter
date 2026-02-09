# Security Review: Web & Admin Apps

**Date:** 2026-02-09
**Scope:** `apps/web/`, `apps/admin/`, `packages/backend/`, `packages/auth/`

---

## Executive Summary

The codebase demonstrates strong security fundamentals: three-layer authentication, nonce-based CSP, multi-layer rate limiting, and proper access control patterns. This review identified **1 high-severity issue**, **6 medium-severity issues**, and several low-severity improvements.

**Overall Security Posture: GOOD** - No critical vulnerabilities found; recommended fixes are primarily defense-in-depth improvements.

---

## Findings

### HIGH SEVERITY

#### H1. Admin email list exposed to all authenticated users

**File:** `packages/backend/convex/adminEmails.ts:15-27`

The `listProtected` query returns admin email addresses to **any authenticated user**, not just admins. This leaks PII and could facilitate targeted phishing or social engineering against admin accounts.

```typescript
// Current: any authenticated user sees admin emails
export const listProtected = query({
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) return [];
    const rows = await ctx.db.query("adminEmails").collect();
    return rows.map((r) => r.email);
  },
});
```

**Recommendation:** Restrict to admin role:
```typescript
const user = await authComponent.getAuthUser(ctx);
if (!user || user.role !== "admin") return [];
```

---

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

#### M2. Admin app missing edge rate limiting

**File:** `apps/admin/src/proxy.ts`

The web app implements edge-level rate limiting via `checkEdgeRateLimit()` but the admin app proxy has no rate limiting at all. While Better Auth and Convex layers provide backend protection, the admin app is unprotected against rapid-fire page requests at the edge.

**Recommendation:** Add the same `checkEdgeRateLimit` implementation used in the web app.

#### M3. File upload name not sanitized

**File:** `packages/backend/convex/files.ts:17`

The `saveUpload` mutation accepts `name: v.string()` with no length limit or content validation. This could allow path traversal sequences, XSS payloads in filenames (if displayed unsanitized), or extremely long strings causing database bloat.

**Recommendation:** Validate the name field:
- Enforce a max length (e.g., 255 characters)
- Strip or reject path traversal sequences (`../`, `..\\`)
- Optionally restrict to a safe character set

#### M4. User profile `theme` and `timezone` fields not validated

**File:** `packages/backend/convex/userProfiles.ts:42-44`

The `upsert` mutation validates `locale` against a whitelist but accepts any string for `theme` and `timezone`. If rendered unsanitized in HTML attributes, `theme` could contain XSS payloads.

```typescript
args: {
  locale: v.optional(v.string()),   // Validated against locales whitelist
  theme: v.optional(v.string()),    // No validation
  timezone: v.optional(v.string()), // No validation
},
```

**Recommendation:**
- Validate `theme` against `["light", "dark", "system"]`
- Validate `timezone` against IANA timezone identifiers
- Add max length constraints on all string fields

#### M5. Email verification disabled

**File:** `packages/backend/convex/auth.ts`

```typescript
emailAndPassword: {
  enabled: true,
  requireEmailVerification: false,
},
```

Users can sign up with any email address without verification, enabling account creation with spoofed emails (e.g., impersonating admin accounts). Combined with the auto-admin assignment in `databaseHooks.user.create.before`, an attacker who knows an admin email could attempt to register with it.

**Recommendation:** Enable email verification (`requireEmailVerification: true`) and implement a confirmation flow. At minimum, prevent signup with email addresses already present in the `adminEmails` table.

#### M6. Admin role check uses type assertion bypass

**File:** `apps/admin/src/app/(dashboard)/layout.tsx:25`

```typescript
if (!preloadedUser || (preloadedUser as any).role !== "admin") {
```

The `as any` assertion bypasses TypeScript's type system. If the API response shape changes and `role` is moved or renamed, this check would silently pass, granting unauthorized dashboard access.

**Recommendation:** Properly type the preloaded user or add runtime validation.

---

### LOW SEVERITY

#### L1. Missing `X-XSS-Protection` header

**Files:** `apps/web/next.config.ts`, `apps/admin/next.config.ts`

While the nonce-based CSP provides strong XSS protection, adding the legacy `X-XSS-Protection: 1; mode=block` header provides defense-in-depth for older browsers at no cost.

#### L2. `style-src 'unsafe-inline'` in CSP

**Files:** `apps/web/src/proxy.ts:64`, `apps/admin/src/proxy.ts:64`

Both apps allow inline styles. This is a known trade-off required by Tailwind CSS v4 and is mitigated by the strict CSP on scripts. Document as an accepted risk.

#### L3. Edge rate limiter is per-instance only

**File:** `apps/web/src/lib/edge-rate-limit.ts`

In-memory rate limiting is not shared across serverless instances. A distributed attack could bypass edge limits. This is mitigated by the persistent Better Auth and Convex rate limiting layers and is already documented in `RATE-LIMITING.md`.

#### L4. No file type whitelist on uploads

**File:** `packages/backend/convex/files.ts`

The `saveUpload` mutation validates file size but not content type. Executable files, HTML/SVG files with embedded scripts, etc. could be uploaded. Add a content-type whitelist based on the application's needs.

#### L5. Missing `Cache-Control` on session clear endpoint

**Files:** `apps/web/src/app/api/auth/clear-session/route.ts`, `apps/admin/src/app/api/auth/clear-session/route.ts`

The clear-session endpoint doesn't set `Cache-Control: no-store` headers, meaning the response could be cached by browsers or intermediate proxies.

#### L6. No string length limits on database fields

**Files:** `packages/backend/convex/projects.ts`, `packages/backend/convex/tasks.ts`

The `name`, `description`, and `title` fields in projects and tasks mutations accept strings of unlimited length. This could cause database bloat or performance degradation. Add reasonable max-length constraints.

#### L7. IP extraction trusts `X-Forwarded-For` without proxy validation

**File:** `apps/web/src/proxy.ts`

The `getClientIp` function reads from `x-forwarded-for` directly. This is safe on trusted infrastructure (Vercel, Netlify) but should be documented as a deployment requirement.

---

## Strengths

The codebase has several notable security strengths:

| Area | Implementation | Assessment |
|------|----------------|------------|
| **Authentication** | Three-layer system (Proxy, Layout, Client AuthGuard) | Excellent |
| **CSP** | Nonce-based with `strict-dynamic`, `frame-ancestors 'none'` | Strong |
| **Security Headers** | HSTS (2yr), X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy | Comprehensive |
| **Rate Limiting** | Three layers: Edge (per-IP), Better Auth (per-endpoint), Convex (per-user) | Well-designed |
| **Access Control** | `authedQuery`/`authedMutation` wrappers, `requireProjectAccess()` | Consistent |
| **Session Management** | HttpOnly cookies (Better Auth), multi-tab sync via BroadcastChannel | Solid |
| **Admin Protection** | Protected admin plugin prevents modification of admin accounts | Good |
| **CI Security** | CodeQL, dependency audit, TruffleHog secrets scanning, license compliance | Thorough |
| **Dependencies** | Zero known vulnerabilities (`bun audit`) | Clean |
| **File Uploads** | Server-side size validation, metadata from storage (not client) | Proper |
| **Redirect Safety** | All redirects use hardcoded paths, no user input in redirect URLs | Secure |

---

## Recommended Priority

| Priority | Issue | Effort |
|----------|-------|--------|
| **Fix now** | H1: Admin emails exposed to all users | Small |
| **Fix soon** | M1: Auth error enumeration | Small |
| **Fix soon** | M2: Admin edge rate limiting | Small |
| **Fix soon** | M5: Email verification disabled | Medium |
| **Harden** | M3: File upload name validation | Small |
| **Harden** | M4: Theme/timezone validation | Small |
| **Harden** | M6: Admin type assertion | Small |
| **Improve** | L1-L7: Low severity items | Small each |
