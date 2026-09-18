# Versioning policy

This repo is a **starter**: business apps clone it and keep taking updates from it
for years. That makes our version numbers a promise to those apps, not a bookkeeping
detail. This document is that promise.

See [`UPGRADING.md`](./UPGRADING.md) for how a business app actually takes an update,
and [`CHANGELOG.md`](./CHANGELOG.md) for what changed in each one.

## Semver, applied to a starter

We publish **git tags**, `vMAJOR.MINOR.PATCH`, on `main`. The repo is the unit of
versioning — individual workspace packages stay `private` and are not separately
versioned until Phase 2 of [`docs/starter-versioning-strategy.md`](./docs/starter-versioning-strategy.md).

Because we distribute source you own rather than a package you install, the usual
semver definitions need one adjustment: *"breaking"* means **breaking to a business
app that merges this tag**, which includes changes that compile fine but silently
change behaviour, and changes that require a manual step after the merge.

| Bump | Means | Examples |
|------|-------|----------|
| **PATCH** (`1.0.0` → `1.0.1`) | Merge it and you are done. No action required, ever. | Security fix inside a platform file, bug fix, dependency patch, docs. |
| **MINOR** (`1.0.0` → `1.1.0`) | New capability. Merge is safe, but there may be **optional** follow-up to adopt the new thing. | New Convex table or function, new design-system component, new locale key, new script. |
| **MAJOR** (`1.0.0` → `2.0.0`) | **Action required.** The merge will not be complete until you do something. | Changed auth interface, renamed export, removed script, schema migration, moved file a downstream app certainly edited. |

The rule we hold ourselves to: **if a downstream app can merge the tag, run
`bun run ci:quick`, and ship — it is not a major.** If green CI is achievable only
after a human edits something, it is a major, no matter how small the diff looks
from in here.

## Action-required notes are part of the release

Every MAJOR, and every MINOR that has optional adoption steps, ships an
**Action required** section in `CHANGELOG.md`. A release without one is a release
we are asserting is a clean merge for everybody. Getting that assertion wrong is
the most expensive mistake available to us, so when in doubt, write the note and
bump the larger number.

Each action-required item states, in this order:

1. **Who is affected** — every app, or only apps that use feature X.
2. **What to do**, as a concrete command or a file-and-line edit.
3. **How to tell you are done** — the check that goes from red to green.

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

Only `main`, and only after CI is green on it. Cutting a release is:

```bash
./scripts/release.sh 1.2.0        # verifies, updates version + CHANGELOG, tags
git push origin main --follow-tags
```

`scripts/release.sh` refuses to tag when the working tree is dirty, when you are not
on `main`, when the version does not move forward, or when `CHANGELOG.md` has no
entry for the version being cut. Those refusals are the policy above, enforced.

## Pre-1.0 history

Tags start at `v1.0.0`. Everything before it is untagged history, and the starter
made no propagation promises then. Business apps created before `v1.0.0` should
follow the "adding the upstream remote to an existing app" section of
[`UPGRADING.md`](./UPGRADING.md) to get onto the rail.
