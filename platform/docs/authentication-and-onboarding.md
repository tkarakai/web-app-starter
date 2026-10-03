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
| 2FA (TOTP) | Mandatory — cannot access dashboard without it | Admin-configurable: optional or mandatory |
| Passkey | Required or optional according to `adminPasskeyPolicy` | Optional (if enabled by admin) |
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
| **Password** | **Yes** | Password alone is single-factor; TOTP covers phishing/keylogging |
| **Passkey** | **No** | Passkey is inherently two-factor (possession + biometric/PIN) |

No magic link option for admins.

#### User sign-in methods

| Method | TOTP required at login? | Notes |
|---|---|---|
| **Password** | **If 2FA is enabled for the user** | Depends on admin policy + user choice |
| **Magic link** | **If 2FA is enabled for the user** | Only available if admin has enabled magic link |
| **Passkey** | **No** | Passkey is inherently two-factor; TOTP is never required on top |

**Why no TOTP with passkey login (for either account type):** A passkey inherently provides two authentication factors — possession of the device/key and biometric verification or device PIN. Requiring TOTP on top of a passkey adds friction without meaningful security benefit. TOTP remains relevant for password and magic link logins, where the sign-in method is single-factor.

### 3.3 Admin-Controlled Security Policies for Users

Admins configure these from the admin app's security settings. All policies are stored in the `appSettings` table and read at request time.

| Setting | Key | Options | Default |
|---|---|---|---|
| Magic link sign-in | `userMagicLinkEnabled` | enabled / disabled | disabled |
| 2FA requirement | `userMfaRequired` | optional / mandatory | optional |
| Passkey | `userPasskeyPolicy` | disabled / optional | optional |

**How 2FA interacts with sign-in methods for users:**

- **`userMfaRequired: "optional"`** — Users may enable 2FA from their security settings. If they do, TOTP is required at password and magic link login. Passkey login never requires TOTP.
- **`userMfaRequired: "mandatory"`** — All users must enable 2FA. Users who haven't are redirected to a 2FA setup flow before accessing the app. TOTP is required at password and magic link login. Passkey login still does not require TOTP.

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
| E | Verified TOTP (Step 1 done) | `claimed`, step=2 | Password + 2FA | Sign in: Email → Password → TOTP | Step 2 (Backup Codes) — re-fetches codes from server |
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

For users, sign-up *is* onboarding. The flow is simpler than admin onboarding because 2FA and passkey are optional.

### Onboarding ownership and landing handoff

The reference landing app is a backend-free marketing site. Get started links to the web
app's `/sign-up`, and Sign in links to `/sign-in`. The landing neither reads the onboarding
mode nor requires a Convex URL. It no longer mounts a live announcement host;
web and admin retain their announcement UI.

Web's `SignUpView` reads `CONVEX_SITE_URL/api/waitlist/status` on every request with
`cache: "no-store"`. Admin mode changes apply to the next page request, without the former
60-second stale-while-revalidate window. `publicSignup` renders account creation,
`publicWaitlist` renders the shared `WaitlistForm` in web, and `inviteOnly` renders the
invitation-only notice and sign-in link. Backend failures or unrecognized responses fail closed
with that notice, never an open signup form. Backend mutations still enforce the mode at submit
time; an already-open page does not grant permission after an admin changes it.

The email-only default needs no app code. For custom questions, export
`createSignUpView({ waitlistForm: AppWaitlistForm })` as the page default from
`@web-app-starter/auth-ui/views`. The app-owned client form component receives
`convexSiteUrl` at request time and composes `WaitlistForm` from
`@web-app-starter/auth-ui` with `children` (question controls), optional `meta` (a JSON
object, default `{}`) and `disabled` (app validation). See
`apps/web/src/components/waitlist-form.tsx` for the reference questions. The shared form
posts directly from the visitor's browser to Convex, preserving per-visitor IP rate limiting;
do not replace it with a server action that collapses visitors onto the server's IP.
The form uses the existing web `PublicConfigProvider` for localized marketing legal links.
Shared wording lives in `auth.waitlist`; use `packages/messages/overrides.json` to reword it.
Sample question translations remain app-owned under `landing.waitlist` for compatibility.

**Additive adoption:** platform upgrades do not replace buyer-owned pages, questions or layouts.
Existing apps can keep their landing forms or opt into the web handoff by composing the new
view and form. Copy/customize the web question wrapper before removing an old form. The old
reference landing form, waitlist section and announcement host remain as unmounted app seams;
if you still mount them, retain their app-owned environment wiring and build env declarations.
Only remove a landing's Convex variable after removing its backend consumers. New default
launcher and infrastructure generators no longer supply it. No stored-answer migration is needed.

### 7.1 Step 1 — Create Account (email + password)

