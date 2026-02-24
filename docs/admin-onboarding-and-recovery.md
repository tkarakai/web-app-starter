# Admin Onboarding & Recovery Specification

## 1. Design Principles

Three principles that every decision in this spec flows from:

**1. Email is identity, not a security factor.**
The admin's email is how the account was created and how it is identified. Using email OTP or magic link as a *second* factor doesn't add a second security dimension — it's still one thing: control of that inbox. Email paths are therefore recovery tools, not authentication factors.

**2. TOTP is the mandatory security anchor.**
TOTP (via authenticator app) is mandatory for all admins regardless of which primary sign-in method they choose. It is the one factor that is independent of both email and device, and its portability is entirely in the admin's hands (see §3). It is what makes email-compromise survivable.

**3. The admin controls their own resilience.**
The app cannot force an admin to store their TOTP secret in multiple places, sync their passkey to the cloud, or save backup codes somewhere safe. What the app *can* do is: explain these options clearly at setup time, require positive confirmation of critical steps, and make recovery paths that work even when the admin hasn't been perfect.


## 2. Authentication Architecture for Admins

### 2.1 Primary Sign-in (admin's choice during onboarding)

The admin chooses **one** of three primary authentication paths. Multiple methods can coexist — the admin can add or remove them later from their security settings.

| Method | How it works | Security posture |
|---|---|---|
| **Passkey** | WebAuthn credential — biometric, PIN, or hardware key | Phishing-resistant, strongest primary factor |
| **Password** | Long, high-entropy password (≥40 chars, zxcvbn score 4) | Email-independent, strong if rules enforced, encourages password manager use |
| **Magic Link** | One-click link sent to verified admin email | Convenient, but only as secure as email access |

All paths are then gated by mandatory TOTP 2FA before dashboard access is granted.

Password is a meaningful option here because, unlike magic link, it is fully independent of email — see §2.4 for the security rationale and §4 for enforcement details.

**Note on passkey sign-in:** Better Auth's passkey implementation requires the admin to enter their email address first, then present the passkey. The sign-in UI must collect the email before triggering the WebAuthn prompt. This is consistent across all three paths — email is always the first input.

### 2.2 Second Factor (mandatory for all admins)

**TOTP via authenticator app** is always required. No exceptions, no opt-out.

This is not optional because:
- If magic link is the primary factor and email is compromised, TOTP is the only thing blocking an attacker
- If passkey is the primary factor, TOTP provides a cross-device, cross-platform fallback

Better Auth's `twoFactor` plugin with TOTP is what implements this. The `twoFactor` requirement is enforced at the middleware level on all admin routes — `twoFactorEnabled` must be `true` on the admin's user record or they are redirected to complete onboarding.

### 2.3 Recovery Stack (in order of preference)

| Tier | Method | Condition |
|---|---|---|
| 1 | Backup codes | Admin has them stored safely |
| 2 | TOTP from a different device/app | Admin has TOTP on more than one device |
| 3 | Password login (if password is primary method) | Email-independent; works even if email is compromised |
| 4 | Magic link to verified email | Email is still under admin's control |
| 5 | Passkey from a different device/cloud | Admin has passkey synced or on backup device |
| 6 | Manual DB intervention | Last resort, documented escape hatch |

Tier 4 (magic link recovery) always forces immediate re-setup of TOTP before dashboard access, and logs a security alert. This matters: if email was the attack vector, using it for recovery without forcing TOTP re-establishment would be a hole.

Note that an admin using a **password as their primary method** has an inherently stronger recovery position than a magic-link-only admin: their account is accessible even if their email is fully compromised, as long as they have their password (in their password manager) and their TOTP codes (or backup codes). This is the key advantage password adds to the auth architecture.

### 2.4 Why Password Is a Legitimate Primary Factor (with the right rules)

Passwords have a reputation problem that is mostly deserved for *short, human-chosen* passwords. The calculus changes dramatically at 40 characters with enforced entropy. Understanding why is important for setting policy correctly.

**The math on brute force.** Password entropy is calculated as `length × log₂(character_pool_size)`. At 40 characters:

