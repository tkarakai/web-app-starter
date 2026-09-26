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

- **Who is affected:** apps whose hosted (staging or production) Convex deployment has no
  `RESEND_API_KEY`. Auth and invitation emails there used to be written to the Convex logs;
  they now fail with `EMAIL_DELIVERY_NOT_CONFIGURED`.
  **What to do:** `CONVEX_DEPLOY_KEY=<key> bunx convex env set RESEND_API_KEY <key>` and
  `... bunx convex env set EMAIL_FROM <address>` on each hosted deployment.
  **Done when:** `CONVEX_DEPLOY_KEY=<key> bunx convex env get RESEND_API_KEY` prints a value
  for every hosted deployment. Local development is unchanged.

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
  `__Secure-better-auth.session_token`) in `hasSessionCookie` (`@repo/edge-rate-limit`) and in
  the Convex sessions API, instead of by suffix or substring, so look-alike cookies such as
  `evil-better-auth.session_token` no longer count as a session.

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
  Bun versions consistent. Process: `docs/dependency-migrations.md`.
- Landing: when the backend is unreachable, the hero shows a "Sign-up is temporarily unavailable"
  card with a Sign in button instead of rendering nothing. Optional `NEXT_PUBLIC_BOOK_DEMO_URL` and
  `NEXT_PUBLIC_CONTACT_URL` add Book a demo / Contact us buttons. New `landing.fallback.*` keys in all 15 locales.
- The existing standalone demo now includes Northstar Dispatch branding and
  interactive freight behavior. It also tests starter upgrades on a copy; its
  dashboard and editable UI remain application-owned.
- Waitlist: optional **Your role**, **Company** and **What do you plan to build?** fields on the landing
  form, shown as Role and Company / Use case columns in admin. Stored in the entry's `meta`; the backend
  validates them only when present, so existing clients keep working. New `landing.waitlist.*` keys in all 15 locales.
- Versioned `@repo/starter-sidebar-policy`, consumed through immutable local
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
- `scripts/release.sh` — prepares version/changelog changes for a reviewed PR
  without committing or tagging. The main-only **Starter Release** workflow runs
  existing CI against the exact merged commit, requires E2E, then publishes an
  immutable tag and GitHub release. It does not deploy applications.
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
`VERSIONING.md` documents preparation and publication; `UPGRADING.md` describes
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
  `@repo/starter-sidebar-policy` (1.0.0 -> 1.0.1). Security urgency: none.
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
merging these changes. Follow [the package upgrade guide](./apps/demo/README.md)
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
