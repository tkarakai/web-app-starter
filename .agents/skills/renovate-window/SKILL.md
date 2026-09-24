---
name: renovate-window
description: Drain the Renovate dependency queue in one supervised window while feature merges to main are paused. Use when the user asks for a Renovate window, a dependency break, or to process Renovate PRs, the Dependency Dashboard, or pending majors. Supports a dry run.
---

# Renovate window

Bring `main` up to date with every eligible dependency update, one merge after another, then hand
the repo back to feature work.

Sources of truth:
- `docs/dependency-updates.md`: Renovate policy, holds, and the PR-state table under
  "Renovate windows".
- `docs/dependency-migrations.md`: how to migrate a major that needs code changes, and the
  runtime-baseline playbook.

**Dry run.** If the user asks for a dry run, do steps 2–5 read-only. Dispatch nothing, edit no PR
or issue, and report what you would do for each item.

**Hard rules.** Never push commits to a `renovate/*` branch. Never use GitHub's *Update branch*.
Never tick a dashboard box under *PR Edited (Blocked)* or *Pending Status Checks*. Never merge a
major or lockfile maintenance without the user's explicit yes in this session. Never force-push.
Never bypass the ten-day release age.

## Gather state with one command

`bun run renovate:status` prints one JSON snapshot:
- `renovateRun`: the last run, including `repositoryResult`, parsed from the log.
- `openPullRequests`: each with its merge state, automerge flag and failed checks.
- `dashboard.sections`: the Dependency Dashboard, by section.
- `holds`: every `HOLD:` rule, with the registry's latest version and peer ranges for the held
  packages and for each package named in its REMOVE condition.

Use it at every step instead of hand-written `gh`, `bun info` or `npm view` queries. Re-run it
after each action. Write any extra shell as single commands, not loops. The user's shell may be
zsh, which does not word-split unquoted variables.

## Known normal states (do not investigate)

- **Pending Status Checks**: the ten-day release-age wait (`renovate/stability-days`). Items leave
  on their own. The all-non-major group shows up here whenever any of its members is younger
  than ten days.
- **Awaiting Schedule**: lockfile maintenance only runs on Mondays.
- **Repository Problems: "Could not re-extract the packageFile after updating it"**: a known Bun
  manager warning, documented in `dependency-updates.md` ("Diagnosing a stalled queue"). Only
  act on it if a PR's lockfile looks wrong.
- **No open PRs**: normal between releases. Continue with majors and holds.
- **`repositoryResult` other than `done`**: *not* normal. Stop and diagnose per
  `dependency-updates.md` before anything else.

## Steps

1. **Confirm the pause.** Ask the user to confirm feature merges to `main` are paused. List open
   non-Renovate PRs (`gh pr list --search "-head:renovate/"`) so they can see what is in flight.
2. **Refresh.** `gh workflow run renovate.yml`. Wait with
   `gh run watch $(gh run list --workflow=renovate.yml --limit 1 --json databaseId --jq '.[0].databaseId')`,
   then run `bun run renovate:status` and require `repositoryResult: "done"`.
3. **Drain loop.** Repeat until no automerge-eligible Renovate PR is open. Handle one PR at a time,
   following the state table in the doc:
   - Green and `BEHIND`: tick its rebase box by editing the PR body
     (`- [ ] <!-- rebase-check -->` → `- [x] <!-- rebase-check -->`). Dispatch Renovate, run
     `gh pr checks <n> --watch`, and wait for the merge.
   - Red: read the failed logs (`gh run view <id> --log-failed`) and classify the failure.
     Flaky: re-run the failed jobs once. Needs code: a migration per `dependency-migrations.md`,
     proposed to the user first. Cannot work yet: propose a `HOLD:` rule with the evidence.
4. **Majors and lockfile maintenance.** For each *Pending Approval* item and any lockfile-maintenance
   PR, say whether it is a plain bump, a migration, or a runtime-baseline change. Summarize the
   breaking changes from the package's GitHub releases (`gh release list -R <owner/repo>`, then
   `gh release view <tag> -R <owner/repo>`) or its CHANGELOG. Then ask the user. To approve a
   major, tick its box in the dashboard issue body, dispatch Renovate, and treat the new PR like
   any other.
5. **Re-check holds.** Evaluate each hold's REMOVE condition against the `holds` facts in the
   snapshot. Report which holds can lift. Propose each lift as its own PR, validated with
   `npx --yes --package renovate renovate-config-validator renovate.json`.
6. **Close out.** Dispatch one last Renovate run so the dashboard is current. Report the merged
   PRs, the PRs left open and why, the holds re-checked, and the proposals awaiting the user.
   Then tell the user feature merges can resume; open feature PRs will need a rebase onto the
   new `main`.