| Character pool | Pool size | Entropy at 40 chars |
|---|---|---|
| Lowercase only | 26 | **188 bits** |
| Lowercase + spaces | 27 | **190 bits** |
| Lower + upper + digits | 62 | **238 bits** |
| Full printable ASCII | 95 | **263 bits** |

For reference, 80 bits is considered uncrackable in any reasonable timeframe on modern GPU hardware running 100 billion guesses/second. 188 bits is not "more secure" than 80 bits in a practical sense — it is simply in a different category. Brute force is not a relevant attack vector against a properly-hashed 40-character password.

**Length beats character complexity.** NIST SP 800-63B-4 (finalized August 2025) explicitly removes mandatory complexity requirements (uppercase, symbols, etc.) because they produce predictable patterns — `P@ssw0rd1!` looks strong but is in every cracking dictionary. Doubling length provides more security benefit than switching the entire character set from digits-only to full ASCII at half the length. The old rules optimized for *appearance* of strength; length optimizes for *actual* search space.

**The sentence/passphrase question.** A long sentence has high theoretical entropy by character count, but actual security depends on how predictable the sentence is:

- `"To be or not to be, that is the question"` — 41 chars, but every Shakespeare quote, Bible verse, famous lyric, and common idiom is in professional cracking wordlists. Effective entropy is low.
- `"My dog Biscuit hates rain but loves Tuesday"` — a personal, unpublished sentence. No wordlist contains it. Effective entropy is high.
- A password-manager-generated 40-char random string — maximum entropy by definition.

The app cannot algorithmically distinguish "famous published text" from "personal unpublished sentence." This is why **zxcvbn-ts** (see §4) is the right tool: it runs the password through dictionary matching, pattern detection, and keyboard walk analysis, and scores the *actual predicted guessability* rather than just counting character types.

**The password manager forcing effect.** No human can reliably memorize a truly random 40-character string. This is intentional. By setting a threshold that makes memorization impractical, the policy functionally requires admins to use a password manager — which means:
- The password is unique to this app (no reuse)
- The password is generated with maximum randomness, not human pattern
- The password is backed up across devices
- Many password managers also handle TOTP, co-locating both factors

This indirect effect of a high length minimum is arguably the most important security benefit, more so than the entropy numbers themselves.

