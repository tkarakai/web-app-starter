---
name: update-deps
description: Use to update dependencies, process Renovate PRs, the Dependency Dashboard, or pending majors.
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

**Announce before acting.** Your first output is text, never a tool call. Say in one or two
lines what you are about to do and whether it changes anything, e.g. "Planning a dependency
update. Read-only: I'll read the Renovate queue, the dashboard and the holds; nothing changes
until you say go." Before each later step, and before every action that writes (dispatching
Renovate, ticking a box, re-running a job, opening a PR), say in one line what it is and why.

**Plan first, then go.** Every invocation starts as a dry run: the read-only plan phase below.
Show the plan, ask the decisions, and end with one **go** question. Act only after the user says
go. If the user asked to run for real in the same message (e.g. `/update-deps go`), still show
the plan and ask the decisions, but skip the go question.

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

  Run this plan now? Reply like "go 1A 2A", "go all recommended", or "not now".
  ```

Default options per kind:

| Kind | Options |
|---|---|
| Major, plain bump | Approve · Defer · Hold |
| Major, migration | Open migration issue · Hold · Defer · Never (close with reason) |
| Lockfile maintenance PR | Merge · Leave for next run |
| Red PR that cannot work yet | Add `HOLD:` rule · Leave open |
| Hold whose REMOVE condition is met | Open lift PR · Keep |

## Plan phase (read-only, always)

Dispatch nothing and edit no PR, issue or file. Work from the last Renovate run: run
`bun run renovate:status`, say when that run finished, and require `repositoryResult: "done"`.
Go through steps 1 and 3–5 below and say what you *would* do for each item. Then present, in
this order:

1. **Report**: status tables, for information.
2. **Plan**: a numbered list of the actions the run phase will take, e.g. "rebase and merge #131
   (all non-major)", "tick the size-limit 13 approval box". Mark each action that depends on a
   decision. If there is nothing to do and nothing to decide, say so and stop. There is no go
   question.
3. **Decisions needed**, in the format above.
4. **Go**, asked last: *Run this plan now?* Options: **Go** (Recommended) · **Not now**. The go
   covers the plan as adjusted by the decision answers. In the same structured call as the
   decisions when it fits (four questions per call), otherwise its own call. In the text
   fallback, ask the user to reply `go` together with their answers, e.g. "go 1A 2B".

"Not now" ends the skill with nothing changed. The answers stay in the conversation as the plan
for a later go.

## Run phase (after go)

Refresh first (step 2). If the new snapshot differs from the plan, e.g. new PRs or new
*Pending Approval* items, show the difference and ask again before acting on anything new.
Otherwise carry out steps 3–6 with the user's decisions.

## Steps

1. **See what is in flight.** List open non-Renovate PRs (`gh pr list --search "-head:renovate/"`)
   so the report can say which feature work may land during the run. Do not ask anyone to stop.
2. **Refresh** (run phase only). `gh workflow run renovate.yml`. Wait with
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
