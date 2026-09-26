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

### Action required

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

- `platform/tooling/codemods/v2-platform-packages.ts`: the codemod for the package rename and
  move (idempotent; `--check` for CI).
- `platform/tooling/codemods/v2-convex-platform.ts`: the codemod for the Convex
  `convex/platform/` move (idempotent; `--check` for CI).
- `platform/VERSION` (the installed platform version), `platform/templates/README.md` and
  `platform/templates/LICENSE` (draft, pending legal review), and
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

## [1.0.0] - 2026-09-25

First tagged release. The baseline: the starter as it exists today, with a version
number attached to it and a documented source-merge upgrade process. This is the
first supported starting point, not proof of arbitrary pre-release app upgrades.

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

[Unreleased]: https://github.com/tkarakai/web-app-starter/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tkarakai/web-app-starter/releases/tag/v1.0.0