User enters their email and creates a password that meets the shared policy in §5.

On submit, Better Auth's `signUp.email()` creates the credential account and sends a verification email (if email verification is enabled by admin policy).

### 7.2 Step 2 — Verify Email (if required by admin policy)

If `userEmailVerificationRequired` is `true` (the default), the user must click the verification link before accessing the app. If disabled by admin, this step is skipped.

### 7.3 Optional: Magic Link Setup

If the admin has enabled magic link (`userMagicLinkEnabled: true`), the user can choose to sign in via magic link on subsequent logins. No additional setup is required — magic link uses the verified email.

### 7.4 Optional: 2FA Setup

Depends on the admin's `userMfaRequired` setting:

- **`optional`** (default): The user can enable 2FA from their security settings at any time. The flow is the same as admin TOTP setup (§6.3, steps 1–2) — enter password to unlock, scan QR, verify code, save backup codes.
- **`mandatory`**: The user is redirected to 2FA setup after sign-up (or on next login if they haven't set it up yet) and cannot access the app until complete. Same flow as admin TOTP setup.

In both cases, TOTP is required at login only for password and magic link sign-ins. Passkey sign-in never requires TOTP.

### 7.5 Optional: Passkey Registration

If the admin has passkeys enabled (`userPasskeyPolicy: "optional"`), the user can add a passkey from their security settings at any time. Same WebAuthn flow as admin passkey registration.

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
Email → Password → TOTP → ✓ Dashboard  (TOTP always required)
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

### 8.5 Session Properties

```typescript
adminSession: {
  expiresIn: 60 * 60 * 4,        // 4 hours
  updateAge: 60 * 30,             // Refresh if active within last 30 min
}

userSession: {
  expiresIn: 60 * 60 * 24 * 7,   // 7 days
  updateAge: 60 * 60,             // Refresh if active within last 1 hour
}
```

`trustDevice` (Better Auth's 2FA skip for 30 days) should be **disabled for admin accounts**. It may be enabled for user accounts at the admin's discretion (future setting).

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

The reference wrapper in `apps/web/src/components/waitlist-form.tsx` asks for
superpowers and excitement and offers role, company (120 characters) and use case
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
4. Full session issued
5. Dashboard shows immediate prompt: **"You used a backup code. Set up TOTP on a new device now."** Cannot be dismissed without completing new TOTP setup or clicking "Remind me in 1 hour" (max 3 snoozes before it blocks access)
6. Write audit event: `admin.recovery.backup_code_used`

#### Lost TOTP device, no backup codes, email still accessible

1. Admin visits the recovery flow
2. Enters their admin email
3. System sends a recovery email
4. Admin clicks link → authenticated with email only
5. **Before any dashboard access**, forced through mandatory re-setup:
   - Re-enter password to unlock TOTP setup
   - New TOTP setup (same as §6.3, step 1)
   - New backup codes generated and acknowledged (same as §6.3, step 2)
6. Old TOTP secret invalidated
7. Write audit event: `admin.recovery.email_bypass_used` with timestamp and IP
8. Admin notified via email that a recovery was performed from [IP address]

This path is deliberately conspicuous — a break-glass action, not a convenient shortcut.

#### Email compromised, password + TOTP still available

1. Admin signs in with email + password + TOTP (no email access needed)
2. Another admin creates a replacement admin account with a new email
3. Original account disabled: `isBanned: true`, `bannedReason: "Email compromised — replaced by [new email]"`
4. Original record retained for audit trail integrity
5. Write audit events: `admin.account.disabled`, `admin.account.created`

#### Total lockout

Last resort requiring direct database access:
1. Convex internal mutation clears `twoFactorEnabled` and resets onboarding state
2. Admin re-authenticates via email recovery → forced through TOTP re-setup
3. Write audit event: `admin.emergency_reset.executed` with `meta: { initiatedVia: "direct_db_script" }`

Script documented in repo, runnable via `bunx convex run`.

### 11.2 User Recovery

#### Lost TOTP device (if 2FA was enabled)

Same as admin flow — backup codes, then email recovery with forced TOTP re-setup. The flows are identical, just scoped to the web app.

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
does not disable the account's existing two-factor authentication.

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

No special intro needed. The sign-up form is standard: email, password (with strength meter), submit. Additional security options (2FA, passkey) are available from account settings after sign-up.

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

```
1. Valid Better Auth session exists      → else redirect to /sign-in
2. user.role !== "admin"                 → else 403 (admins cannot use the web app)
3. user.isBanned !== true                → else 403 with explanation
4. If userMfaRequired === "mandatory":
   user.twoFactorEnabled === true        → else redirect to /setup-2fa
5. If userEmailVerificationRequired:
   user.emailVerified === true           → else redirect to /verify-email
```
