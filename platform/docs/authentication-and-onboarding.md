# Authentication & Onboarding Specification

This spec covers authentication, onboarding, and recovery for both **admin** and **regular user** accounts. Admins and users share the same underlying Better Auth infrastructure but have different security requirements, onboarding paths, and app boundaries.

---
## 2. Account Types and App Boundaries

| Property | Admin | User |
|---|---|---|
| App | Admin app | Web app |
| Sign-in URL | `admin-app/sign-in` | `web-app/sign-in` |
| Onboarding path | `admin-app/onboarding` (dedicated wizard) | `web-app/sign-up` (signup flow *is* onboarding) |
| How account is created | Bootstrap or admin invitation only | Self-signup (if enabled) or user invitation |
| Password required | Yes — see §5 | Yes — see §5 |
| 2FA (TOTP) | Required for invitation enrollment; subsequent access follows live MFA policy | Admin-configurable: optional or required |
| Passkey | According to `adminPasskeyPolicy` | According to `userPasskeyPolicy` |
| Magic link sign-in | Not available | Admin-configurable: enabled or disabled |
| Can access the other app | No | No |

**Enforcement:** The admin dashboard's server layout redirects bound, incomplete enrollment
to the wizard before checking the admin role; see §14 for the route checks. The web app
rejects sessions where `user.role === "admin"`.

## 3. Authentication Architecture

### 3.1 Account Foundation (all accounts)

Every account — admin or user — is created as an email+password credential account in Better Auth. This is driven by:

- **Technical requirement for admins:** `twoFactor.enable({ password })` and `getTotpUri({ password })` require a credential account. Without one, TOTP cannot be enabled at all.
- **Consistency for users:** Users also start with email+password. If the admin later enables magic link or the user adds a passkey, those are layered on top of the existing credential account.

### 3.2 Sign-in Methods by Account Type

#### Admin sign-in methods

| Method | TOTP required at login? | Notes |
|---|---|---|
| **Password** | **If enrolled or required by policy** | Password alone does not satisfy required strong proof |
| **Passkey** | **No** | Passkey is inherently two-factor (possession + biometric/PIN) |

No magic link option for admins.

#### User sign-in methods

| Method | TOTP required at login? | Notes |
|---|---|---|
| **Password** | **According to live factor policy (§8.5)** | Depends on admin policy + user choice |
| **Magic link** | **According to live factor policy (§8.5)** | Only available if admin has enabled magic link |
| **Passkey** | **No** | Passkey is inherently two-factor; TOTP is never required on top |

**Why no TOTP with passkey login (for either account type):** A passkey inherently provides two authentication factors — possession of the device/key and biometric verification or device PIN. Requiring TOTP on top of a passkey adds friction without meaningful security benefit. TOTP remains relevant for password and magic link logins, where the sign-in method is single-factor.

### 3.3 Admin-Controlled Security Policies for Users

Admins configure these from the admin app's security settings. All policies are stored in the `appSettings` table and read at request time.

| Setting | Key | Options | Default |
|---|---|---|---|
| Magic link sign-in | `userMagicLinkEnabled` | enabled / disabled | disabled |
| 2FA requirement | `userMfaRequired` | `false` (optional) / `true` (required) | `false` |
| Passkey | `userPasskeyPolicy` | disabled / optional / required | optional |

**How 2FA interacts with sign-in methods for users:**

- **`userMfaRequired: false`** — Users may enable 2FA from their security settings. Once enabled, password and magic-link sessions need strong factor verification.
- **`userMfaRequired: true`** — Sessions must verify a policy-eligible factor before accessing the app. Users without one see the shared enrollment gate. A user-verified passkey can satisfy this requirement without TOTP.

