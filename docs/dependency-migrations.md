# Dependency migrations and the runtime baseline

Renovate (see [`dependency-updates.md`](dependency-updates.md)) handles updates that are only a
version bump. This document covers the two kinds that are not:

1. **Migrations**: a major (occasionally a minor) that needs code changes before CI is green.
2. **Runtime-baseline changes**: moving a runtime or platform everything else depends on, such as
   Node or Bun.

Both are normally found in a `deps-update` run and decided with the `deps-major` skill, which
sets who may merge: the agent for dev tooling and runtime libraries, the user for the sensitive
frameworks, the runtime baseline and security-relevant behaviour changes.

## Migrations

### When something counts as a migration

A migration is a Renovate PR (or *Pending Approval* major) whose CI fails, or would fail, for a
reason other than flakiness: removed APIs, changed types, a peer that must move with it, or a
required config change. If the blocker is outside this repo, such as an upstream peer range that
does not accept the new version yet, that is a **hold** instead (a `HOLD:` rule in
`renovate.json`), not a migration.

### Process

1. **Decide and record.** The `deps-major` skill opens a ticket titled `deps: <package> <from> → <to>` containing the
   Renovate PR or dashboard item, the upstream migration guide, the failure evidence, and what is
   affected: which apps and packages, and which user-visible behavior. The decision (*now*, *hold* with a `HOLD:` rule linking the
   issue, or *never*) follows the `deps-major` skill, and is recorded in `dependency-log.md`.
2. **Branch.** Work on `deps/<package>-<major>` from `main`. Never commit on `renovate/*`. Apply the
   bump there yourself with `bun add`, respecting the ten-day release age
   (`bun install --minimum-release-age=864000`).
3. **Scope.** Change only the bump and what it forces. Follow the upstream guide and run its official
   codemod if one exists. Do not refactor or tidy unrelated code in the same PR; if something is
   tempting, open a follow-up issue.
4. **Prove behavior, not just compilation.** A green typecheck is necessary but not sufficient.
   Name the behavior the package provides (e.g. table sorting, paging and selection for TanStack
   Table; password scoring and its messages for zxcvbn). Show it is unchanged with existing tests.
   Where coverage is missing, add tests **before** the bump so they run against both versions.
5. **Validate.** Run `bun run ci` locally (including E2E for anything user-facing), then CI on the PR.
   For the sensitive frameworks listed in `dependency-updates.md`, also check the staging deploy
   after merge.
6. **Downstream.** This repo is a starter, and business apps merge it (see `VERSIONING.md`). If a
   downstream app would have to do anything besides merging and running `bun run ci:quick`
   (renamed exports, changed component props, a peer they must also bump), add an **Action
   required** entry to `CHANGELOG.md`. Where the change is mechanical, ship a codemod per
   `scripts/codemods/README.md`.
7. **Close out.** The PR body links the migration issue and states what was verified. Close the
   Renovate PR with a link to the migration PR. Remove any `HOLD:` rule the migration resolves.

### Rollback

Every migration is a single squash commit on `main`. Roll back with an ordinary revert PR, then add
a `HOLD:` rule so Renovate does not immediately propose the version again.

## Runtime baseline

Some versions are not ordinary dependencies. They decide which runtime the code actually runs on,
and several files must agree about them. If they disagree, code passes CI on one runtime and fails
in production on another. For example, `@types/node` for Node 26 lets TypeScript accept APIs that
crash on a Node 24 server.

**Policy: run on the current Active LTS**, and move to the next LTS line once it becomes Active LTS
(Node: even majors, each October) *and* every host below supports it.

### Components

| Runtime | Must agree | Checked by |
|---|---|---|
| **Node** major | `.node-version`; root `engines.node`; `node-version` in `.github/actions/setup-bun/action.yml` and explicit `node-version:` in workflows; `@types/node` major in every workspace | `bun run check:runtime-baseline` (CI) |
| **Bun** exact version | root `packageManager`; `bun-version` default in `.github/actions/setup-bun/action.yml` | `bun run check:runtime-baseline` (CI) |
| **Vercel** Node version | each Vercel project's Node.js setting (web, admin, landing, landing-static) | manual: Vercel project settings, part of the baseline playbook |
| **Convex** | Convex runs our functions in its managed runtime. No `"use node"` actions exist today. If any are added, the Node version for Convex actions joins this table | manual |
| **GitHub runner / act image** | `ubuntu-latest`, and `catthehacker/ubuntu:act-latest` in `.actrc` | not pinned: they follow GitHub's image. Only the Node and Bun set up on them matter |

Treat a platform we rely on as part of this table whenever its version is something we choose.
Anything the platform upgrades for us is not part of it.

### How a baseline move starts

- **Node**: Renovate reads `.node-version`. Its Node versioning counts only LTS lines as stable, so
  it proposes the next major once it is LTS. That major waits under *Pending Approval* on the
  dashboard like any other. The `@types/node` `HOLD:` rule stops the types running ahead.
- **Bun**: Renovate proposes `packageManager` bumps. `check:runtime-baseline` fails that PR until the
  `setup-bun` default matches, so the PR is completed on a `deps/` branch, or the `setup-bun` default
  is added to the same change.

### Baseline playbook

Do this as one PR on `deps/node-<major>` (or `deps/bun-<version>`):

1. Confirm the new line is Active LTS and that Vercel supports it (and Convex, if relevant).
2. Update every "must agree" location in the table. Lift the `@types/node` hold to the new
   major (`<next>`) and bump `@types/node` to it.
3. Re-check holds whose REMOVE condition mentions the Node floor.
4. `bun run check:runtime-baseline`, then `bun run ci`.
5. Update the Vercel project Node settings as part of the merge, and verify the staging deploy
   before any production promote.
6. Add a `CHANGELOG.md` **Action required** entry: downstream apps must install the new Node locally
   and update their own Vercel settings.
