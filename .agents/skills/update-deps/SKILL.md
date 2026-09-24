---
name: update-deps
description: Bring main up to date with dependency updates. Drains the Renovate queue, triages failing Renovate PRs, and asks the user to decide on majors, lockfile maintenance and holds. Use when the user asks to update dependencies, process Renovate PRs, the Dependency Dashboard, or pending majors. Supports a dry run.
---

# Update dependencies

Bring `main` up to date with every eligible dependency update, one merge after another. Get the
user's decision wherever one is needed.

Sources of truth:
- `docs/dependency-updates.md`: Renovate policy, holds, and the PR-state table under
  "Draining the queue".
- `docs/dependency-migrations.md`: how to migrate a major that needs code changes, and the
  runtime-baseline playbook.

**No merge freeze.** Other agents and people keep merging while this runs; nothing is paused or
locked. A feature merge only leaves Renovate PRs `BEHIND`, which the drain loop already handles.

**Dry run.** If the user asks for a dry run, do steps 2–5 read-only. Dispatch nothing, edit no PR
or issue, and report what you would do for each item. Still present the decisions (see below);
the answers become the plan for the real run and are not acted on.

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

## Asking the user for decisions

The user has a say on majors, lockfile maintenance, migrations, new holds and hold lifts. Make
every such request easy to see and quick to answer:

- **Separate report from requests.** Status tables are for information only. Never bury a
  question in a table cell or a prose recommendation. Put all open decisions together, after the
  report, under a **Decisions needed** heading. Ask mid-run only when the next step is blocked
  on the answer.
- **One decision per item.** Name the item (`package from → to`). Give one or two lines on what
  it changes and the evidence, then the options. Each option states its consequence in a few
  words. Put the recommended option first and mark it *(Recommended)*.
- **Only real choices.** Do not ask about things with no choice, such as a release still inside
  the ten-day age.
- **Use the harness's structured question tool when it has one** (in Claude Code:
  `AskUserQuestion`). Ask one question per decision with 2–4 options, up to four questions per
  call, and use more calls for the rest. The header is the package name.
- **Otherwise, use a numbered list with lettered options** and say how to reply, for example:

  ```
  1. @tanstack/react-table 8 → 9 (migration: API rewrite, 9 admin table files)
     A. Open a migration issue now (Recommended)
     B. Hold: add a HOLD: rule, re-check next run
     C. Defer: leave it on the dashboard
  2. size-limit 11 → 13 (plain bump: drops Node 20; we run 24)
     A. Approve: tick the dashboard box, PR opens next run (Recommended)
     B. Defer

  Reply like "1A 2A", or "all recommended".
  ```

Default options per kind:

| Kind | Options |
|---|---|
| Major, plain bump | Approve · Defer · Hold |
| Major, migration | Open migration issue · Hold · Defer · Never (close with reason) |
| Lockfile maintenance PR | Merge · Leave for next run |
| Red PR that cannot work yet | Add `HOLD:` rule · Leave open |
| Hold whose REMOVE condition is met | Open lift PR · Keep |

## Steps

1. **See what is in flight.** List open non-Renovate PRs (`gh pr list --search "-head:renovate/"`)
   so the report can say which feature work may land during the run. Do not ask anyone to stop.
2. **Refresh.** `gh workflow run renovate.yml`. Wait with
   `gh run watch $(gh run list --workflow=renovate.yml --limit 1 --json databaseId --jq '.[0].databaseId')`,
   then run `bun run renovate:status` and require `repositoryResult: "done"`.
3. **Drain loop.** Repeat until no automerge-eligible Renovate PR is open. Handle one PR at a time,
   following the state table in the doc:
   - Green and `BEHIND`: tick its rebase box by editing the PR body
     (`- [ ] <!-- rebase-check -->` → `- [x] <!-- rebase-check -->`). Dispatch Renovate, run
     `gh pr checks <n> --watch`, and wait for the merge. A feature merge can push it `BEHIND`
     again; repeat.
   - Red: read the failed logs (`gh run view <id> --log-failed`) and classify the failure.
     Flaky: re-run the failed jobs once. Needs code: a migration per `dependency-migrations.md`.
     Cannot work yet: a `HOLD:` rule with the evidence. Both of the last two are decisions for
     the user.
4. **Majors and lockfile maintenance.** For each *Pending Approval* item and any lockfile-maintenance
   PR, say whether it is a plain bump, a migration, or a runtime-baseline change. Summarize the
   breaking changes from the package's GitHub releases (`gh release list -R <owner/repo>`, then
   `gh release view <tag> -R <owner/repo>`) or its CHANGELOG. Each item becomes a decision. To
   approve a major, tick its box in the dashboard issue body, dispatch Renovate, and treat the new
   PR like any other. Never tick "Create all pending approval PRs at once".
5. **Re-check holds.** Evaluate each hold's REMOVE condition against the `holds` facts in the
   snapshot. Each hold that can lift becomes a decision. Propose each lift as its own PR,
   validated with `npx --yes --package renovate renovate-config-validator renovate.json`.
6. **Close out.** Dispatch one last Renovate run so the dashboard is current. Report the merged
   PRs, the PRs left open and why, and the holds re-checked. Then list any decisions still
   waiting, in the format above.
