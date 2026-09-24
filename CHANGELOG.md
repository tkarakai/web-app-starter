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

- Executable downstream-upgrade canary in the existing `apps/demo`, with app-owned
  Northstar Dispatch branding, freight-priority behavior, editable UI and a consumed
  immutable sidebar-policy snapshot. This is an offline source-bundle rail, not
  package publishing or operations integration.
- Versioned ownership/lock/catalogue/plan/evidence contracts and
  `scripts/foundation/upgrade.py` (`discover`, `plan`, `apply`, `verify`, `audit`).
  Unsafe writes, unsupported baselines, drift, missing actions and unverifiable
  completion are refused. CI Shared requires the real demo's red-to-green upgrade
  rehearsal with interaction tests, typecheck and production build.
- `docs/foundation-canary.md` — enrollment, upgrade PR procedure, limits and the
  three planes: immutable foundation releases (affected layers, security urgency,
  migrations, codemods, verification commands, canary evidence), explicit
  business-app upgrade PRs that preserve application-owned code, and an operations
  plane that presents readiness and deploys only the merged app commit through
  normal staging and production, never rewriting source or running hidden
  migrations. Existing merge/deploy approvals remain unchanged.
- `VERSIONING.md` — semver as it applies to a starter, the breaking-change budget
  (at most two majors a year), and the LTS window (previous major gets security
  fixes for six months).
- `UPGRADING.md` — the upstream-remote workflow, merge-by-tag, the known conflict
  hotspots with a prescribed resolution for each, and a procedure written for coding
  agents.
- `CHANGELOG.md` — this file.
- `scripts/release.sh` — cuts a release: verifies the tree, bumps `package.json`,
  promotes the `Unreleased` section, and tags.
- `scripts/resolve-i18n-conflicts.py` — resolves conflicted
  `packages/i18n/messages/*.json` by merging parsed objects key by key. Locale files
  conflict in all 15 at once on any key addition, and the intuitive "keep both sides"
  resolution produces invalid JSON there.
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

- Shared/demo sidebar sizing now returns its 16rem default for non-finite resize
  calculations instead of allowing invalid CSS/state/cookies. Ordinary sizing and
  snapping behavior is preserved; editable visual components share a pure policy.
  Affected layers: design-system sidebar policy and the demo's consumed
  `sidebar-width-snapshot` (1.0.0 -> 1.0.1). Security urgency: none (stability fix).
- Demo builds no longer overwrite app-owned branding with copied starter icons or
  require a Google Fonts request. Other apps keep their existing asset behavior.

### Action required

**Canary adoption is optional.** Existing web/admin/backend consumers stay on the
merge-by-tag rail; no database migration or operations change is introduced.
Demo-derived apps should preserve their own dashboard and branding when merging
scaffold changes. To opt into the narrow managed snapshot rail, follow
[`docs/foundation-canary.md`](./docs/foundation-canary.md#joining-this-rail-in-a-business-app)
and keep the action/business verification scripts, manifest and locked snapshot
together. Done when `bun run test:foundation` and `bun run test:foundation-canary`
pass. The fixture versions are not published starter tags.

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
