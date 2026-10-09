# Organization administrator security

Organization administrators retain global authority `scope: user`. Completed administrator
memberships in active organizations apply `securityScope: admin`: verified email, a verified
authenticator, acknowledged recovery codes, an adequate current credential, live strong session
proof and the four-hour absolute login deadline. A required passkey also requires a current
passkey assertion. Enrollment flags never prove that a later login verified a factor, and this
security scope grants no app-operator access.

Pending setup preserves ordinary personal access. Disabled organizations impose no additional
identity-wide security requirement; identities can still use security self-service and other
authorized contexts. Reactivation requires a currently eligible administrator.

## Use the supported boundaries

Use `requireOrgAdminSession(ctx, organizationId, recent)` from `platform/sessionPolicy` for
custom member-management wrappers, with `recent: true` for writes. It binds current identity,
session proof and the exact active membership. Component actor IDs are trusted server inputs;
never expose them as public authorization arguments. Private app data still requires both
organization and owner checks.

`api.platform.organizationEnrollment.complete({ organizationId })` requires current elevated,
recent proof and the deployment-bound [preserving migration readiness](organization-data-migration.md).
It retains the existing organization ID and private ownership. Completion is retryable; invalidated
enrollment must satisfy current requirements before restoring administration.

Raw native organization routes remain denied. Do not write enrollment receipts, administrative
member fields or security policy through the generic auth adapter. Its guarded writes reject
changes that would remove the final eligible administrator, including credential/email changes,
factor or required-passkey removal, and recovery-code regeneration. Member mutations enforce the
same invariant inside their transaction. Enroll another administrator before making an otherwise
incompatible identity change.

## Replace credentials and recover safely

Native password change and email password reset retain their Better Auth verification and also
apply administrator password strength. The credential and completed enrollment receipts change
atomically; prior session proof is revoked. Native backup-code verification consumes exactly one
code while preserving the acknowledged recovery set and creates a limited recovery session bound
to the original factor. Password-only sessions cannot use that recovery authority.

An enrolled organization administrator must use the staged factor replacement actions instead
of the native delete-and-recreate TOTP operation:

1. Call `api.platform.organizationFactorReplacement.begin({ password })` from the authenticated
   security UI. It requires recent strong proof, or the exact factor-bound recovery session plus
   the current password. It returns `changeId`, `totpURI` and `backupCodes`.
2. Display those secrets only in the human security ceremony. Call
   `complete({ changeId, code, backupCodes: [firstCode, secondCode] })` with a TOTP from the new
   authenticator and two distinct codes from the newly saved set.
3. The server rechecks the session, credential, old factor and five-minute stage expiry, then
   atomically replaces the factor material and acknowledged receipts. The original factor remains
   usable until that commit. It preserves the factor ID, revokes old proof and clears recovery only
   on the bound completing session. Another session, stale stage or replay cannot complete it.

These secret-bearing actions are identity self-service, never agent tools. A required passkey is
still required after factor recovery; recovery does not waive the policy. If all required passkeys
are lost, use the deployment's reviewed support process rather than changing stored receipts.

## Security policy storage compatibility

Use the public `api.platform.appSettings` APIs to read or change `adminPasskeyPolicy`. The policy
is canonical in the auth component beside the memberships it protects, and governs both app
operators and org-admins. Public settings, internal policy evaluation and native settings commands
resolve that same value.

The preserving migration initializes it from the exact existing platform setting; `required` and
`disabled` are retained. Before initialization, reads use the legacy value without modifying it.
Completion also performs that preserving initialization. Legacy rows remain available as migration
evidence, but direct platform-component `set`, `remove` and `putRaw` writes for this key now reject
with `USE_CANONICAL_ORGANIZATION_POLICY`. Custom seed/migration code must use the canonical
initializer or guarded auth-component policy mutation, never raw table writes or a callback handle.

Changing to `required` rejects if any active membership-managed organization would lose its final
eligible admin. This atomic transition supports at most **1,000 active membership-managed
organizations**; personal and disabled organizations do not count. Unchanged policy and changes
to `optional` or `disabled` do not need that population scan. Above the strengthening bound,
`SECURITY_POLICY_ORGANIZATION_LIMIT` preserves the current policy and commits no partial change.
Keep the current policy and arrange a separately reviewed staged transition before strengthening
it. There is no automatic override: the ordinary data-migration command preserves an existing
policy and does not bypass this bound. Do not raise the cap or edit policy storage directly.
