# Adopting v4

Read the v4 changelog before planning the upgrade. v4 includes the startup/CI fixes and the
security changes merged since v3.1.0. The updater preserves application-owned reference code;
review the following interfaces and commit required manual app-owned compatibility changes
before creating its immutable plan. Read this guide and the referenced interfaces from the
published v4.0.0 tag; the installed v3.1.0 checkout does not contain the v4 codemods.
The updater applies target source and waits for seam conflicts to be resolved before automatically
running the release's codemods. Run the acceptance checks below against the target source after that
step, before deployment or merge. Unrelated app edits after planning require a new plan;
follow [UPGRADING.md](../UPGRADING.md) for named review files and resume decisions.
Keep backend and frontend changes in the same deployment. Passing source checks does not
migrate hosted configuration or data.

## Local fixture clients

After target source application, the updater runs `v4-local-fixture-clients.ts` for the
reference helper at `apps/web/qa/e2e/helpers/fixtures.ts`. The helper must
read `.env.e2e.local` before app/root environment files, validate a loopback HTTP backend,
read `DEV_FIXTURE_SECRET`, and send it as `X-Dev-Fixture-Secret` with `redirect: "error"`.
`DEV_FIXTURE_SECRET_FILE` selects the local AWS capability file. Never send this capability
to a hosted URL. Prepare custom helpers with those same checks before planning; the codemod
refuses unknown patterns. After the updater's codemod step, run
`./platform/tooling/node-ts.sh platform/tooling/codemods/v4-local-fixture-clients.ts --check`
from the app root and restart local development to generate the capability. Done when that
read-only check exits zero and local auth E2E creates a disposable account. Remove `DEV_SEED_ENABLED`,
`DEV_FIXTURE_RUNTIME` and `DEV_FIXTURE_SECRET` from every hosted Convex deployment; the hosted
deploy preflight refuses these variables. This does not disable local fixtures.

## Generated API bindings

After target source application, the updater runs `v4-platform-api.ts`
to extend Convex’s generated declaration with the three new internal platform modules. Those
modules must be present in the app checkout; running the target script against v3.1.0 source
alone cannot prepare their bindings. It
preserves app-owned bindings and fails on an unknown declaration format. This makes platform
source verification possible before deploying a backend. After the updater's codemod step,
run `./platform/tooling/node-ts.sh platform/tooling/codemods/v4-platform-api.ts --check`
from the app root. If you add app-owned backend modules while porting the file feature, or
have a custom generated declaration format, run Convex
codegen against a disposable local checkout containing the target platform and your app source
before planning; retain its generated declarations. Never hand-edit generated API types or
change the installed platform baseline to bypass verification.

## Custom authentication clients

Applications using the platform auth UI receive its changes automatically. For custom admin
invitation clients, replace mutation calls to `api.platform.adminInvitations.claimInvitation`
with action calls, retain the returned capability, and pass it to registration. Complete TOTP
(and the policy-required passkey) before expecting administrator privileges. This flow cannot
be safely inferred from arbitrary custom forms; port the flow in
[administrator onboarding](authentication-and-onboarding.md#6-admin-onboarding-flow).
Test invitation claim, setup and sign-in, plus refusal of registration without the capability.

Custom backup-code viewers must collect the current password for every view and call
`viewBackupCodes({ password })` or the authenticated POST helper; remove legacy GET calls.
Test wrong-password rejection before successful disclosure. Password reset now revokes sessions.
Review the new optional `AUTH_TRUSTED_IP_HEADER`, `AUTH_EMAIL_RATE_PER_MINUTE`, `AUTH_EMAIL_BURST`
and `AUTH_EMAIL_RATE_PER_DAY` configuration against the
[auth rate-limit contract](rate-limiting-architecture.md#deployment-configuration-and-ip-trust).

## App-owned sample files

If the app retains the sample file feature, port the release's
`packages/backend/convex/fileAccess.ts`, `files.ts`, guarded cascade in `projects.ts`, ownership
field and `by_storage` index in `sampleTables.ts`, and
`apps/web/src/components/projects/upload-panel.tsx`. Preserve app-specific tables, permissions
and UI; do not replace customized files blindly. Port `file-ownership.test.ts`, the file cases
in `authorization-contract.test.ts`, and `apps/web/qa/e2e/private-files.spec.ts` if the app keeps
the sample project UI. Done when upload/download/delete tests pass and another user cannot
read, attach or delete the bytes. The old client-selected storage ID methods now reject calls.

No automatic row or byte migration is safe for legacy attachments. Follow
[private file storage](private-file-storage.md#existing-deployments) to inventory and reconcile
hosted data; never backfill trusted ownership from an old claimed owner. An undeployed app with
no stored attachments needs no data copy. Source upgrades preserve and quarantine legacy rows.

## Shared UI, landing artifacts and Security

App-owned landing pages and forms are preserved. The updater runs
`v4-onboarding-dependency.ts`: if `packages/onboarding` is absent, it removes the
reference app’s newly introduced `@repo/onboarding: "workspace:*"` dependency from
web and landing manifests and its entry in literal `transpilePackages` arrays.
It does not create or overwrite an app-owned form. Existing onboarding workspaces are
left unchanged, including custom CSS exports. Review custom transpilation expressions
manually; the codemod leaves them unchanged. After the updater's codemod step, run
`./platform/tooling/node-ts.sh platform/tooling/codemods/v4-onboarding-dependency.ts --check`
from the app root; it writes nothing and exits non-zero if entries still need removal.
To adopt the restored onboarding and announcements,
follow [onboarding ownership and landing handoff](authentication-and-onboarding.md#onboarding-ownership-and-landing-handoff).

If your app shares onboarding through `packages/onboarding`, move its behavior tests and
coverage into that package, retaining consumer wiring tests. Apps that retain separate
forms should keep their existing behavior coverage. Run `bun run test:shared-packages` and ensure the package is listed with
real source coverage. Preserve the app's form fields, translations and branding.
Run `bun run test:landing-artifacts` to build and exercise both configuration variants; custom
landings must handle missing Convex configuration without throwing in the browser.

Run `bun run check:dependencies`. Resolve high/critical findings without weakening the gate.
The reference app removed unused `eslint-config-next`; remove it in your app only after
confirming your ESLint configuration does not import it. Compatible transitive security patches
must still respect the twelve-hour release-age policy. Review and retire equivalent native
Security workflow patches. After a successful PR run, require its **Security Complete** context
and the standalone **CodeQL** context alongside the existing app/shared gates (or enforce the
same merge rule where the hosting plan has no branch protection). Security Complete verifies
that applicable scans executed successfully; CodeQL separately enforces the alert policy. Finish with full local CI and the PR checks before merging.
