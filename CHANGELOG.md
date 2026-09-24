# Changelog

All notable changes to this starter, for the business apps that merge it.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [semver as defined in `VERSIONING.md`](./VERSIONING.md) — read that first
if you are wondering why a small-looking change was a major.

Every release that requires anything of a downstream app has an **Action required**
section. A release without one is a promise that merging the tag and running
`bun run ci:quick` is the whole upgrade. How to actually take a release:
[`UPGRADING.md`](./UPGRADING.md).

## [Unreleased]

First tagged release. The baseline: the starter as it exists today, with a version
number attached to it and a documented, validated way to take future ones.

### Added

- Licensing: `LICENSE` (evaluation licence: free to evaluate, commercial licence required for
  production), `COMMERCIAL-LICENSE.md` (Starter / Pro / Team tiers) and `TERMS-OF-SALE.md`.
  **Downstream apps:** these files arrive with the merge and are your copy of the licence terms; keep them.
- Runtime baseline: Node 24 (Active LTS) is declared in `.node-version` and `engines.node: "24.x"`,
  with `@types/node` 24 in every workspace. `bun run check:runtime-baseline` (CI) keeps Node and
  Bun versions consistent. Process: `docs/dependency-migrations.md`.
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
- `docs/starter-upgrades.md` explains ownership and current limitations.
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
- `scripts/release.sh` — cuts a release: verifies the tree, bumps `package.json`,
  promotes the `Unreleased` section, and tags.
- `scripts/resolve-i18n-conflicts.ts` — resolves conflicted
  `packages/i18n/messages/*.json` by merging parsed objects key by key. Locale files
  conflict in all 15 at once on any key addition, and the intuitive "keep both sides"
  resolution produces invalid JSON there.
- The development launcher and the locale resolver are TypeScript on Node
  (`scripts/dev-processes.ts`, `scripts/resolve-i18n-conflicts.ts`). Python is no
  longer required.
- `scripts/codemods/README.md` — the contract every shipped codemod meets
  (idempotent, `--check`, runs from the repo root, explains its own breaking change).
- `.claude/commands/upgrade-starter.md` — the upgrade procedure as a slash command,
  for downstream coding agents.

`scripts/release.sh` refuses to tag a commit that is not yet reachable from
`origin/main`. This repo squash-merges, so a tag cut on a feature branch would
survive the merge pointing at commits that never reach `main`, and a business app
merging that tag would pull an orphaned parallel history. A checkout with no
`origin/main` — a throwaway clone used to rehearse a release — skips the check, which
is where practice tags belong.

### Fixed

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

**Package adoption is optional.** Existing web/admin/backend consumers continue
using merge-by-tag; no database migration or operations change is introduced.
Demo-derived apps must preserve their dashboard, editable UI and branding when
merging these changes. Follow [the package upgrade guide](./docs/starter-upgrades.md)
only when adopting this explicit ownership/dependency contract. Keep the manifest,
package artifact, lock and required tests together. Done when
`bun run check:starter-ownership`, `bun run test:starter-upgrade` and
`bun run test:starter-rehearsal` pass. Local fixture versions are not starter tags.

**Every existing business app**, once:

1. Add the starter as a remote and fetch its tags:
   ```bash
   git remote add upstream https://github.com/tkarakai/web-app-starter.git
   git fetch upstream --tags
   ```
2. Record your baseline so future upgrades know where to start:
   ```bash
   echo "STARTER_VERSION=v1.0.0" > .starter-version
   git add .starter-version && git commit -m "chore: record starter baseline v1.0.0"
   ```
3. Confirm you share history with the starter:
   ```bash
   git merge-base HEAD upstream/main
   ```
   If this prints a commit, you are done. If it errors, follow
   [Apps with no shared history](./UPGRADING.md#apps-with-no-shared-history).

Done when `cat .starter-version` prints `STARTER_VERSION=v1.0.0` and
`git tag -l 'v*'` lists the starter's tags.
