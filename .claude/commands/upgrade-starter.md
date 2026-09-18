---
description: Merge a newer starter release into this business app and health-check it
---

Upgrade this app to a newer web-app-starter release. Target version: $ARGUMENTS
(if empty, use the newest tag available from `upstream`).

Follow `UPGRADING.md` — it is the source of truth, this command is the short form.

1. `git fetch upstream --tags`. Read `.starter-version` for the current baseline.
   List releases with `git tag -l 'v*' --sort=v:refname` — the `'v*'` filter matters,
   deploy tags outnumber release tags here.
   If there is no `upstream` remote or no `.starter-version`, do the one-time setup
   in `UPGRADING.md` first.
2. Read the `CHANGELOG.md` entry for **each** release between the baseline and the
   target. Collect every **Action required** item — they compose across intermediate
   versions, so a jump of three releases means doing all three sets, in order.
3. Create a branch `chore/starter-<target>` and `git merge <tag>`.
   Never rebase. Never merge `upstream/main`.
4. Resolve conflicts using the "Known conflict hotspots" table in `UPGRADING.md`:
   - locale files: run `./scripts/resolve-i18n-conflicts.py`. Do not hand-edit them
     and do not keep both sides — that produces invalid JSON.
   - `bun.lock`: take either side, then `bun install`. Never hand-edit.
   - `schema.ts`: keep both sides.
   - a branded line: if the starter changed code around the string, take their line
     and re-apply your brand; if they only changed wording, keep yours.
   - not on the list: starter's side in `packages/`, `scripts/`, `.github/`; this
     app's side in app code it wrote. If you cannot tell, keep both sides and let the
     type checker decide. Never resolve by deleting the side you did not write.
5. Do the Action required items from step 2, including running any codemod the
   release ships under `scripts/codemods/`.
6. `bun install`, then `bun run ci:quick`. Fix what it reports.
7. Run each release's **done when** check literally, as written, and paste the output.
   They exist to catch failures that are invisible otherwise — a security fix reverted
   by a branding conflict still compiles and still passes CI.
8. Write the new version to `.starter-version`, commit, and report: versions taken,
   files that conflicted, action-required items done with their done-when output, the
   CI result, and any deploy-time step (a migration, a new env var) still outstanding.

**A clean merge is not a successful upgrade.** Zero conflicts is normal for a major
that renames platform API used by this app's own code — git has nothing to conflict
about, and the build breaks anyway. Never report success on conflict count alone.

If an action-required item cannot be completed, stop and say which one and why —
do not land a half-applied upgrade.
