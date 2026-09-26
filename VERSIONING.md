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

One explicit exception is `@repo/starter-sidebar-policy`, versioned independently
at `1.0.1` for the [demo package upgrade](./apps/demo/README.md). The immutable
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
in the same release under `scripts/codemods/` — see that directory's `README.md` for
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

Release metadata is reviewed in a PR. Tagging happens afterward, on the exact
merged commit that passes release CI. No release command creates a new commit
and immediately tags untested content.

### Prepare the release PR

Start with a clean branch and a nonempty `Unreleased` changelog section:

```bash
./scripts/release.sh 1.0.0 --dry-run
./scripts/release.sh 1.0.0
git diff -- package.json CHANGELOG.md
git add package.json CHANGELOG.md
git commit -m "chore(release): prepare v1.0.0"
./scripts/release.sh 1.0.0 --check
```

The preparation script changes only the root package version and changelog. It
never commits, tags or pushes. It rejects dirty trees, invalid/backward versions,
empty release notes and major bumps without action-required notes. Submit these
changes through the normal PR checks. The changelog date records preparation;
the GitHub release records actual publication time.

### Publish after the PR merges

In GitHub Actions, run **Starter Release** (`release-starter.yml`) on **main**,
with version `1.0.0`. This is an explicit maintainer action, separate from merging
the PR. This workflow is restricted to the starter repository; it is inactive in
downstream business apps, whose versions and publication process are independent.
The workflow:

1. Resolves and checks the prepared main commit and release notes.
2. Runs the existing shared, web, admin, landing, landing-static and Storybook CI
   against that exact commit. E2E checks are required even if `SKIP_E2E` is set.
   Shared CI includes the demo package upgrade rehearsal.
3. Checks that main has not advanced, creates an annotated `v1.0.0` tag, and
   creates a GitHub release from the prepared notes. It does not deploy apps.

Failure or cancellation prevents publication. If main advances during validation,
rerun on the new main commit. A retry can reuse a tag only when it already points
to the same commit; it cannot move a tag or replace an existing release.

### Never tag a PR branch

This repo squash-merges. A feature-branch tag would retain history that the squash
never puts on main. Downstream apps merging that tag could then import a parallel
history. Preparation on a feature branch is safe because it creates no tags.

Use isolated temporary repositories for release tests. Never create practice
`v*` tags in a checkout that shares refs with other worktrees. The behavior tests
in `scripts/tests/release.test.ts` use disposable repositories.

## Pre-1.0 history

Tags start at `v1.0.0`. Everything before it is untagged history, and the starter
made no propagation promises then. Business apps created before `v1.0.0` should
follow the "adding the upstream remote to an existing app" section of
[`UPGRADING.md`](./UPGRADING.md) to establish a known starter baseline.