**Remaining password risks and how TOTP covers them.** A 40-char high-entropy password defeats brute force and renders database leaks irrelevant (Argon2-hashed). What it does not defeat: phishing (admin tricked into entering their password on a fake site) and keylogging (malware on the admin's device). These are exactly what mandatory TOTP covers — a 30-second rotating code captured via phishing or keylogging is useless by the time an attacker can use it. The two controls are complementary and together cover all meaningful attack vectors short of full device compromise.


## 3. A Note on Factor Portability (important context)

### TOTP is not device-specific

TOTP is based on a shared secret string (the seed). The QR code shown during setup *is* that secret, just encoded visually. The admin can:

- **Scan the QR code on multiple devices simultaneously** during setup — every device gets the same secret and generates identical codes.
- **Save the secret string** (shown as "setup key" or "manual entry key" alongside the QR code) and enter it into any TOTP app at any point in the future.
- **Store the secret in a cloud-syncing password manager** (Bitwarden, 1Password, Apple Passwords) that has built-in TOTP generation. The TOTP secret then lives in their vault alongside their other credentials, synced across all their devices.

This means a single TOTP setup can effectively be available on every device the admin owns, if they handle the secret thoughtfully. The app must display the raw secret string alongside the QR code, with guidance like: *"Save this key in your password manager — it lets you regenerate TOTP access on any device."*

### Passkeys are increasingly portable

The passkey landscape as of 2025:

- **Apple iCloud Keychain** syncs passkeys end-to-end encrypted across all Apple devices signed into the same Apple ID. An admin with an iPhone, iPad, and Mac gets one passkey that works everywhere.
- **Google Password Manager** syncs passkeys across all Android devices and Chrome on any platform signed into the same Google account.
- **1Password, Bitwarden, Dashlane** provide cross-platform passkey storage, including Windows (which still lacks native passkey sync). This is the best option for cross-ecosystem portability.
- **NIST SP 800-63-4** (finalized July 2025) officially recognizes synced passkeys as meeting AAL2 compliance when configured correctly — they are no longer treated as inherently weaker than device-bound passkeys.
- **Passkey portability** (exporting passkeys between managers) is now supported in iOS 26/macOS 26 Tahoe and being adopted by Bitwarden and Dashlane. Cross-ecosystem portability is still maturing, but the trajectory is clear.

Practically: an admin who saves their passkey in 1Password has it available everywhere, on any OS, without any per-device registration. A device-bound passkey (e.g., Windows Hello without a third-party manager) is the limiting case the app needs to warn about.


## 4. Password Policy Enforcement

When password is enabled as a primary auth method, enforce the following on both client (for UX feedback) and server (as the authoritative check):

**Minimum length:** 40 characters, hard enforced. Reject passwords below this threshold with a clear message: *"Admin passwords must be at least 40 characters. Use a randomly generated password from your password manager."*

**Entropy check via zxcvbn-ts:** Use [`@zxcvbn-ts/core`](https://zxcvbn-ts.github.io/zxcvbn/) — a modern, tree-shakable, actively maintained TypeScript rewrite of Dropbox's original zxcvbn. It goes beyond character-counting to perform actual dictionary matching, pattern detection (keyboard walks, dates, repeated sequences), and known-password detection. Require a score of **4** (the maximum — "very strong / estimated crack time: centuries+").

```typescript
// Install: bun add @zxcvbn-ts/core @zxcvbn-ts/language-en @zxcvbn-ts/language-common
import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";

// Initialize once at module load
zxcvbnOptions.setOptions({
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
});

function validateAdminPassword(
  password: string,
  adminEmail: string,
  appName: string
): { valid: boolean; feedback: string } {
  if (password.length < 40) {
    return { valid: false, feedback: "Password must be at least 40 characters." };
  }

  // Pass user inputs so zxcvbn can penalize passwords containing them
  const result = zxcvbn(password, [adminEmail, appName, "admin", "password"]);

  if (result.score < 4) {
    const suggestions = result.feedback.suggestions.join(" ");
    const warning = result.feedback.warning;
    return {
      valid: false,
      feedback: warning
        ? `${warning}. ${suggestions}`
        : suggestions || "Password is too predictable. Use a randomly generated password.",
    };
  }

  return { valid: true, feedback: "" };
}
```

**Breached password check:** Use Better Auth's [`haveibeenpwned` plugin](https://www.better-auth.com/docs/plugins/have-i-been-pwned) to check passwords against the Have I Been Pwned database on the server side. The plugin uses k-anonymity (only the first 5 chars of the SHA-1 hash are sent — the full password never leaves your server). This catches known-leaked passwords regardless of length or apparent complexity, and integrates natively with Better Auth's password validation pipeline.

**What the UI should show:** A live strength meter driven by zxcvbn-ts during typing. Show the estimated crack time from `result.crackTimesDisplay.offlineSlowHashing1e4PerSecond` (this is the relevant scenario — offline attack against a well-hashed database). The meter should turn green only at score 4 with length ≥ 40. Show zxcvbn-ts's `feedback.warning` and `feedback.suggestions` inline as the admin types.

**What NOT to require:** Special characters, uppercase letters, numbers, or periodic rotation. These constraints, per NIST SP 800-63B-4, produce predictable patterns that reduce real entropy while annoying users. Length and genuine unpredictability are what matter.


## 5. Audit Trail Integration

All admin onboarding, login, and recovery events must be recorded in the existing `auditTrail` table (defined in `packages/backend/convex/schema.ts`). Use the existing `scheduleAuditEvent()` helper from mutations or `runAuditEvent()` from actions.

Recommended audit actions (following the existing dot-notation convention in `auditTrailConstants.ts`):

| Event | Action | Notes |
|---|---|---|
| Onboarding: auth method chosen | `admin.onboarding.auth_method_chosen` | `meta` includes chosen method |
| Onboarding: TOTP configured | `admin.onboarding.totp_configured` | |
| Onboarding: backup codes acknowledged | `admin.onboarding.completed` | |
| Login: successful | `admin.auth.sign_in` | `meta` includes method used |
| Recovery: backup code used | `admin.recovery.backup_code_used` | |
| Recovery: email bypass used | `admin.recovery.email_bypass_used` | High-privilege event — include IP |
| Account disabled | `admin.account.disabled` | `reason` field with explanation |
| Account created (new admin) | `admin.account.created` | |
| Emergency reset executed | `admin.emergency_reset.executed` | `meta: { initiatedVia: "direct_db_script" }` |


## 6. Admin Onboarding Flow

When an admin account is created (via the bootstrap process or by an existing admin inviting a new one), the new admin must complete onboarding before they can access the dashboard. This flow is the same for every admin — first or fiftieth.

**Prerequisite:** The admin has been invited and has registered an account (email verified, `isAdmin` flag set). What follows is the security onboarding that gates dashboard access.

### 6.1 Step 1 — Primary Auth Choice

Present three cards with clear tradeoffs, not just labels:


**Option A: Passkey**
> Sign in with Face ID, Touch ID, Windows Hello, or a hardware key. Phishing-resistant — works without email access.
>
> ⚠️ **Make it portable:** If you save this passkey in iCloud Keychain, Google Password Manager, or 1Password, it syncs to all your devices automatically. A passkey saved only to this device is at risk if the device is lost. You'll be asked to confirm your passkey is backed up before onboarding completes.

**Option B: Password**
> A long, high-entropy password you store in a password manager. Independent of your email — if your email is compromised, your password login still works. Must be at least 40 characters with a high enough entropy score. A randomly generated password from your password manager is strongly recommended.
>
> 💡 **Why 40 characters?** A 40-character random password has 188–263 bits of entropy depending on character set — so far past the crackable threshold that brute force becomes irrelevant as an attack vector. The minimum is set high enough that memorization is impractical, which effectively requires use of a password manager.

**Option C: Magic Link**
> A sign-in link sent to your email. Simplest to set up, but dependent on email access at every login. If your email is ever compromised, you'll need to use TOTP to get in and then create a new admin account.
>
> ℹ️ Your email is your identity anchor regardless of which method you choose. Magic link just makes email your primary sign-in path too, which means a single point of failure.


The admin selects one. This is stored as `primaryAuthMethod` on their user record. They can add additional methods later from security settings.

**If Passkey is chosen:** Initiate WebAuthn registration. After successful registration, show a callout:
> "Where did you save this passkey? Check your password manager or device settings to confirm it's backed up. A passkey saved only to this browser session may not survive a device wipe."
>
> [Confirm: "My passkey is saved in iCloud Keychain / Google Password Manager / 1Password or another cloud manager"] checkbox

The confirmation is not technically verified — the app has no way to inspect the passkey's storage provider. But the explicit question forces the admin to think about it, and the text is logged with the audit event.

**If Password is chosen:** Show a password input with a live strength meter (zxcvbn-ts). See §4 for enforcement details. After a valid password is set, show a note:
> "This password is independent of your email. If your email is compromised, you can still log in here. Store this password in your password manager — do not attempt to memorize it."

**If Magic Link is chosen:** Nothing to configure at this step — the email is already verified. Display a note:
> "Magic link uses your email. Since Better Auth does not support email changes, this address is permanently tied to this admin account. If you ever lose control of this email, you'll need to create a new admin account."

### 6.2 Step 2 — TOTP Setup (mandatory, no skip)

Display the TOTP QR code and — critically — the raw secret string below it.

```
┌──────────────────────────────────────────────────────┐
│  Scan with your authenticator app                    │
│                                                      │
│  [QR CODE]                                           │
│                                                      │
│  Can't scan? Enter this key manually:                │
│  JBSWY3DPEHPK3PXP  ← raw secret, always visible      │
│                                                      │
│  💡 Save this key in your password manager. It       │
│  lets you add TOTP to any device at any time,        │
│  and apps like Bitwarden, 1Password, and Authy       │
│  can sync it to all your devices automatically.      │
└──────────────────────────────────────────────────────┘
```

After scanning, require the admin to enter a valid 6-digit code before proceeding. This proves:
- The app (QR code / secret display) is working correctly
- The admin's authenticator is in sync with the server
- The admin actually has TOTP set up, not just displayed

Only after successful code verification does `twoFactorEnabled` get set to `true` on the Better Auth user record. Write audit trail event: `admin.onboarding.totp_configured`.

### 6.3 Step 3 — Backup Codes

Better Auth generates 8 backup codes when 2FA is enabled. This step requires the admin to actually engage with them — not just see them.

Display the 8 codes in a grid. Provide:
- **"Download as .txt"** button
- **"Copy all"** button

Then require a two-part confirmation:
1. Checkbox: *"I have stored these codes somewhere other than this browser — a password manager, printed paper, or offline file."*
2. Enter any **two** of the eight codes into input fields to confirm they have been recorded.

If the entered codes match any two from the generated set, mark codes as acknowledged. Write audit trail event: `admin.onboarding.completed`.

Then redirect to `/sign-in` — the admin must complete a full proper login using their chosen primary method + TOTP.

> **Why redirect to sign-in instead of directly in?** Because the onboarding session was scoped to onboarding routes. The first real admin session should go through the full normal auth flow, proving end-to-end that authentication is working. Skipping this step has caused silent auth misconfiguration bugs in many systems.


## 7. Normal Admin Login Flow

### 7.1 Passkey path

```
1. Admin visits /sign-in
2. Admin enters email address
3. Browser presents passkey prompt
4. Passkey verified via Better Auth's passkey plugin → partial session issued
5. TOTP prompt shown
6. Admin enters 6-digit code
7. twoFactor.verifyTOTP() called → full admin session issued
8. Redirect to /dashboard
```

### 7.2 Password path

```
1. Admin visits /sign-in, enters email + password
2. signIn.email() called → Better Auth validates credentials
3. Because twoFactorEnabled=true, Better Auth returns twoFactorRedirect
4. TOTP prompt shown
5. Admin enters 6-digit code
6. twoFactor.verifyTOTP() called → full admin session issued
7. Redirect to /dashboard
```

### 7.3 Magic link path

```
1. Admin visits /sign-in, enters email
2. signIn.magicLink() called → email sent
3. Admin clicks link → email verified → partial session issued
4. TOTP prompt shown
5. Admin enters 6-digit code
6. twoFactor.verifyTOTP() called → full admin session issued
7. Redirect to /dashboard
```

### 7.4 Session properties

Admin sessions should differ from regular user sessions:

```typescript
// In Better Auth config, or enforced via middleware
adminSession: {
  expiresIn: 60 * 60 * 4,        // 4 hours (vs. 7 days for regular users)
  updateAge: 60 * 30,             // Refresh if active within last 30 min
}
```

`trustDevice` (Better Auth's 2FA skip for 30 days) should be **disabled for admin accounts**. Every admin login must complete full TOTP verification. The convenience of skipping TOTP is not appropriate for the most privileged accounts in the system.


## 8. Recovery Scenarios

### 8.1 Lost TOTP device, backup codes available

1. Admin clicks "Use a backup code" on the TOTP prompt
2. Enters one of their 8 codes
3. Better Auth's `twoFactor.verifyBackupCode()` validates and marks that code as used
4. Full session issued — admin is in
5. Dashboard shows immediate prompt: **"You used a backup code. Set up TOTP on a new device now."** This cannot be dismissed without either completing new TOTP setup or explicitly clicking "Remind me in 1 hour" (maximum 3 snoozes before it blocks access)
6. Write audit trail event: `admin.recovery.backup_code_used`

### 8.2 Lost TOTP device, no backup codes, email still accessible

1. Admin visits `/forgot-password` or uses the recovery flow
2. Enters their admin email
3. System sends a recovery magic link
4. Admin clicks link → authenticated with email only
5. **Before any dashboard access**, admin is forced through a mandatory re-onboarding flow:
   - New TOTP setup (same as §6.2)
   - New backup codes generated and acknowledged (same as §6.3)
6. Old TOTP secret is invalidated, new one stored
7. Write audit trail event: `admin.recovery.email_bypass_used` with timestamp and IP — this is a high-privilege event
8. Admin is notified via email that a recovery was performed from [IP address]

This path is deliberately conspicuous. It exists so the admin can recover, but it should feel like what it is — a break-glass action, not a convenient shortcut.

### 8.3 Email compromised, new admin account needed

Since Better Auth does not support email changes, replacing a compromised admin email means:

1. Another admin (or someone with deployment access) creates a new admin account with a replacement email address
2. The new admin goes through the full onboarding flow (§6)
3. The new admin disables the original compromised-email account: set `isBanned: true`, `bannedReason: "Email address compromised — replaced by [new email]"`
4. The original admin user record is retained (not deleted) for audit trail integrity
5. Write audit trail event: `admin.account.disabled`, `admin.account.created`

The ban check must be enforced at the session middleware level — a banned admin who somehow still has a valid session cookie must be ejected on their next request.

### 8.4 Total lockout (no codes, no email, no other admins)

This is the genuine last resort. It requires direct database access — which means whoever has deployment credentials needs to be involved.

The procedure:
1. Use a Convex internal mutation to clear the locked-out admin's `twoFactorEnabled` flag and reset their onboarding state
2. The admin can then re-authenticate via their primary method (or magic link) and is forced through TOTP re-onboarding (§6.2–6.3)
3. Write audit trail event: `admin.emergency_reset.executed` with `meta: { initiatedVia: "direct_db_script" }`

This script should be documented in the repo and runnable via `bunx convex run`. The protection is that running it requires Convex deployment credentials — security through obscurity is not the goal.


## 9. What to Tell the Admin During Onboarding

The onboarding UI should not just collect inputs. It should give the admin a mental model. Suggested copy at the start of onboarding, displayed as a one-time explainer:

> **Before you begin, understand these three things:**
>
> **1. Your email is permanent.** Better Auth ties your admin identity to your email address. It cannot be changed from within the app. If your email changes or is compromised, you'll need to create a new admin account.
>
> **2. TOTP is mandatory and your responsibility.** You'll set up an authenticator app in a moment. The security of this admin account depends on that app — or, better, on the TOTP secret being saved in a cloud-syncing password manager like 1Password or Bitwarden. The app cannot do this for you.
>
> **3. Save your backup codes.** You'll receive 8 single-use codes. Store them somewhere separate from your devices — a password manager entry, a printed page, a secure note. They are your recovery path if everything else fails.


## 10. Admin Routes Middleware

All admin app routes need a middleware chain that enforces, in order:

```
1. Valid Better Auth session exists  → else redirect to /sign-in
2. user.isAdmin === true             → else 403
3. user.isBanned !== true            → else 403 with explanation
4. user.twoFactorEnabled === true    → else redirect to /dashboard/setup-2fa
```

In a Next.js app with the Convex Better Auth integration, this lives in `middleware.ts` using `isAuthenticated()` from `convexBetterAuthNextJs` plus custom Convex queries for the admin-specific checks.


## 11. Convex-Specific Implementation Notes

`twoFactor` currently requires a credential account to be enabled. Magic link creates a credential-adjacent account that satisfies this. Passkey accounts may need the admin to also have an email+password or magic link account linked for the `twoFactor` plugin to attach to — verify this against the current Better Auth version at implementation time and file an issue if the constraint has been lifted.


## 12. Security Checklist

Use this at deployment and after any major auth configuration change.

- [ ] Email provider is operational (e.g. Resend, SendGrid — send a test message)
- [ ] TOTP is required — attempting to reach `/dashboard` without completing TOTP redirects correctly
- [ ] Trusted device is disabled for admin accounts
- [ ] Backup codes re-entry check works
- [ ] Recovery via backup code works end-to-end
- [ ] Recovery via email (§8.2) forces TOTP re-onboarding before dashboard access
- [ ] Banned admin user cannot access the dashboard even with a valid cookie
- [ ] Audit trail events are being written for each onboarding and login event
- [ ] Emergency reset script is present and documented in the repo

**If password is enabled as a primary method:**
- [ ] `@zxcvbn-ts/core` is installed and score-4 requirement is enforced server-side (not just client-side)
- [ ] 40-character minimum is enforced server-side
- [ ] zxcvbn-ts receives `adminEmail` and `appName` as user inputs to penalize those in passwords
- [ ] Better Auth's `haveibeenpwned` plugin is enabled
- [ ] A password set to a short/weak value is rejected at the API level, not just in the UI
- [ ] Password reset flow requires TOTP verification before allowing a new password to be set
