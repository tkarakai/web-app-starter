# Versioning policy

This repo is a **starter**: business apps clone it and keep taking updates from it
for years. That makes our version numbers a promise to those apps, not a bookkeeping
detail. This document is that promise.

See [`UPGRADING.md`](./UPGRADING.md) for how a business app actually takes an update,
and [`CHANGELOG.md`](./CHANGELOG.md) for what changed in each one.

## Semver, applied to a starter

We publish **git tags**, `vMAJOR.MINOR.PATCH`, on `main`. The repo is the unit of
versioning for merge-by-tag upgrades; `.starter-version` records that baseline.
Most workspace packages remain private and unversioned independently.

One explicit exception is `@web-app-starter/starter-sidebar-policy`, versioned independently
at `1.0.1` for the [demo package upgrade](../apps/demo/README.md). The immutable
local package fixtures `1.0.0` and `1.0.1` identify package content and a supported
upgrade transition, not published registry releases or starter git tags. They do
not start a new starter LTS window. Add a new package version for changed artifact
bytes; do not rewrite historical fixtures. Registry publishing and broader
package extraction remain follow-up work.

Because we distribute source you own rather than a package you install, the usual
semver definitions need one adjustment: *"breaking"* means **breaking to a business
app that merges this tag**, which includes changes that compile fine but silently
change behaviour, and changes that require a manual step after the merge.

| Bump | Means | Examples |
|------|-------|----------|
| **PATCH** (`1.0.0` → `1.0.1`) | No starter-required migration or configuration change. | Security fix inside a platform file, bug fix, dependency patch, docs. |
| **MINOR** (`1.0.0` → `1.1.0`) | New capability. Merge is safe, but there may be **optional** follow-up to adopt the new thing. | New Convex table or function, new design-system component, new locale key, new script. |
| **MAJOR** (`1.0.0` → `2.0.0`) | **Action required.** Adoption requires a migration or compatibility change. | Changed auth interface, renamed export, removed script, schema migration, moved file a downstream app certainly edited. |

Ordinary conflict resolution is expected for customized source and can happen at
any version. It does not by itself make a release breaking. A major is required
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
repos carry `CLAUDE.md` and `.claude/commands/`, so a share of the merging will be
done by agents. That means no "see the docs for details", no "adjust as needed" —
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

Concretely, once `v2.0.0` is tagged:

- `v2.x` gets everything.
- `v1.x` gets security fixes only, as `v1.x.y` patch tags cut from a `release/v1.x`
  branch, for six months.
- After six months, `v1.x` is closed. Apps still on it can merge, but they are
  merging from an unmaintained line.

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
- **Your own tags stay yours.** Fetch starter tags under a separate prefix, as
  [`UPGRADING.md`](./UPGRADING.md) shows, so they never collide with your app's own
  `v*` tags.

## Pre-1.0 history

Tags start at `v1.0.0`. Everything before it is untagged history, and the starter
made no propagation promises then. Business apps created before `v1.0.0` should
follow the "adding the upstream remote to an existing app" section of
[`UPGRADING.md`](./UPGRADING.md) to establish a known starter baseline.
