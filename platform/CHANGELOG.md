# Changelog

All notable changes to this starter, for the business apps that merge it.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [semver as defined in `VERSIONING.md`](./VERSIONING.md) — read that first
if you are wondering why a small-looking change was a major.

Every release that requires anything of a downstream app has an **Action required**
section. Ordinary conflict resolution remains expected for customized source at every
version. Release-specific compatibility and deployment steps are listed explicitly. How to actually take a release:
[`UPGRADING.md`](./UPGRADING.md).

## [Unreleased]

### Fixed

- Adoption verifies a published release before editing files, supports an explicit release baseline for existing-repository merges, limits new upstream fetches, and sets GitHub CLI repository targeting. Existing-repository and invalid-baseline recovery instructions now identify the target release guide.

## [2.0.0] - 2026-09-30

Publication begins with v2.0.0. The v1.0.0 snapshot below was prepared but never
published or tagged; it is retained only as historical context.

### Added

- The `platform-upgrade` skill guides agents through draft update PRs, per-item decisions,
  report relocation, complete verification and ready-for-review handoff while preserving app choices.

- `bun run platform:setup-updates` guides GitHub App registration and repository-only
  installation, verifies permissions, and stores updater credentials through the GitHub CLI.
  It preserves existing configuration, supports read-only status and documents token fallback.
  Private keys stay out of local files, browser responses, arguments and logs.
  See [updater setup](docs/setup-updates.md).

- Automatic platform-update delivery separates read-only verification from the job holding
  repository write credentials. Adoption installs its weekday caller; verified updates become
  ready PRs, review gates become drafts, and failures or new majors become issues. GitHub App
  tokens trigger ordinary PR CI; fallback workflow-file changes need a manual upgrade.
  Draft reports relocate safely to a new checkout and repeat verification without repeating
  completed codemods, restoring release objects from the trusted source in fresh clones.
  Failed checks retain their report and diagnostics. Default dev startup skips removed apps.
  See [update delivery](docs/update-delivery.md).

- `bun run platform:check-updates` reports published updates, major releases for review and
  advisories affecting the installed version. Contracts CI independently runs
  `bun run check:advisories`: high/critical advisories fail; lower severity warns. Discovery is
  read-only, ignores draft/prerelease tags, and validates the cumulative advisory schema.
  See [release discovery and advisories](docs/platform-updates.md).

- `bun run platform:upgrade` plans and applies published platform releases on a dedicated
  branch, preserving app code and merging declared seams. The target release supplies the tool;
  intermediate codemods run in order. JSON/Markdown reports record review gates, bounded
  diagnostics, verification and recovery. The installed baseline advances only after all
  required checks pass; pending E2E, secrets, patches and data migrations keep the update pending.
  See [UPGRADING.md](UPGRADING.md).

### Fixed

- Root dependency overrides are verified against reachable workspace installations, including
  Bun's isolated layout, instead of requiring a hoisted root installation.
- Dependency minimums remain enforced after reviewing a conflicted package manifest; resolving
  the text conflict cannot bypass verification of the installed security-patched version.
- Optional new environment settings remain visible in upgrade reports without blocking verification; required new secrets and removed or renamed settings retain their review gates.
- Update Next.js to 16.3.6 for [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j), which affects Node.js `next/og` image generation with untrusted SVG values. The upgrade manifest enforces the patched dependency floor.

