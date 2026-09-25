---
description: Merge a newer starter release into this business app and health-check it
---

Upgrade this app to a newer web-app-starter release. Target version: $ARGUMENTS
(if empty, use the newest tag available from `upstream`).

Follow `UPGRADING.md` — it is the source of truth, this command is the short form.

1. Fetch starter releases into `refs/tags/starter/v*` using the exact one-time setup
   command in `UPGRADING.md` (without importing application-conflicting tags). Read `.starter-version` for the current baseline.
   List releases with `git tag -l 'starter/v*' --sort=v:refname`.
   If there is no `upstream` remote or no `.starter-version`, do the one-time setup
   in `UPGRADING.md` first.
2. Read the `CHANGELOG.md` entry for **each** release between the baseline and the
   target. Collect every **Action required** item — they compose across intermediate
   versions, so a jump of three releases means doing all three sets, in order.
3. Create a branch `chore/starter-<target>` and `git merge refs/tags/starter/<tag>`.
   Never rebase. Never merge `upstream/main`.
4. Resolve conflicts using [Known conflict hotspots](../../UPGRADING.md#known-conflict-hotspots)
   and the ownership guidance in [For coding agents](../../UPGRADING.md#for-coding-agents).
   Those sections own the resolution rules, including locale merging and files
   outside the hotspot list.
5. Do the Action required items from step 2, including running any codemod the
   release ships under `scripts/codemods/`.
6. `bun install`, then `bun run ci:quick`. Fix what it reports.
7. Run each release's **done when** check literally, as written, and paste the output.
   They exist to catch failures that are invisible otherwise — a security fix reverted
   by a branding conflict still compiles and still passes CI.
8. Write the verified release name and resolved commit to `.starter-version`, commit, and report: versions taken,
   files that conflicted, action-required items done with their done-when output, the
   CI result, and any deploy-time step (a migration, a new env var) still outstanding.

**A clean merge is not a successful upgrade.** Zero conflicts is normal for a major
that renames platform API used by this app's own code — git has nothing to conflict
about, and the build breaks anyway. Never report success on conflict count alone.

If an action-required item cannot be completed, stop and say which one and why —
do not land a half-applied upgrade.