When a user enables 2FA (voluntarily or because it's mandatory), the same Better Auth `twoFactor.enable({ password })` flow applies — they enter their password to unlock TOTP setup.

## 5. Password Policy

Both admins and users must have passwords. The shared policy is defined in
[`platform/packages/auth/src/password-policy.ts`](../packages/auth/src/password-policy.ts):
`getMinPasswordLength` supplies the minimum for each account type and
`REQUIRED_PASSWORD_SCORE` supplies the required zxcvbn-ts score. The current values are:

| Rule | Admin | User |
|---|---|---|
| Minimum length | 40 characters | 12 characters |
| zxcvbn-ts score | 4 (maximum) | 4 (maximum) |
| Breached password check (HIBP) | Yes | Yes |
| Complexity requirements (uppercase, symbols, etc.) | None — per NIST SP 800-63B-4 | None |

## 6. Admin Onboarding Flow

### 6.0 Entry Points

There are exactly two ways to begin admin onboarding:

1. **Bootstrap** — the very first admin, created via the bootstrap process when no admins exist.
2. **Admin invitation** — an existing admin sends an invitation email to a single email address from the admin app.

There is no self-signup for admin accounts. The admin app's sign-up page does not exist — only the onboarding flow, which requires either a bootstrap token or a valid invitation link.

**Email ownership must be proved during account creation.** The wizard exchanges the invitation
for a random, single-use enrollment capability valid for at most ten minutes. It submits that
capability with the intended email, name and password. The backend validates password strength
and the breach check, then creates the verified credential account and consumes the invitation
in one transaction. The invitation is bound to the created user ID. Merely appearing in
`adminEmails`, opening the link, or exchanging it does not grant administrator privileges.

The new account initially has the ordinary `user` role. The backend grants `admin` only to
that bound user after verified TOTP enrollment, recovery-code acknowledgment, and a passkey
when admin policy requires one. Completion is checked on the server; skipping wizard pages
does not activate privileges. An interrupted enrollment resumes after password sign-in.
An expired capability can be exchanged again using the still-valid original invitation.
A lost registration response can be retried without creating a second account or changing its
password. No separate email-verification message is needed for this flow.

Custom clients use `claimInvitation` as a Convex action, submit its `capability` to the
`adminInvitations.register` action, then use normal password sign-in. Raw
`/api/auth/sign-up/email` rejects reserved administrator addresses. Neither token nor capability
belongs in application logs or persistent browser storage.

### 6.1 Invitation lifecycle

```
"invited"    → token sent, waiting for signup
"claimed"    → account created, onboarding in progress (onboardingStep tracks position)
"completed"  → all 4 steps done, full dashboard access
```

### 6.2 Abandonment & Resume

Admins who abandon the onboarding wizard at any point can resume later. The multi-step sign-in form already adapts to what the admin has set up (password only vs password+TOTP), so no changes are needed to the sign-in flow. The dashboard layout redirects incomplete admins to `/onboarding`, where the wizard queries the saved `onboardingStep` and resumes from there.

| Case | When abandoned | Invitation status | Auth state | How they return | Wizard resumes at |
|------|---------------|-------------------|------------|----------------|-------------------|
| A | Never opened link | `invited` | No account | Open invitation link | Step 0 (Create Account) |
| B | Opened link, closed before creating account | `invited` | No account | Open invitation link | Step 0 |
| C | Created account (Step 0 done) | `claimed`, step=1 | Password, no 2FA | Sign in: Email → Password | Step 1 (TOTP) — shows password prompt |
| D | Started TOTP, closed before verifying code | `claimed`, step=1 | Password, 2FA secret unverified | Sign in: Email → Password | Step 1 — calls `enable()` again with new secret |
| E | Verified TOTP (Step 1 done) | `claimed`, step=2 | Password + 2FA | Sign in: Email → Password → TOTP | Step 2 (Backup Codes) — asks for the current password before fetching codes |
| F | Saved backup codes (Step 2 done) | `claimed`, step=3 | Password + 2FA | Sign in: Email → Password → TOTP | Step 3 (Passkey) |
| G | Completed all steps | `completed` | Full setup | Sign in normally | No redirect — full dashboard access |
| H | Established legacy admin with no invitation record | None | Varies | Sign in normally | Existing account policy applies |

### 6.3 Admin onboarding steps

The wizard has four steps:

0. **Create account**: the email is pre-filled from the invitation and cannot be edited; the admin
   sets a name and a password, with a live strength meter.
1. **TOTP setup**: scan the QR code (or copy the manual key) and verify a 6-digit code. A resumed
   wizard asks for the password first.
2. **Backup codes**: download or copy them, confirm they are saved, and enter two of them.
3. **Passkey**: register one; skipping is available only when `adminPasskeyPolicy` is optional.
   If required and the browser does not support passkeys, resume in a supported browser.

Completing the wizard signs the admin out and sends them to `/sign-in` for a full login. Each
step writes an `admin.onboarding.*` audit event (§12).

## 7. User Sign-Up Flow (web app)

For users, sign-up *is* onboarding. Factor enrollment depends on the current user security policy.

### Onboarding ownership and landing handoff

The reference landing is a static export with dynamic browser features. It reads
`NEXT_PUBLIC_CONVEX_SITE_URL/api/waitlist/status` after hydration: `publicWaitlist`
shows the inline form, `publicSignup` offers localized web sign-up and sign-in links, and
`inviteOnly` offers sign-in only. Unknown modes fail closed. While loading it shows a
placeholder; backend failures show sign-in plus optional `NEXT_PUBLIC_BOOK_DEMO_URL` and
`NEXT_PUBLIC_CONTACT_URL` links. Requests time out after eight seconds and failed loads retry
with exponential backoff (5–60 seconds, at most ten retries), paused while hidden. Returning
to the tab refreshes the mode. Registration and waitlist mutations still enforce the current
mode at submission time. A missing or blank build-time Convex HTTP URL immediately shows the
same unavailable-backend links without fetching or retrying; the static page remains usable.

Landing also mounts `AnnouncementBannerHost` when `features.announcements` is enabled.
It polls `/api/announcements/active` every 15 seconds after each completed request, supports
CTA and details, remembers dismissal by announcement ID, and offsets the header/content.
With no build-time Convex HTTP URL, it renders no announcement and does not poll.
The landing needs no application server in production: both features execute in the browser.
Set its Convex HTTP URL at build time and allow its origin through Convex `LANDING_URL`.
`bun run dev:landing` starts the local backend and wires both URLs.

The reference web route uses `createSignUpView({ waitlistForm: AppWaitlistForm })` and
reads `CONVEX_SITE_URL/api/waitlist/status` uncached on every request. `publicSignup`
renders account creation; `publicWaitlist` renders the same app-owned form as landing,
without a cross-app navigation. Invite-only, unknown responses and backend failures stay closed.
The compatible `SignUpView` and `LandingSignUpView` entry points accept email inline too.

**App-owned forms:** customize `packages/onboarding/waitlist-form.tsx` once for both
landing and web. The reference questions are optional: email alone is sufficient.
The shared platform `WaitlistForm` owns submission, feedback and legal links; the app
owns questions and object-valued metadata. Posts go directly from the browser to Convex,
preserving per-visitor IP rate limits and backend validation. Web passes its request-time
Convex HTTP origin; landing's wrapper supplies build-time configuration through `PublicConfigProvider`.
The landing provider's unused `convexUrl` is empty because the form only needs the HTTP origin.

**Adoption:** upgrades preserve buyer-owned forms. Put your form in a shared app package,
import it from landing and compose web's route with `createSignUpView`. This composition
already exists in v3.1.0, so app-owned adoption needs no platform patch. Keep custom branding,
questions, locales and legal links. Add the workspace dependency and transpilation entry to
both apps. Keep landing's announcement host and browser mode selection. Configure landing's
`NEXT_PUBLIC_CONVEX_SITE_URL` at build time and allow its origin in Convex `LANDING_URL`.
No stored-answer migration is needed.

### 7.1 Step 1 — Create Account (email + password)

User enters their email and creates a password that meets the shared policy in §5.

On submit, Better Auth's `signUp.email()` creates the credential account and sends a verification email (if email verification is enabled by admin policy).

Server-authorized new-customer signup also provisions one
invisible personal organization with the customer as `org-admin`, without granting platform-admin
role or requiring administrator factor enrollment. Customer onboarding invitations remain new-customer
admission, not membership invitations. See [organization primitives and authority](architecture.md#organization-primitives-and-authority)
for durable admission, sign-in recovery, legacy/operator exclusions and current integration limits.

### Organization-member invitations are not customer signup

A member invitation joins an existing organization, rather than admitting a new customer.
Use the [invitation-bound admission API](architecture.md#invitation-bound-member-admission-api):
existing identities sign in and accept with verified recipient email; new identities register
through the bound capability, sign in, verify email and accept. Neither path creates a new
personal organization. Member acceptance requires email verification even when ordinary user
verification is optional. Invited administrators remain members pending scoped security setup;
this never grants platform-admin role or admin-app access. Public signup/waitlist tokens are
not organization join authority. Invitation management/browser UI and full tenant cutover are
not yet enabled by these additive APIs.

### 7.2 Step 2 — Verify Email (if required by admin policy)

If `userEmailVerificationRequired` is `true` (the default), the user must click the verification link before accessing the app. If disabled by admin, this step is skipped.

### 7.3 Optional: Magic Link Setup

If the admin has enabled magic link (`userMagicLinkEnabled: true`), the user can choose to sign in via magic link on subsequent logins. No additional setup is required — magic link uses the verified email.

### 7.4 Optional: 2FA Setup

The [user MFA policy](#33-admin-controlled-security-policies-for-users) determines whether
enrollment is optional or required. TOTP setup uses the same steps as admin enrollment (§6.3):
enter the current password, scan the QR code, verify a code and save backup codes. See
[session assurance](#85-session-assurance-and-reauthentication) for fresh verification requirements.

### 7.5 Optional: Passkey Registration

Passkey registration uses the same WebAuthn flow as admin enrollment. Its availability,
required enrollment and fresh-verification rules follow
[session assurance](#85-session-assurance-and-reauthentication); required enrollment is
presented by the [shared gate](#86-enrollment-recovery-and-custom-endpoints).

## 8. Login Flow (Multi-Step, Both Apps)

The login flow is a multi-step wizard. Each step is a distinct screen. Transitions between steps use a **horizontal slide animation** (next step slides in from the right, previous step slides out to the left; going back reverses the direction).

### 8.1 Step 1 — Email

Both apps start the same way: a single email input field.

```
┌──────────────────────────────────────────────────────┐
│  Sign in                                             │
│                                                      │
│  Email address                                       │
│  [_______________________________]                   │
│                                                      │
│  [Continue →]                                        │
└──────────────────────────────────────────────────────┘
```

On submit, the server looks up the account and determines what sign-in methods are available for this user. The response drives which step comes next.

### 8.2 Step 2 — Authentication Method (adaptive)

The next screen depends on what the account has configured. The server returns the user's available methods and their primary (preferred) method. The UI presents the primary method prominently, with alternatives as secondary links.

#### If passkey is the primary method:

```
┌──────────────────────────────────────────────────────┐
│  ← Back                                              │
│                                                      │
│  Sign in with passkey                                │
│                                                      │
│  [Use passkey]  ← triggers WebAuthn prompt           │
│                                                      │
│  Or: Sign in with password                           │
└──────────────────────────────────────────────────────┘
```

If the user clicks "Sign in with password", slide to the password step.

#### If password is the primary method (or only method):

```
┌──────────────────────────────────────────────────────┐
│  ← Back                                              │
│                                                      │
│  Enter your password                                 │
│                                                      │
│  [_______________________________]                   │
│                                                      │
│  [Sign in →]                                         │
│                                                      │
│  Or: Sign in with passkey  (if passkey is available) │
│  Or: Sign in with magic link  (if enabled, web only) │
│  Forgot password?                                    │
└──────────────────────────────────────────────────────┘
```

#### If magic link is the primary method (web app only, if enabled by admin):

```
┌──────────────────────────────────────────────────────┐
│  ← Back                                              │
│                                                      │
│  We sent a sign-in link to your email                │
│  Check your inbox and click the link to continue.    │
│                                                      │
│  Didn't receive it? [Resend]                         │
│                                                      │
│  Or: Sign in with password                           │
│  Or: Sign in with passkey  (if passkey is available) │
└──────────────────────────────────────────────────────┘
```

The magic link is sent automatically when this step loads — no extra button click needed.

**How "primary method" is determined:** The user's most recently used sign-in method, stored on their account record. Defaults to password for new accounts, passkey if a passkey has been registered, or magic link if the user last signed in that way. This is a UX preference, not a security gate — the user can always switch to any available method via the alternative links.

### 8.3 Step 3 — TOTP Verification (conditional)

This step appears only when:
- The user has 2FA enabled, **and**
- They signed in via password or magic link (not passkey)

Passkey sign-in skips this step entirely and goes straight to the authenticated redirect.

```
┌──────────────────────────────────────────────────────┐
│  ← Back                                              │
│                                                      │
│  Two-factor authentication                           │
│                                                      │
│  Enter the 6-digit code from your authenticator app  │
│                                                      │
│  [______]                                            │
│                                                      │
│  [Verify →]                                          │
│                                                      │
│  Lost your device? [Use a backup code]               │
└──────────────────────────────────────────────────────┘
```

If "Use a backup code" is clicked, the input switches to a backup code field.

### 8.4 Flow Summary by Account Type

#### Admin login paths:

```
Email → Passkey → ✓ Dashboard          (no TOTP — passkey is 2FA)
Email → Password → TOTP → ✓ Dashboard  (TOTP enrolled or MFA required)
```

Admins never see magic link as an option.

#### User login paths:

```
Email → Passkey → ✓ App                         (no TOTP — passkey is 2FA)
Email → Password → ✓ App                        (no 2FA enabled)
Email → Password → TOTP → ✓ App                 (2FA enabled)
Email → Magic Link → ✓ App                      (no 2FA enabled, magic link enabled)
Email → Magic Link → TOTP → ✓ App               (2FA enabled, magic link enabled)
```

These paths assume enrollment is complete and passkeys are optional. Required-passkey
policy adds current-session passkey verification before application access; see
[session assurance](#85-session-assurance-and-reauthentication).

### 8.5 Session assurance and reauthentication

Convex operations and Better Auth HTTP routes use the same live policy. A session must belong
to the exact authenticated user, be unexpired and unbanned, satisfy the current email-verification
and login-method settings, and complete any required enrollment. Enabling MFA on an account
is a requirement; it is not evidence that a particular session passed MFA.

Successful password or enabled user magic-link sign-in records primary authentication. Successful
TOTP verification or a cryptographically verified passkey assertion with **user verification**
(PIN/biometric) records strong authentication, bound to the current factor record. Removing or
replacing that factor invalidates its proof. A verified passkey satisfies MFA without requiring a
second TOTP entry. A `required` passkey policy additionally requires passkey authentication in the
current session; simply registering one is insufficient for ordinary application access.

Magic links honor `userMagicLinkEnabled` on both sending and redemption, and are unavailable for
administrators or bound administrator candidates. Email-OTP sign-in, social/account-token routes
and administrator impersonation are disabled because the platform has no supported flow for them.
Email verification and password-reset OTPs remain available. Email OTP and trusted-device cookies
do not supply strong session proof. An email-only session for an MFA account can verify its factor
but cannot read application data, administer users, or replace the factor.

Administrator sessions have a **four-hour absolute lifetime**, measured from authentication.
Routine refresh, password verification, password changes and factor-related session rotation,
including active-session email OTP enrollment, do
not restart that clock. A new full sign-in starts a new session. User sessions retain the normal
seven-day lifetime. Expired, revoked or banned sessions fail live backend checks, including calls
using an earlier Convex JWT. An already delivered response cannot be withdrawn from a client;
subsequent requests and reactive queries that rerun check the live policy again.

Administrative HTTP operations and platform administrative mutations, password/profile/factor
changes and recovery-code export require authentication within **five minutes**. When an enrolled
or required factor exists, that must be recent strong proof; a password alone cannot substitute.
Otherwise recent primary proof is sufficient. Recovery-code export additionally requires the
current password each time. Password and two-factor code verification consume the durable account budgets
described in [rate limiting](rate-limiting-architecture.md#default-limits).

The shared `SessionAccessGate` presents the backend decision and blocks ordinary content until
verification is complete. Security settings and the admin workspace prompt for fresh verification.
The timer also handles expiry without waiting for a database update. Session rotation briefly
preserves presentation state so successful setup does not discard unsaved backup codes; backend
checks still apply to every operation throughout that transition.

### 8.6 Enrollment, recovery and custom endpoints

A backup-code sign-in creates a **recovery-only session**. Use the current password to replace the
lost TOTP authenticator, verify a code from the replacement, and save the new backup codes.
Password verification by itself does not clear recovery status. Recovery does not authorize adding
passkeys, changing policy, exporting old recovery codes or accessing ordinary application data.
The session is bound to the replacement created by its successful current-password setup request;
verification of the original authenticator or a replacement created in another session does not
complete recovery. Setup can resume on that session while the bound factor remains current.
If a required passkey is also lost, an authorized administrator must adjust that policy or restore
access through the deployment's support process; the recovery code does not waive it.

Bound administrator candidates use only their invitation enrollment API and self-service factor
setup until completion. Resumed setup requests fresh verification when needed. The wizard retains
its progress and backup-code acknowledgement while the recipient verifies their identity.
Web and admin gates retain previously admitted setup state and unsaved backup codes in memory
through recent-proof expiry and token rotation, hiding protected content until access is restored.
Limited sessions do not mount ordinary protected consumers before their first admission.
Denied retained content is suspended with React Activity, including its portals and active
effects, so modal focus, pointer and scroll locks do not obstruct fresh verification. Authorized
content resumes with its in-memory state; no setup secrets are persisted in browser storage.

For app endpoints, use `authedQuery`, `authedMutation` or `getAuth` from
`packages/backend/convex/platform/functions.ts`. These enforce the full live policy. For app-owned
administrative writes, use `adminMutation`, which adds the admin-role and recent-proof checks.
Actions should authorize through an internal query using the same helper and recheck before
committing sensitive side effects. `auth.getCurrentUser` and `sessionAssurance.status` intentionally
return limited self-service identity/status and are **not authorization helpers**. Never authorize
application data by calling Better Auth's raw `getAuthUser`/`safeGetAuthUser` or by inspecting
account-level MFA flags. Browser-submitted assurance fields are ignored; only successful server
verification hooks write session proof. New Better Auth routes are denied until classified in the
central route policy and covered by behavioral tests.

Existing sessions without server-owned proof require password reauthentication (and any required
factor) or a new sign-in. Deploy the backend and matching auth UI together. Custom auth/enrollment
screens should use the status query and shared gate; they must keep recovery/enrollment state
separate from ordinary application access.

## 9. Admin Invitation Flow

### 9.1 Sending Invitations

From the admin app's **Manage > Onboarding** page (Admins tab), an admin clicks "Invite Admin". This opens a form with a **single email address field** (not multi-email like user invitations).

The `invite` mutation:
1. Validates the email and rejects existing accounts and bound claimed/completed invitations; expired invitations and legacy unbound claims may be re-invited
2. Creates or updates the `adminInvitations` row with `status: "invited"`
3. Writes audit event: `admin.invitation.sent` with `meta: { inviteeEmail }`
4. Schedules an `internalAction` (`adminInvitationActions.generateTokenAndSendEmail`) which:
   - Generates a 32-byte crypto-random token (64 hex chars)
   - Stores only the token's SHA-256 hash + expiry (default 7 days, configurable via `invitationTokenExpiryDays` in `appSettings`) on the invitation row
   - Builds onboarding URL: `{ADMIN_SITE_URL}/onboarding?token={token}` (`ADMIN_SITE_URL` is required)
   - Sends an HTML email via Resend (or, in local development only, logs the URL to the console when no `RESEND_API_KEY` is set; elsewhere a missing key throws `EMAIL_DELIVERY_NOT_CONFIGURED`)

Authentication emails (`sendAuthEmail`) and both admin and user invitation actions
throw when Resend returns an API or transport error. For invitations, the email
request occurs after the invite mutation and token storage have committed: its failure
does not roll them back. An invitation row or `admin.invitation.sent` audit event
therefore does not confirm delivery. Local fake-transport regression coverage lives
in `packages/backend/convex/platform/emailTransport.test.ts`; it does not verify inbox delivery.

### 9.2 Accepting an Admin Invitation

The link opens the bound enrollment flow in §6. Previously issued bootstrap links on the
web app redirect to that flow while still valid, including links left in `claiming` state
before account creation.

### 9.4 User Invitations (comparison)

User invitations are sent from **Manage > Onboarding** (Users tab) and allow **multiple email addresses**. The invitation link points to `/signup-with-invitation?token=<invitation-token>` on the first origin in `SITE_URL` and is only valid for the web app. User invitations follow the user sign-up flow (§7).

### Waitlist metadata contract

Apps own their waitlist questions and answer schema. Send a JSON object serialized as the
existing `meta` **string** to `POST /api/waitlist/join`:

```ts
const body = JSON.stringify({
  email: "buyer@example.test",
  meta: JSON.stringify({ teamSize: 5, interests: ["reporting"] }),
});
// No questions: meta: "{}"
```

The platform accepts any JSON object within these safety constraints:

- Maximum **16,384 UTF-8 bytes (16 KiB), inclusive**, measured on the metadata string,
  including JSON syntax, whitespace and escapes, before parsing. This is not a character
  count; clients can measure with `new TextEncoder().encode(meta).byteLength`.
- The root must be an object, not an array, null, string, number or boolean. Nested JSON
  objects, arrays and scalar values are allowed. Malformed JSON is rejected.
- Keys named `__proto__`, `constructor` or `prototype` are rejected at every nesting
  level, including inside arrays and when written with JSON Unicode escapes. These words
  are allowed as string values. Validation uses an iterative walk bounded by the byte cap;
  there is no additional question-count or nesting-depth limit.

The original string is stored unchanged. For compatibility the HTTP endpoint also accepts
an object-valued `meta` (serialized before validation), and omitted `meta` becomes `"{}"`.
Invalid metadata returns HTTP 400 with `{ error: "INVALID_META" }`; malformed request bodies
return `INVALID_REQUEST`. Error responses contain fixed codes, never submitted metadata or
internal diagnostics. Email syntax uses the same policy as bulk invitations (a non-whitespace
local part, one @,
and a domain with a dot); malformed addresses such as `anna@` return `INVALID_EMAIL`. The
shared join mutation normalizes case/whitespace before lookup. Onboarding restrictions, deduplication
and per-visitor rate limits still apply. Joining again does not replace stored answers.

The shared reference form in `packages/onboarding/waitlist-form.tsx` offers optional
superpowers, excitement, role, company (120 characters) and use case
(500 characters). These are sample-app choices, not platform-required fields. Change or
remove them in your app and keep their translations in `packages/messages/`. The platform
validates the transport and safety boundary, not your business rules; if answers drive
trusted decisions, validate them in app-owned server code before using them. Treat stored
metadata as untrusted and do not merge it into configuration or render it as HTML.

Admin retains the sample columns when their values have the expected types. Missing or
incompatible values display a dash; a **Metadata → View metadata** cell shows the original
JSON as escaped text, including custom fields. Older malformed rows cannot crash these
cells. This change requires no migration, configuration change or mandatory app action;
existing sample submissions and stored rows continue to work.

## 10. Admin App — Manage Section

The existing **Manage > Onboarding** page gains a tab bar to split between Users and Admins. This is not two separate sidebar entries — it is one page with two tabs. The existing users table is reused, just filtered by role.

### Manage > Onboarding — Users tab

The default tab. Shows a table of all user accounts (where `role !== "admin"`). This is the existing users table, filtered to exclude admins. Provides:
- Search and filter
- View user details, status, last login
- Ban/unban users
- **"Invite Users"** button — multi-email input
- View user's 2FA status, passkey status

### Manage > Onboarding — Admins tab

Shows a table of all admin accounts (where `role === "admin"`). Same table component as the Users tab, filtered for admins. Provides:
- View admin details, status, last login, onboarding completion status
- Ban/unban admins (with protection: admins in the `adminEmails` bootstrap table cannot be banned)
- **"Invite Admin"** button — single email address input
- View admin's 2FA status, passkey status, backup code usage

## 11. Recovery Scenarios

### 11.1 Admin Recovery

#### Lost TOTP device, backup codes available

1. Admin clicks "Use a backup code" on the TOTP prompt (password login only)
2. Enters one of their backup codes
3. Better Auth validates and marks the code as used
4. A recovery-only session is issued; ordinary dashboard data remains inaccessible
5. The shared gate requires the current password to replace TOTP, followed by verification of
   the new authenticator and acknowledgement of its backup codes
6. Normal access resumes after successful replacement and verification, subject to current policy

#### Lost TOTP device, no backup codes, email still accessible

Email password reset does not bypass TOTP or authenticate the administrator. Use a previously
registered trusted passkey if available; otherwise follow the separately authenticated
deployment operator's recovery process described under
[account containment](#containing-a-suspected-account-compromise). Factor recovery is a
break-glass action, not an email-only shortcut into the dashboard.

#### Email compromised, password + TOTP still available

1. Admin signs in with email + password + TOTP (no email access needed)
2. Another admin creates a replacement admin account with a new email
3. Original account disabled: `isBanned: true`, `bannedReason: "Email compromised — replaced by [new email]"`
4. Original record retained for audit trail integrity
5. Write audit events: `admin.account.disabled`, `admin.account.created`

#### Total lockout

Use a separately authenticated deployment operator to verify ownership and recover access;
the platform does not provide an email-only factor bypass or a turnkey emergency-reset script.
Follow [account containment](#containing-a-suspected-account-compromise) for evidence
preservation and replacement of untrusted credentials.

### 11.2 User Recovery

#### Lost TOTP device (if 2FA was enabled)

Use a backup code or a previously registered trusted passkey. If neither is available, follow
[account containment](#containing-a-suspected-account-compromise); password reset alone does
not recover a lost second factor.

#### Forgot password

Admins and users reset passwords through a Better Auth email link. Reset requests
include an absolute return URL: admin requests return to the admin app, while web
requests retain the requesting origin and selected locale.

The reset forms do not request TOTP verification before replacing the password.
The reset token identifies the account; the backend resolves its email and account
type so strength feedback uses the same context and policy as Settings/Security,
including when an admin token is opened in the web reset form. Invalid or expired
tokens cannot fall back to a client-provided policy. The backend also enforces the
password policy when the reset is submitted and returns an actionable error for a
weak password.

On success, the form keeps its confirmation visible when consuming the token
invalidates the strength query, then directs the user to sign in. Password reset
revokes all existing sessions, including the resetting browser's session. Convex checks the
session record on each authorized query/mutation and actions recheck before disclosing recovery
secrets, so an unexpired Convex JWT does not preserve access after its session is deleted.
Open subscriptions lose authorization on reevaluation. Work already committed before revocation
cannot be undone. The user signs in again with the new password and any existing second factor;
reset does not disable that factor or silently remove passkeys.

#### Viewing and replacing recovery codes

Viewing codes in web/admin settings requires the current password on **every** request. Both
initial and resumed administrator enrollment prompt for the current password at the backup-code
step. The wizard does not retain the codes returned when TOTP is enabled, and TOTP verification
does not return codes, so that step loads them with fresh password proof. Regeneration and TOTP
enrollment also verify the current password through Better Auth. The export and account
verification budgets, including failed-attempt accounting, are defined in
[rate limiting](rate-limiting-architecture.md#default-limits).

Custom clients call `api.platform.auth.viewBackupCodes({ password })` over authenticated Convex,
or `POST /api/two-factor/backup-codes` with authenticated headers and JSON `{ "password": "..." }`.
The old GET helper returns 405 and never returns codes. Do not put passwords in URLs, logs or
persistent browser storage. Use the provided settings components to get the prompt automatically.

#### Containing a suspected account compromise

1. From a trusted device, preserve the relevant audit events and timestamps before making changes.
   Protect an exported copy independently of the affected account. Identify unfamiliar sign-ins,
   password changes, passkeys and factor changes; do not copy live credentials into the incident log.
2. Complete a password reset through the verified mailbox. Successful reset revokes every existing
   session. If the mailbox is compromised, secure it first and use a separately authenticated
   deployment operator to restrict the account while ownership is verified.
3. Sign in again and inspect Security → Passkeys. Remove unfamiliar credentials, or all existing
   passkeys if their provenance cannot be established, then register replacements on trusted devices.
   Reset alone does **not** revoke passkeys or rotate the TOTP seed/recovery codes.
4. Replace a suspected TOTP secret by disabling and reenabling TOTP with the current password,
   verify the new authenticator and save the new recovery set. Otherwise regenerate backup codes;
   this invalidates the entire previous set. Keep another verified administrator available when
   repairing an administrator's factors. If no trusted sign-in factor remains, use the separately
   authenticated deployment operator's recovery process; do not disable verification for everyone.
5. Revoke other sessions once more after factor cleanup, check the audit trail for activity during
   recovery, and verify the owner's new sign-in works while old sessions and recovery codes fail.
   Record the actions and retain the evidence according to the application's incident policy.

Do not rotate `BETTER_AUTH_SECRET` as an ordinary account-reset operation. It encrypts factor
material as well as protecting authentication state; any deployment-wide rotation needs a planned
migration/re-enrollment procedure and independent evidence preservation.

#### Account issues

Users contact support or an admin. Admins can ban/unban users, trigger password resets, or clear 2FA state from the admin app.

## 12. Audit Trail Integration

All onboarding, login, and recovery events are recorded in the `auditTrail` table using `scheduleAuditEvent()` or `runAuditEvent()`.

### Admin Events

| Event | Action | Notes |
|---|---|---|
| Invitation sent | `admin.invitation.sent` | `meta: { invitedEmail, invitedBy }` |
| Onboarding: account created | `admin.onboarding.account_created` | |
| Onboarding: TOTP configured | `admin.onboarding.totp_configured` | |
| Onboarding: backup codes acknowledged | `admin.onboarding.backup_codes_acknowledged` | |
| Onboarding: passkey registered | `admin.onboarding.passkey_registered` | Optional step |
| Onboarding: passkey skipped | `admin.onboarding.passkey_skipped` | Admin chose "Skip for now" |
| Onboarding: completed | `admin.onboarding.completed` | |
| Login: via passkey | `admin.auth.sign_in` | `meta: { method: "passkey" }` |
| Login: via password+TOTP | `admin.auth.sign_in` | `meta: { method: "password" }` |
| Recovery: backup code used | `admin.recovery.backup_code_used` | |
| Recovery: email bypass | `admin.recovery.email_bypass_used` | Include IP |
| Account disabled | `admin.account.disabled` | `reason` field |
| Account created | `admin.account.created` | |
| Emergency reset | `admin.emergency_reset.executed` | `meta: { initiatedVia }` |

### User Events

| Event | Action | Notes |
|---|---|---|
| Sign-up | `user.auth.sign_up` | |
| Login: via password | `user.auth.sign_in` | `meta: { method: "password" }` |
| Login: via magic link | `user.auth.sign_in` | `meta: { method: "magic_link" }` |
| Login: via passkey | `user.auth.sign_in` | `meta: { method: "passkey" }` |
| 2FA enabled | `user.security.totp_enabled` | |
| 2FA disabled | `user.security.totp_disabled` | |
| Passkey registered | `user.security.passkey_registered` | |
| Recovery: backup code used | `user.recovery.backup_code_used` | |
| Password reset | `user.auth.password_reset` | |

## 13. Onboarding Copy

### Admin Onboarding Intro

> **Before you begin, understand these three things:**
>
> **1. Your email is permanent.** Better Auth ties your admin identity to your email address. It cannot be changed. If your email is compromised, you'll need a new admin account.
>
> **2. You'll create a password for setup purposes.** Two-factor authentication requires a password to activate. You'll store it in your password manager and may never type it again — but it must exist. After setup, you can sign in with a passkey instead.
>
> **3. Save your backup codes.** You'll receive single-use recovery codes. Store them somewhere safe — a password manager entry, a printed page, a secure note. They are your recovery path if everything else fails.

### User Sign-Up

The sign-up form asks for email and password (with strength meter). Subsequent factor setup
follows the [user security policy](#33-admin-controlled-security-policies-for-users) and
[shared enrollment gate](#86-enrollment-recovery-and-custom-endpoints).

## 14. Route Middleware

### Admin App

The admin app uses three route groups with different auth levels:

**`(auth)` group** — guest-only pages (sign-in, forgot-password). Wrapped in `GuestGuard` which redirects authenticated users to `/dashboard`.

**`(onboarding)` group** — the onboarding wizard. No `AuthGuard` or `GuestGuard` — it handles both unauthenticated (fresh invite with token) and authenticated (resume after abandonment) sessions. Only applies `ForceSystemTheme`.

**`(dashboard)` group** — all protected admin pages. The server-side layout enforces:

```
1. Valid Better Auth session exists                       → else redirect to /api/auth/clear-session
2. No incomplete onboarding returned by getMyOnboardingStatus → else redirect to /onboarding
3. user.role === "admin"                                  → else redirect to /api/auth/clear-session
4. user.banned !== true                                   → else redirect to /forbidden
```

Step 2 resolves enrollment by email and bound user ID, so the pending account can resume
while it still has the `user` role. Established legacy administrators retain the invitation
status fallback; no invitation record returns `{ completed: true }`. A user with no bound
enrollment receives `null` and still must pass the role check. The enrollment completion
requirements are defined in §6; the layout uses that saved result.

### Web App

See [route protection](architecture.md#route-protection-authentication) for the proxy,
server layout and client guard. Enrollment and email/factor verification are presented by
the shared gate under the [live session policy](#85-session-assurance-and-reauthentication).

### Agent authorization sessions

The optional auth-only hostname for MCP, CLI and A2A issues server-owned `mcp-authorization`
sessions. These use the existing users, authentication methods and assurance rules, but cannot access ordinary
admin Convex functions or administrative Better Auth APIs. Input cannot select or change the
purpose, and verification/rotation preserves it. Ordinary browser sessions retain their current
application purpose. For consent scope, verification prerequisites and delegation lifetime, see
[admin agentic surfaces](agentic-announcements.md#enable-and-authenticate); for hostname setup,
see [deployment steps](deployment-runbook.md#optional-mcp-authorization-origin).