- Locale-root redirects preserve the requested locale on the way to the dashboard and sign-in (#186).
- Optional `i18n.defaultLocale` selects a shipped fallback locale independently of locale ordering; omission stays English (#185). Static 404 HTML uses the configured merged catalog.
- Dev, local CI, staging, production and rollback select `landing` first, falling back to `landing-static` only when the primary app is removed (#187, #188). The static fallback uses separate Vercel projects, static output and distinct artifacts. Ops records and verifies its physical app identity.
- Staging audit records retain the selected landing app when CI fails, so a successful rerun does not leave conflicting evidence in `ops inspect`.
- Deployment workflows use the platform-owned `platform-record-ops.cjs` helper, so upgrades deliver the recorder together with the workflows and Ops CLI.
- Local startup seeds Convex's required `LANDING_URL` for the static fallback too, including web-only and admin-only startup.
- Local CI keeps build-time placeholder backend URLs out of browser-test server environments.
- Both landing dev commands use managed process tracking; static-only startup needs no Convex. Adoption preserves the generic landing command and rejects removal of the last landing before changing files.

- Upgrade recovery documents the direct launcher for package-manifest conflicts, allowing
  report relocation before editing even when Bun cannot read the package scripts.

- Versioning guidance uses the separated platform baseline and published-major support
  policy. Evaluation, commercial and app-template licence texts have completed legal review.

- Platform upgrades execute historical codemods through canonical temporary paths, avoiding
  silent no-op entrypoints when the temporary directory is a symlink, including macOS `/var`.

- Landing development and CI guidance correctly describe the local Convex backend used by
  waitlist status and submission endpoints.

- Anonymous Convex backends started with `CI=true` use a bounded, overridable five-second
  execution budget, avoiding spurious query timeouts on small private-repository runners.

- Auth browser tests support the direct sign-out button in apps adopted without the sample.

- Root E2E runs app suites in sequence, so one app finishing cannot stop the shared local
  development processes while another app is still testing.

- Ops tests retain the web hash check and skip only the optional landing hash check when an
  adopted app removed that landing, so full upgrade verification works in stripped apps.

- Adoption preserves literal dollar-sign sequences in configuration values, escapes workflow
  job names correctly, and reads optional configuration files without a separate existence check.
- Adoption can strip the projects/tasks/uploads sample with `--remove-sample`, keeping account
  settings, announcements and authentication. It requires a clean checkout before writing.
- CI, local checks, staging, production and rollback handle removed landing apps and demo;
  optional-app detection uses the selected source commit, including during rollback.

### Action required

- **Apps adopted from unpublished v2 source:** a `2.0.0` version string or app merge commit is
  not the published release baseline. Follow the [one-time source migration](UPGRADING.md#apps-adopted-before-the-first-published-release), preserving app choices and verifying all checks before recording the release commit. **Done when:** the installed record matches the verified published source and the zone check passes. Subsequent releases use the automatic updater.
- Keep at least one landing app for default dev/CI/deployment. If using the fallback, configure its separate Vercel projects and `VERCEL_PROJECT_ID_LANDING_STATIC[_STAGING]` secrets as described in the deployment runbook. Update web's `LANDING_URL` and run `ops setup` for the static project mappings.
- App-owned reference files are preserved by platform upgrades. Apply the locale-preserving redirect to `apps/web/src/app/[locale]/page.tsx`; static landing adopters should add the root locale redirect and use the configured fallback catalog in their 404 page. See [reference-app fixes](UPGRADING.md#reference-app-fixes).
- Apps with a locale subset should adapt copied web/landing localization browser tests to their configured languages and message overrides. The corrected reference tests exercise enabled locales instead of assuming French and Arabic are installed.

- Update app-owned CI callers with
  `./platform/tooling/node-ts.sh platform/tooling/codemods/v2-ci-callers.ts`.
  It grants the change detector explicit read access and runs browser CI when a draft becomes
  ready. Custom permission denials or complex triggers require review. **Done when:** its
  `--check` passes and a ready update PR runs all applicable checks, including E2E.

- **Who is affected:** apps with customized account-security wording under
  `dashboard.changePassword`, `dashboard.twoFactor`, `dashboard.passkeys` or `dashboard.sessions`.
  These messages now belong to the platform's `accountSecurity` namespace. Run
  `node platform/tooling/codemods/v2-security-messages.ts` to preserve customized values in
  `packages/messages/overrides.json`. Original app keys remain for local components. Conflicting
  overrides or custom keys without a platform equivalent stop for review before any write.
  **Done when:** the codemod's `--check`, `bun run check:i18n` and account security tests pass.

- **Who is affected:** any existing deployment with platform data in app-level tables. Before
  deploying this release, prepare the additive bridge with
  `platform/tooling/codemods/v2-component-data-bridge.ts`, stop writers, and run the internal
  `platform/componentMigration:run` action for that deployment. Require a complete, matching
  status report before deploying the final backend/apps. The copy is resumable, remaps invitation
  references, and transfers announcement jobs atomically. The deploy action blocks unmigrated
  legacy data. See [the migration procedure](docs/component-data-migration.md). Legacy definitions
  leave the schema; source rows remain for recovery. New empty apps need no copy.

- **Who is affected:** apps reading protected-admin addresses directly. `adminEmails`
  now lives in the platform component, including signup promotion, protected-admin checks
  and password-reset policy lookup. **What to do:** use `api.platform.adminEmails.listProtected`
  for the admin-only email list or `internal.platform.adminEmails.list` in backend code.
  Run `./platform/tooling/node-ts.sh platform/tooling/codemods/v2-admin-email-types.ts`
  to migrate app-model row/ID types to `AdminEmail` and opaque strings. Profiles, sessions
  and rate-limit state remain app-side; legacy admin rows await the staged data migration.

- **Who is affected:** apps consuming waitlists or invitations. These tables now live in
  the platform component; existing wrapper API paths, auth checks and email delivery remain.
  **What to do:** run
  `./platform/tooling/node-ts.sh platform/tooling/codemods/v2-invitation-types.ts` to replace
  app-model `Doc` / `Id` types with `WaitlistEntry`, `InvitationToken`, `AdminInvitation`
  and opaque string IDs. Use `usePaginatedQuery` from `convex-helpers/react` for waitlist
  and admin-invitation lists. Pages are non-reactive; a full last page needs another fetch
  to report completion. Existing data remains in the legacy tables for staged migration.

- **Who is affected:** apps consuming announcements or reading platform settings directly.
  Settings and announcements now live in the platform component. Existing public API paths
  and authorization rules are preserved; announcement IDs cross the boundary as strings.
  **What to do:** run
  `./platform/tooling/node-ts.sh platform/tooling/codemods/v2-announcement-types.ts` for
  `Doc<"announcements">` / `Id<"announcements">` usages, then regenerate the Convex API.
  Read settings through `api.platform.appSettings.*` (or the internal wrappers from backend
  code), never through the app database. URL rendering and branded email defaults remain
  in the app wrappers. Old rows remain available for the staged data migration.
  **Done when:** codemod `--check`, typecheck, backend tests and admin flows pass.
  Scheduled announcements now use the component scheduler and clear their own completed
  job reference without trying to cancel the running job.

- **Who is affected:** apps consuming audit-trail rows. Audit storage now lives in the
  `@web-app-starter/convex-platform` component; wrappers remain `api.platform.auditTrail.*`.
  **What to do:** retain `app.use(platform)` in `convex.config.ts` and add the component
  workspace dependency to the backend. Run
  `./platform/tooling/node-ts.sh platform/tooling/codemods/v2-audit-trail-type.ts` to replace
  `Doc<"auditTrail">` with `AuditTrailEvent` from `@repo/backend`, then regenerate with
  `bun run dev`. Paginated audit views use `convex-helpers/react`; loaded pages are not
  reactive. Backend tests must register the component (use `convex/test.modules.ts`).
  Existing constant exports remain compatible. The legacy app table is retained during
  migration; historical rows need copying before the final schema removes it.
  **Done when:** codemod `--check`, typecheck, backend tests and the admin audit view pass.

- **Who is affected:** every app. The platform moved under `platform/` (v2 layout). Shared
  packages are in `platform/packages/` and renamed from `@repo/<name>` to
  `@web-app-starter/<name>` (`app-config`, `auth`, `design-patterns`, `design-system`,
  `edge-rate-limit`, `i18n`, `ops`, `paper-roll`, `starter-sidebar-policy`); `@repo/backend`
  and the apps keep their names. The admin dashboard and the component showcase moved to
  `platform/apps/admin` and `platform/apps/storybook`; dev and CI scripts from `scripts/` to
  `platform/tooling/`; `CHANGELOG.md`, `UPGRADING.md`, `VERSIONING.md`, `README.md` and
  `COMMERCIAL-LICENSE.md` to `platform/` (the root keeps a short README and the evaluation
  `LICENSE`); `tsconfig.base.json` and the ESLint rules to `platform/config/`.
  **What to do:** run
  `./platform/tooling/node-ts.sh platform/tooling/codemods/v2-platform-packages.ts` from the
  repository root, then `bun install`. It rewrites imports, package names, dependencies and
  paths to the moved packages in your app code, and prints every file it changes. Point your
  app `tsconfig.json` files at `platform/config/tsconfig.base.json` and your root
  `eslint.config.mjs` at `platform/config/eslint.base.mjs` (see the starter's root files).
  Replace `scripts/` with `platform/tooling/` in your own scripts and workflows; the root
  `package.json` commands (`bun run dev`, `bun run ci`, ...) are unchanged. If you deploy the
  admin app to Vercel, set its projects' **Root Directory** to `platform/apps/admin`; until
  then the build uses the checkout's directory and the deploy warns.
  **Done when:** `./platform/tooling/node-ts.sh platform/tooling/codemods/v2-platform-packages.ts --check`
  exits 0 and `bun run typecheck`, `bun run lint` and `bun run build` pass.
- **Who is affected:** every app. Platform Convex functions moved from
  `packages/backend/convex/<module>.ts` to `packages/backend/convex/platform/<module>.ts`, so
  their API paths changed: `api.<module>.*` and `internal.<module>.*` are now
  `api.platform.<module>.*` / `internal.platform.<module>.*` for `adminAuth`, `adminEmails`,
  `adminInvitationActions`, `adminInvitations`, `announcements`, `appSettings`, `auditTrail`,
  `auth`, `bootstrap`, `developmentOnly`, `devSeed`, `e2eFixtures`, `integrations`, `meta`,
  `passwordStrength`, `rateLimits`, `securityPolicies`, `sessions`, `userProfiles`, `waitlist`,
  `waitlistActions` and `waitlistTokens` (and their helper modules). CLI paths follow:
  `convex run platform/bootstrap:initialize`. The Better Auth component moved to
  `convex/platform/betterAuth/`. `schema.ts`, `http.ts`, `convex.config.ts` and
  `auth.config.ts` are now thin seams: `schema.ts` spreads `platformTables` (from
  `convex/platform/tables.ts`) and the sample's `sampleTables` (`convex/sampleTables.ts`);
  `http.ts` calls `registerPlatformRoutes(http)`. `requireProjectAccess` moved out of the
  platform's `functions.ts` into the sample domain's `convex/projectAccess.ts`. Platform
  tests moved with their modules and import `modules` from `convex/test.modules.ts`.
  **What to do:** run
  `./platform/tooling/node-ts.sh platform/tooling/codemods/v2-convex-platform.ts` from the
  repository root (`--convex-dir <dir>` if your Convex functions are elsewhere). It rewrites
  function references, `convex run` paths, and relative imports from your Convex modules to
  the moved ones (`./functions` → `./platform/functions`). Take the starter's `schema.ts`,
  `http.ts`, `convex.config.ts` and `auth.config.ts`, then re-add your own tables after the
  `...platformTables` spread and your own routes after `registerPlatformRoutes(http)`. Delete
  your copies of the moved modules at the `convex/` root. If your app code called
  `requireProjectAccess`, import it from `./projectAccess`. Regenerate the API with
  `bun run dev` (or `bunx convex dev --once`). Data is unaffected: table names are unchanged.
  **Done when:** the codemod's `--check` exits 0, `ls packages/backend/convex/*.ts` lists no
  moved module, and `bun run typecheck` and `bun run test:convex` pass.
- **Who is affected:** apps that kept the web app's auth pages (every app built on
  `apps/web`). The auth routes, their logic and default views moved from `apps/web` to the new
  platform package `@web-app-starter/auth-ui`: sign-in, sign-up, forgot and reset password,
  verify email and invitation sign-up pages; the guest, public and protected (dashboard)
  layouts; `/forbidden`; the `api/auth/[...all]` and `api/auth/clear-session` handlers; the
  session-cookie part of `proxy.ts` (`authRedirect`); `AuthGuard`/`useAuthUser`, `GuestGuard`,
  `broadcastAuth`, `LocaleSwitcher`, `ConvexErrorToast` and the sign-in locale action. Deleted
  from `apps/web/src`: `components/auth/*`, `components/ui/locale-switcher.tsx`,
  `components/convex-error-toast.tsx`, `lib/auth-*.ts`, `lib/error-messages.ts` (unused) and
  `app/actions.ts`. `ConvexErrorToast` now takes the app's own codes as `appErrorKeys`.
  **What to do:** take the starter's route files under `apps/web/src/app/` (each is a one-line
  re-export) and `proxy.ts`, add `@web-app-starter/auth-ui` to your app's dependencies and
  `transpilePackages`, and run
  `./platform/tooling/node-ts.sh platform/tooling/codemods/v2-auth-ui.ts`: it rewrites imports
  of the moved modules (`@/components/auth/*`, `@/components/ui/locale-switcher`,
  `@/components/convex-error-toast`, `@/lib/auth-*`) to `@web-app-starter/auth-ui`, and leaves
  alone any module you still have a local copy of. If you had customised an auth page, keep your page file and
  build it from the package's `AuthPageShell` and forms instead of the old local components.
  **Done when:** `test ! -e apps/web/src/components/auth`, and `bun run typecheck`,
  `bun run test:unit` and the auth E2E suite (`bun run test:e2e`) pass.
- **Who is affected:** every app that added or changed strings in
  `platform/packages/i18n/messages/*.json`. Messages are split by owner and merged at load:
  the platform's files keep only platform namespaces (`common`, `theme`, `language`, `offline`,
  `auth`, `errors`, `passwordStrength`, `forbidden`, `timezones`); app namespaces live in the new
  app-owned package `packages/messages/` (`@repo/messages`, `<locale>.json`), and app wording for
  platform strings in `packages/messages/overrides.json`. The reference app's namespaces
  (`metadata`, `landing`, `legal`, `dashboard`, `projects`, `tasks`, `uploads`) moved there; the
  sample-domain error strings moved from `errors` to `sampleErrors`, and the auth forms' passkey
  strings gained a platform copy under `auth.passkeys`. `app.config.ts` gains a required
  `i18n.locales` (the locales you ship, including `en`); `locales` from `@web-app-starter/i18n` is
  now that subset and `allLocales` the full set.
  **What to do:** take the starter's `platform/packages/i18n/messages/` wholesale. Move each of
  your own namespaces from your old copies of those files into `packages/messages/<locale>.json`;
  where you had changed a platform string, put the new wording in `overrides.json` under
  `{ "<locale>": { "<namespace>": { ... } } }`. Add `i18n: { locales: [...] }` to `app.config.ts`,
  add `@repo/messages` to each Next app's dependencies and `transpilePackages`, and in component
  tests render with `{ ...platformMessages, ...appMessages }`. Code that read
  `errors.convex.projectNotFound` (etc.) or `errors.PROJECT_NOT_FOUND` reads `sampleErrors.*`.
  **Done when:** `bun run check:i18n` passes (it names missing keys, namespace clashes and
  stale overrides) and `bun run --cwd apps/web test` passes.
- **Who is affected:** apps whose hosted (staging or production) Convex deployment has no
  `RESEND_API_KEY`. Auth and invitation emails there used to be written to the Convex logs;
  they now fail with `EMAIL_DELIVERY_NOT_CONFIGURED`.
  **What to do:** `CONVEX_DEPLOY_KEY=<key> bunx convex env set RESEND_API_KEY <key>` and
  `... bunx convex env set EMAIL_FROM <address>` on each hosted deployment.
  **Done when:** `CONVEX_DEPLOY_KEY=<key> bunx convex env get RESEND_API_KEY` prints a value
  for every hosted deployment. Local development is unchanged.
- **Who is affected:** every app. Agent instructions and platform docs split into two layers.
  The platform's rules moved from the root `AGENTS.md` to `platform/AGENTS.md`; the guides in
  `docs/` and `docs/claude/` moved to `platform/docs/`.
  **What to do:** keep your root `AGENTS.md`, make it open with "Before any task, read
  `platform/AGENTS.md`.", and make your root `CLAUDE.md` import both (`@AGENTS.md` and
  `@platform/AGENTS.md`); templates are in `platform/templates/`. Delete the old copies under
  `docs/` and `docs/claude/`. See `UPGRADING.md`, "`AGENTS.md`, `CLAUDE.md`, `.claude/`,
  `.agents/`, `docs/`, `README.md`".
  **Done when:** `test -f platform/AGENTS.md && test ! -e docs/claude && grep -q '@platform/AGENTS.md' CLAUDE.md`
  exits 0.
- **Who is affected:** every app. Values that used to be literals in starter files now come
  from the new root `app.config.ts`.
  **What to do:** when merging, set `identity.productName`, `identity.legalEntity`,
  `identity.supportEmail`, `runtime.ports` and `runtime.authCookiePrefix` in `app.config.ts`
  to what your app used, then take the starter's side of the files that held them before:
  app `package.json` `dev` scripts, `playwright.config.ts`, `scripts/dev-start.sh`,
  `ci-*.yml` env blocks, `@web-app-starter/auth`, both `proxy.ts` and `clear-session` routes, and Convex
  `auth.ts` / `sessions.ts`. If you renamed the product in `packages/i18n/messages`, keep your
  other wording but drop `common.appName` and `metadata.title` and write `{productName}` where
  the name appeared (see `UPGRADING.md`, "Branding strings and `app.config.ts`").
  Code that read `common.appName` should read `appConfig.identity.productName`
  from `@web-app-starter/app-config`. Callers of `hasSessionCookie(request)` now pass the names:
  `hasSessionCookie(request, sessionCookieNames())` from `@web-app-starter/auth/cookies`.
  **Done when:** `bun run typecheck`, `bun run test` and `bun run test:unit` pass and
  `git grep -n "<your product name>" -- packages/i18n/messages` finds nothing.

### Added

- Account security settings now ship in `@web-app-starter/auth-ui`: `SecuritySection`,
  `ChangePasswordForm`, `TwoFactorSection`, `PasskeySection` and `SessionsList`. Existing web
  imports remain compatible through thin re-exports. Their auth logic and localized controls
  receive platform updates; auth component and broadcast tests run from the package itself.

- Reusable platform workflows, `.github/workflows/platform-*.yml` (CI for each app, security,
  staging and production deploys, rollback), with the app-owned `ci-*.yml`, `cd-*.yml` and
  `security.yml` as thin callers that keep their names, triggers and `CI <App> Complete`
  checks. Features GitHub gives free only to public repositories (CodeQL, dependency review,
  build attestations, production approval) skip with a visible notice on a private repository
  unless `PLATFORM_CODE_SECURITY`, `PLATFORM_ATTESTATIONS` or `PLATFORM_ENVIRONMENT_PROTECTION`
  is `true`. The platform unit suite runs only when the platform changed.
  `bun run check:actions-pinned` (in CI) requires full commit SHAs for every action.
  **If you edited these workflows:** move your trigger and permission changes to the callers
  and take the platform's `platform-*.yml`. Guide: `platform/docs/ci.md`.
- `platform/config/renovate-preset.json`: the platform's Renovate policy (cooldown, grouping,
  automerge, holds) as a preset. It ignores the platform zone (`platform/**`,
  `.github/workflows/platform-*.yml`, `.github/actions/**`), so Renovate never edits it in your
  app. Platform manifests now declare ranges (floors) instead of exact pins, so you can raise a
  shared dependency without touching `platform/`. To use it, make your root `renovate.json`
  extend `local>your-owner/your-repo//platform/config/renovate-preset` and keep only your own
  rules there. Guide: `platform/docs/dependency-updates.md`.
- Zone check (`bun run check:zone`, `platform/tooling/check-zone.ts`; a step of CI Shared's
  lint job), `.platform-base.json` and the `platform-patch` skill. With a `.platform-base.json`
  (`version`, release `commit`, `patches`), every platform-zone file that differs from the
  release commit must be a recorded patch carrying a `PLATFORM-PATCH: <reason>` comment;
  recorded patches are listed on every run. Seams must keep their platform hooks
  (`...platformTables`, `registerPlatformRoutes(http)`, the config bases, the Renovate preset).
  Without the file (the product repo) no app code may carry a patch marker.
- `bun run adopt` (`platform/tooling/adopt.ts`), run once on a fresh clone: sets the product
  name, support email, auth cookie prefix and ports in `app.config.ts`; replaces the root
  `README.md`, `LICENSE`, `AGENTS.md` and `CLAUDE.md` with `platform/templates/`; points
  `renovate.json` at your repository (`local>owner/name//platform/config/renovate-preset`) and
  drops the product repo's own `platform/**` rules; optionally removes `landing`,
  `landing-static` and `demo` with their callers, scripts and build entries (`--remove`); links
  the platform skills; writes `.platform-base.json` and adds the `upstream` remote; then runs
  the zone check and a build. Asks for what it needs, or takes flags (`--name`, `--repo`,
  `--yes`, ...; see the file header). Local CI and the icon copy skip removed apps.
- Contracts (`bun run test:contracts`; CI Shared's **Contracts** job, on every PR):
  `@web-app-starter/contracts` checks each reference app's `clear-session` route (deletes only
  this app's session cookies, never another app's on the same host), proxy session detection,
  CSP and security headers, and required environment declarations; the backend's
  `endpoint-authorization.test.ts` requires every public platform Convex function to be
  classified `public`, `user` or `admin` and checks anonymous and non-admin callers are refused;
  `authorization-contract.test.ts` covers the sample domain's ownership rules. Guide:
  `platform/docs/testing.md`, "Contracts".
- `platform/tooling/codemods/v2-platform-packages.ts`: the codemod for the package rename and
  move (idempotent; `--check` for CI).
- `@web-app-starter/auth-ui` (`platform/packages/auth-ui`): the auth pages, their logic and
  default views, shared by the web app and (for its equivalents) admin, and
  `platform/tooling/codemods/v2-auth-ui.ts`, the codemod for its imports.
- `bun run check:i18n` (`platform/tooling/check-i18n.ts`, run in CI): message key parity,
  namespace ownership and stale-override validation; `loadMessages`, `mergeMessages` and
  `staleOverrides` in `@web-app-starter/i18n`; `i18n.locales` in `app.config.ts` to ship a subset
  of the 15 locales.
- `platform/tooling/codemods/v2-convex-platform.ts`: the codemod for the Convex
  `convex/platform/` move (idempotent; `--check` for CI).
- `platform/VERSION` (the installed platform version), `platform/templates/README.md` and
  `platform/templates/LICENSE`, and
  `platform/tooling/app-config.ts dir <app>` / `APP_CONFIG_DIR_<APP>` for an app's directory.
- `app.config.ts` (root) and `@web-app-starter/app-config`: one typed, validated file for the values an app
  changes — identity (product name, legal entity, support email), runtime (local ports, Better
  Auth cookie prefix), brand (icon sources, design-token overrides, email palette, `lang` and
  footer) and feature switches (waitlist, invitations, announcements, environment banner).
  Invalid or unknown values stop dev, build and tests with a message naming each one. Shell
  scripts read it through `scripts/app-config.ts`, CI through `APP_CONFIG_*` variables exported
  by the `setup-bun` action, and each app's `dev` script through `scripts/next-dev.sh`.
  Turborepo treats it as a global dependency. Guide: `platform/docs/development.md`.
- `@web-app-starter/auth/cookies` (cookie names for the configured prefix) and
  `@web-app-starter/auth/clear-session` (the shared `clear-session` response).

### Changed

- Platform skills live in `platform/agent-skills/` and are linked into `.claude/skills/platform-*`
  and `.agents/skills/platform-*`: `platform-add-table`, `platform-add-page`,
  `platform-add-strings`, `platform-configure`, `platform-deps`, `platform-pr-review`,
  `platform-pr-respond`. They
  replace `.claude/commands/pr-review*.md` and `.agents/skills/deps-update` and `deps-major`.
  `bun run check:agent-skills` checks the links and frontmatter.
- The auth cookie prefix is configurable (`runtime.authCookiePrefix`, default `better-auth`, so
  existing sessions keep working). It reaches Better Auth (`advanced.cookiePrefix`), the Next.js
  auth helpers, both proxies, both `clear-session` routes and the Convex sessions API. Two apps on
  one host (localhost) no longer sign each other out when their prefixes differ.
- `clear-session` also clears the session cache, account cache, "don't remember" and Convex JWT
  cookies (and their chunks), and only this app's.
- The product name is no longer in the locale files: `common.appName` and `metadata.title` are
  removed from all 15 locales, and the landing "About" copy takes a `{productName}` argument.
  Page titles, headers, the landing footer (legal entity), the TOTP issuer and email footers read
  `app.config.ts`.
- Dev ports, Playwright base URLs, CI origins, `.env.example` local URLs and brand icons
  (`copy-shared-assets.sh`) follow `app.config.ts`. Local URL keys in the landing and web
  `.env.example` files are now empty and filled in from the config.
- Email templates (auth, invitation, admin invitation, verification) take their colours, `lang`
  and a new footer line from `brand.email`.
- Root `package.json` declares `"type": "module"`, so Node loads `app.config.ts` as ES modules;
  `tsconfig.base.json` allows `.ts` import extensions.
- Docs and skills follow the v2 layout: `platform/AGENTS.md` lists `bun run adopt`,
  `check:zone`, `test:contracts` and the `platform-patch` skill; `platform/README.md` documents
  adoption and its known gaps; `platform/docs/testing.md` drops examples for test helpers that
  no longer exist and uses the sample `projects` table; the README badge and workflow notes name
  the current workflows.

### Security

- Mock email and the dev seed run only in local development
  (`packages/backend/convex/developmentOnly.ts`: every `SITE_URL` origin must be plain HTTP on
  `localhost`, `*.localhost`, `127.0.0.1` or `[::1]`). Without `RESEND_API_KEY`, `sendAuthEmail`
  and the waitlist and admin invitation actions log to the console locally and throw
  `EMAIL_DELIVERY_NOT_CONFIGURED` elsewhere, instead of writing live links and tokens to hosted
  logs. `devSeed:seed` throws `DEV_SEED_NOT_LOCAL` outside local development even with
  `DEV_SEED_ENABLED=true`. `dev-start.sh` gives a fresh backend a provisional local `SITE_URL`
  before seeding.
- The session cookie is matched by exact name (`better-auth.session_token` or
  `__Secure-better-auth.session_token`) in `hasSessionCookie` (`@web-app-starter/edge-rate-limit`) and in
  the Convex sessions API, instead of by suffix or substring, so look-alike cookies such as
  `evil-better-auth.session_token` no longer count as a session.
- The Vercel build action takes the app's directory from the checkout and overrides the
  project's pulled Root Directory with it; the deploy action warns about, and works around, a
  Root Directory that is not in the checkout. Both also build or deploy commits from before
  the v2 layout.
- `packages/backend/convex/_generated/` is regenerated from the current functions (it was missing
  `developmentOnly`).

### Removed

- `lighthouserc.json`: nothing ran it (no Lighthouse CI dependency, script or workflow) and it
  pointed at a port and route that no longer matched any app.
- `.eslintrc.cjs`: ESLint 9 uses the flat config only, so the file was ignored.

## [1.0.0] - 2026-09-25 (prepared; never published)

This snapshot was prepared but never published or tagged. The entries and migration
instructions below describe that historical preparation; they do not establish a
supported adoption path or automatic-upgrade baseline. Use the v2.0.0 instructions above.

### Added

- Licensing: `LICENSE` (evaluation licence: free to evaluate, commercial licence required for
  production), and `COMMERCIAL-LICENSE.md` (Starter / Pro / Team tiers).
  **Downstream apps:** these files arrive with the merge and are your copy of the licence terms; keep them.
- Admin → Configure → Integrations shows live provider status instead of "Not yet implemented":
  Resend reports connected / not connected from `RESEND_API_KEY` and `EMAIL_FROM`; providers with
  no adapter yet (Mailgun, Postmark, Twilio, Sentry, Datadog, New Relic, Grafana) are labelled
  "Not available" with the variables they would need. Backend: `integrations.getStatus` (admin only).
- Runtime baseline: Node 24 (Active LTS) is declared in `.node-version` and `engines.node: "24.x"`,
  with `@types/node` 24 in every workspace. `bun run check:runtime-baseline` (CI) keeps Node and
  Bun versions consistent. Process: `platform/docs/dependency-migrations.md`.
- Landing: when the backend is unreachable, the hero shows a "Sign-up is temporarily unavailable"
  card with a Sign in button instead of rendering nothing. Optional `NEXT_PUBLIC_BOOK_DEMO_URL` and
  `NEXT_PUBLIC_CONTACT_URL` add Book a demo / Contact us buttons. New `landing.fallback.*` keys in all 15 locales.
- The existing standalone demo now includes Northstar Dispatch branding and
  interactive freight behavior. It also tests starter upgrades on a copy; its
  dashboard and editable UI remain application-owned.
- Waitlist: optional **Your role**, **Company** and **What do you plan to build?** fields on the landing
  form, shown as Role and Company / Use case columns in admin. Stored in the entry's `meta`; the backend
  validates them only when present, so existing clients keep working. New `landing.waitlist.*` keys in all 15 locales.
- Versioned `@web-app-starter/starter-sidebar-policy`, consumed through immutable local
  package artifacts. Demo-owned release fixtures live under `apps/demo/qa/fixtures/`.
  This does not publish a registry package or change operations.
- TypeScript/Node upgrade commands in `scripts/starter-upgrade/upgrade.ts`:
  `discover`, `plan`, `apply`, `verify`, `audit`. Unsupported baselines, local
  package edits, unsafe writes, missing actions and invalid evidence are rejected.
- Deterministic author/package/export/consumer ownership checks and a real demo
  rehearsal that reproduces a sidebar failure, upgrades, then runs interaction
  tests, typecheck and a production build. CI retains the evidence.
- `apps/demo/README.md` explains ownership and current limitations.
  `UPGRADING.md` separately teaches starter releases, application upgrade PRs
  and operations deployment. Existing mixed packages are not claimed as isolated;
  starter vendoring remains unsupported pending a copy contract. Operations
  never rewrites source or performs hidden migrations during deployment.
- `VERSIONING.md` — semver as it applies to a starter, the breaking-change budget
  (at most two majors a year), and the LTS window (previous major gets security
  fixes for six months).
- `UPGRADING.md` — the upstream-remote workflow, merge-by-tag, the known conflict
  hotspots with a prescribed resolution for each, and a procedure written for coding
  agents.
- `CHANGELOG.md` — this file.
- `.github/workflows/ci-verify.yml` — the main-only **CI Verify Commit** workflow runs
  existing CI against the exact merged commit and requires E2E. Tags are published
  only on a commit it has verified; publishing never deploys applications.
- `scripts/resolve-i18n-conflicts.ts` — resolves conflicted
  `packages/i18n/messages/*.json` by merging parsed objects key by key. Independent key changes can merge cleanly; overlapping changes require review.
  Blindly concatenating conflict hunks can produce invalid JSON.
- The development launcher and the locale resolver are TypeScript on Node
  (`scripts/dev-processes.ts`, `scripts/resolve-i18n-conflicts.ts`). Python is no
  longer required.
- `scripts/codemods/README.md` — the contract every shipped codemod meets
  (idempotent, `--check`, runs from the repo root, explains its own breaking change).
- `.claude/commands/upgrade-starter.md` — the upgrade procedure as a slash command,
  for downstream coding agents.

Release preparation, application adoption and deployment are separate.
`VERSIONING.md` documents what gets tagged; `UPGRADING.md` describes
verified source baselines and reviewed application merges. Broader package
extraction and a full customized-app/schema-migration rehearsal remain follow-up
work. The existing automated demo rehearsal covers the sidebar package only.

### Fixed

- Locale conflict resolution now reports delete/edit disagreements in both
  directions, including deleted namespaces, and preserves the application side
  for review. `--check` returns failure without modifying the file or Git index.
- Starter discovery uses namespaced local tags, avoiding collisions with business
  app release tags. Baselines record the exact adopted starter commit as well as
  its version. Patch releases do not promise conflict-free customized merges.

- Localization: web passkey settings, session errors and relative times, auth
  feedback, timezone names, and shared control accessibility labels use translated messages.
  The 17 multi-step sign-in keys now exist in all 15 locales. Both landing
  footers use `common.appName`, legal pages use existing translated copy, and
  the static landing 404 resolves its locale after hydration. Admin remains
  English-only and reuses English catalog entries for its application name and
  applicable existing labels. Catalog tests check required keys and ICU parameters.
- Upgrade guidance now treats hardcoded UI names as localization defects.
  Application-specific locale values and reviewed JSON merges remain supported;
  the single branding-config value and mandatory locale separation proposals
  are withdrawn.

- Legacy development PID cleanup now uses one open file descriptor, rejects linked
  or non-regular files, and does not overwrite or delete a replacement path.
  Process start-identity and checkout checks remain required before every signal.
- Shared/demo sidebar sizing now returns its 16rem default for non-finite resize
  calculations instead of allowing invalid CSS/state/cookies. Ordinary sizing and
  snapping behavior is preserved; editable visual components share a pure policy.
  Affected areas: design-system sidebar sizing and the demo's consumed
  `@web-app-starter/starter-sidebar-policy` (1.0.0 -> 1.0.1). Security urgency: none.
- Demo builds no longer overwrite app-owned branding with copied starter icons or
  require a Google Fonts request. Other apps keep their existing asset behavior.

### Action required

**TypeScript 6:** downstream apps that copied the starter's TypeScript setup must bump all
`typescript` declarations to `6.0.3`. Remove deprecated `baseUrl` settings; path aliases no longer
need it, but their targets must be explicitly relative (for example, `"@/*": ["./src/*"]`). Add
explicit ambient `types` where needed, including `"types": ["node"]` for Convex code that uses
`process.env`. Update the TypeScript ESLint stack to a release that supports TypeScript 6. Done
when `bun install --minimum-release-age=864000` and `bun run ci:quick` pass.

**Package adoption is optional.** Existing web/admin/backend consumers continue
using merge-by-tag; no database migration or operations change is introduced.
Demo-derived apps must preserve their dashboard, editable UI and branding when
merging these changes. Follow [the package upgrade guide](../apps/demo/README.md)
only when adopting this explicit ownership/dependency contract. Keep the manifest,
package artifact, lock and required tests together. Done when
`bun run check:starter-ownership`, `bun run test:starter-upgrade` and
`bun run test:starter-rehearsal` pass. Local fixture versions are not starter tags.

**Every existing business app**, once:

1. Add the starter as a remote and fetch its tags:
   ```bash
   git remote add upstream https://github.com/tkarakai/web-app-starter.git
   git fetch upstream --no-tags 'refs/heads/main:refs/remotes/upstream/main' 'refs/tags/v*:refs/tags/starter/v*'
   ```
2. Establish the exact starter source commit your app includes. Do not stamp
   `v1.0.0` merely because your app shares history. After the tag is published,
   merge it, resolve app-specific changes and verify applicable required actions;
   then record that release and its resolved commit in `.starter-version` using the setup procedure in `UPGRADING.md`.
3. Confirm you share history with the starter:
   ```bash
   git merge-base HEAD upstream/main
   ```
   A commit proves shared history, not adoption of a particular release. If it errors, follow
   [Apps with no shared history](./UPGRADING.md#apps-with-no-shared-history).

Done when the starter source baseline and history relationship are recorded, and
any claimed release resolves to the verified starter commit with required actions
completed. New apps cloned from the published `v1.0.0` tag can record that exact
tag/commit immediately; their own setup and deployment still need validation.

[Unreleased]: https://github.com/tkarakai/web-app-starter/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/tkarakai/web-app-starter/releases/tag/v2.0.0
