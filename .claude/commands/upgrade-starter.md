---
description: Merge a newer starter release into this business app and health-check it
---

Upgrade this app to a newer web-app-starter release. Target version: $ARGUMENTS
(if empty, use the newest tag available from `upstream`).

Follow `UPGRADING.md` — it is the source of truth, this command is the short form.

1. `git fetch upstream --tags`. Read `.starter-version` for the current baseline.
   If there is no `upstream` remote or no `.starter-version`, do the one-time setup
   in `UPGRADING.md` first.
2. List the releases between the baseline and the target, and read the `CHANGELOG.md`
   entry for **each** of them. Collect every **Action required** item — they compose
   across intermediate versions, so a jump of three releases means doing all three
   sets, in order.
3. Create a branch `chore/starter-<target>` and `git merge <tag>`.
   Never rebase. Never merge `upstream/main`.
4. Resolve conflicts using the "Known conflict hotspots" table in `UPGRADING.md`.
   For files not on that list: starter's side in `packages/`, `scripts/`, `.github/`;
   this app's side in app code it wrote. If you cannot tell, keep both sides and let
   the type checker decide. Never resolve by deleting the side you did not write.
5. Perform the Action required items from step 2.
6. `bun install`, then `bun run ci:quick`. Fix what it reports. Do not claim success
   on an unverified merge.
7. Write the new version to `.starter-version`, commit, and report: versions taken,
   files that conflicted, action-required items done, and the CI result.

If an action-required item cannot be completed, stop and say which one and why —
do not land a half-applied upgrade.
