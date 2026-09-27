# Versioning policy

This repo is a **starter**: business apps clone it and keep taking updates from it
for years. That makes our version numbers a promise to those apps, not a bookkeeping
detail. This document is that promise.

See [`UPGRADING.md`](./UPGRADING.md) for how a business app actually takes an update,
and [`CHANGELOG.md`](./CHANGELOG.md) for what changed in each one.

## Semver, applied to a starter

We publish **git tags**, `vMAJOR.MINOR.PATCH`, on `main`. Each release versions the
platform as a whole. Apps take it with `bun run platform:upgrade`;
`.platform-base.json` records the installed version, exact source commit and patches.
The root package version belongs to the app. Most workspace packages remain private
and unversioned independently.

One explicit exception is `@web-app-starter/starter-sidebar-policy`, versioned independently
at `1.0.1` for the [demo package upgrade](../apps/demo/README.md). The immutable
local package fixtures `1.0.0` and `1.0.1` identify package content and a supported
upgrade transition, not published registry releases or starter git tags. They do
not start a new starter LTS window. Add a new package version for changed artifact
bytes; do not rewrite historical fixtures. Registry publishing and broader
package extraction remain follow-up work.

Because we distribute source you own rather than a package you install, the usual
semver definitions need one adjustment: *"breaking"* means **breaking to a business
app that adopts this release**, which includes changes that compile fine but silently
change behaviour, and changes that require a manual upgrade step.

| Bump | Means | Examples |
|------|-------|----------|
| **PATCH** (`2.0.0` → `2.0.1`) | No starter-required migration or configuration change. | Security fix inside a platform file, bug fix, dependency patch, docs. |
| **MINOR** (`2.0.0` → `2.1.0`) | New capability with no required migration; there may be **optional** follow-up to adopt it. | New Convex table or function, new design-system component, new locale key, new script. |
| **MAJOR** (`2.0.0` → `3.0.0`) | **Action required.** Adoption requires a migration or compatibility change. | Changed auth interface, renamed export, removed script, schema migration, moved file a downstream app certainly edited. |

Seam conflicts and reviews of recorded platform patches can occur at any version.
They do not by themselves make a release breaking. A major is required
when starter changes require downstream compatibility work, such as adapting an
API, changing required configuration or migrating stored data. Passing source CI
does not prove that deployment-time migrations are complete.

## Action-required notes are part of the release

Every MAJOR, and every MINOR that has optional adoption steps, ships an
**Action required** section in `CHANGELOG.md`. A release without one asserts that no starter-required adoption steps exist; it
does not promise conflict-free merges for customized apps. When in doubt, explain
the compatibility impact and choose the appropriate larger version.

Each action-required item states, in this order:

1. **Who is affected** — every app, or only apps that use feature X.
2. **What to do**, as a concrete command or a file-and-line edit.
3. **How to tell you are done** — the check that goes from red to green.

Where the change is mechanical, the action-required item invokes a **codemod** shipped
in the same release under `platform/tooling/codemods/` — see that directory's `README.md` for
the contract. Describing a rename and asking every downstream team to perform it is
not a migration path.

Items are written to be executable by a coding agent as well as a human: downstream
repos carry `AGENTS.md`, `CLAUDE.md` and linked platform skills, so a share of the
upgrade work is done by agents. That means no "see the docs for details", no "adjust as needed" —
name the file, name the symbol, name the command.

## Breaking-change budget

**At most two majors per year**, and never two within one quarter.

Every major costs every business app a scheduled, human-attended upgrade. The budget
exists so that cost is a deliberate decision rather than an accumulation of individually
reasonable ones. Practical consequences:

- A breaking change that can wait, waits, and rides along with the next major.
- We prefer a deprecation that keeps working over a rename that does not.
- When we do spend a major, we batch into it every breaking change we have been
  holding, so apps pay the upgrade tax once.

## LTS window

**The current major is supported. The previous major receives security fixes for
six months after its successor ships.**

This applies to published major lines. Publication begins with `v2.0.0`;
`v1.0.0` was prepared but never published, so there is no v1 support branch or LTS window.
For example, once a future `v3.0.0` is tagged:

- `v3.x` gets everything.
- `v2.x` gets security fixes only, as `v2.x.y` patch tags cut from a `release/v2.x`
  branch, for six months.
- After six months, `v2.x` is closed. Apps still on it use an unmaintained line
  until they upgrade.

Six months is chosen to be one full upgrade-planning cycle for a downstream team,
without committing us to backporting into a branch that has drifted so far that the
backport is a rewrite.

## What gets tagged

A release's version and notes are reviewed in a pull request like any other
change: the platform version in `platform/VERSION` and a dated `platform/CHANGELOG.md` section. The
changelog date records preparation; the GitHub release records publication.

Tags are created afterward, only on a commit that is already on `main` and has
passed every CI workflow, E2E included, on that exact commit (the **CI Verify
Commit** workflow). No tag is ever placed on untested content, and publishing a
tag never deploys anything. What that means for your app:

- **Tags are immutable.** A published `vX.Y.Z` never moves and its release is never
  replaced. If a release is wrong, a new version fixes it.
- **Tags are only on `main`.** This repo squash-merges, so a tag on a feature
  branch would carry history that `main` never had, and merging it could import a
  parallel history into your app. No starter tag is placed on a PR branch.
- **The release notes are the changelog section** for that version, including its
  **Action required** items.
- **Your own tags stay yours.** The upgrade launcher resolves platform releases in
  an isolated cache and never overwrites your app's `v*` tags.

## Before the first published release

Publication starts at `v2.0.0`. The prepared v1 snapshot and earlier source forks
are not supported automatic-upgrade baselines. Existing apps need the one-time v2
layout and data migration described in the release's **Action required** notes and
[`UPGRADING.md`](./UPGRADING.md). Do not invent a `.platform-base.json` record or run
fresh-clone adoption over an existing business app. Automatic upgrades begin once
an exact separated-platform release has been adopted and verified.
