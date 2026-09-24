---
name: renovate-window
description: Drain the Renovate dependency queue in one supervised window while feature merges to main are paused. Use when the user asks for a Renovate window, a dependency break, or to process Renovate PRs, the Dependency Dashboard, or pending majors. Supports a dry run.
---

# Renovate window

Bring `main` up to date with every eligible dependency update, one merge after another, then hand
the repo back to feature work.

Sources of truth — read them first:
- `docs/dependency-updates.md` — Renovate policy, holds, and the PR-state table under
  "Renovate windows".
- `docs/dependency-migrations.md` — how a major that needs code changes is migrated, and the
  runtime-baseline playbook.

**Dry run.** If the user asks for a dry run, do steps 2–5 read-only: dispatch nothing, edit no PR or
issue, and report what you would do for each item.

**Hard rules.** Never push commits to a `renovate/*` branch, never use GitHub's *Update branch*,
never tick a dashboard box under *PR Edited (Blocked)* or *Pending Status Checks*, never merge a
major or lockfile maintenance without the user's explicit yes in this session, never force-push,
never bypass the ten-day release age.

1. **Confirm the pause.** Ask the user to confirm feature merges to `main` are paused. List open
   non-Renovate PRs (`gh pr list`) so they can see what is in flight.
2. **Refresh.** `gh workflow run renovate.yml`, wait for the run, and confirm from its log that the
   repository result is `done` (a green job alone is not proof, see "Diagnosing a stalled queue").
3. **Drain loop.** Repeat until no automerge-eligible Renovate PR is open:
   - `gh pr list --search "head:renovate/" --json number,title,headRefName,mergeStateStatus,autoMergeRequest,statusCheckRollup`
     (Renovate authenticates with the owner's PAT, so PRs are authored by the owner, not a bot).
   - Handle one PR at a time per the state table in the doc. For a green PR that is `BEHIND`,
     tick its rebase box by editing the PR body (`- [ ] <!-- rebase-check -->` → `- [x] <!-- rebase-check -->`),
     dispatch Renovate, then `gh pr checks <n> --watch` and wait for the merge.
   - For a red PR, read the failed logs (`gh run view <id> --log-failed`) and classify:
     flaky → re-run failed jobs once; needs code → a migration per `docs/dependency-migrations.md`,
     proposed to the user first; cannot work yet → propose a `HOLD:` rule with the evidence.
4. **Majors and lockfile maintenance.** Find the open "Dependency Dashboard" issue
   (`gh issue list --search "Dependency Dashboard in:title"`). Read its *Pending Approval* section
   and any lockfile-maintenance PR. For each, summarize the changelog and breaking changes, say
   whether it is a plain bump, a migration, or a runtime-baseline change, and ask the user.
   Approve a major by ticking its box in the dashboard issue body, then dispatch Renovate and treat
   the new PR like any other.
5. **Re-check holds.** For every `HOLD:` rule in `renovate.json`, evaluate its REMOVE condition
   (e.g. `bun info <pkg>@latest peerDependencies`). Report which holds can lift; propose the edit
   as its own PR, validated with `npx --yes --package renovate renovate-config-validator renovate.json`.
6. **Close out.** Dispatch one last Renovate run so the dashboard is current. Report: merged PRs,
   PRs left open and why, holds re-checked, proposals awaiting the user. Then tell the user
   feature merges can resume; open feature PRs will need a rebase onto the new `main`.
