---
name: platform-deps
description: Use to update the app's dependencies - Renovate PRs, the Dependency Dashboard, pending majors, holds and the lockfile refresh - or to work one major-upgrade ticket. Never edits platform/.
---

# Update dependencies

Bring `main` up to date with every eligible dependency update. Decide what the rules let you
decide, and get the user's decision on the rest.

**Stay out of the platform zone.** Never edit a file under `platform/`. A dependency declared
there arrives with a platform upgrade, not with this skill. If an update can only land by
changing a platform file, it is a **hold**: record the reason and the REMOVE condition ("the
platform release that moves it") on its ticket.

**Decisions are recorded in the repository you work in**: on the `deps:*` ticket and in the PR
description that lands, holds or rejects the change. Nowhere else.

Read first:
- `platform/docs/dependency-updates.md`: Renovate policy, holds, and the PR-state table under
  "Draining the queue".
- `platform/docs/dependency-migrations.md`: migrations and the runtime-baseline playbook.
- Closed and `deps:held` tickets (`gh issue list --label dependencies --state all`): past
  decisions, and what is *Awaiting external preconditions*.

Majors are worked one ticket at a time with [references/major-ticket.md](references/major-ticket.md).
Read it only to work a ticket. If the user names a ticket or a package to upgrade (e.g.
`/platform-deps ticket #136`), skip the queue and go straight to that procedure.

**No merge freeze.** Other agents and people keep merging while this runs; nothing is paused or
locked. A feature merge only leaves PRs `BEHIND`, which the steps below handle.

**Announce before acting.** Your first output is text, never a tool call: one or two lines on
what you are about to do and whether it changes anything, e.g. "Planning a dependency update.
Read-only: I'll read the Renovate queue, the tickets and the holds; nothing changes until you
give the green light." Before every later action that writes (dispatching Renovate, editing a PR
or issue, opening or merging a PR), say in one line what it is and why.

**Plan first, then the green light.** Every run starts with the read-only plan phase. Show the
plan, ask the decisions, and end with one **green light** question. Act only after the green
light. If the user gave it up front (e.g. `/platform-deps green light`), still show the plan and
ask the decisions, but skip that question.

**If unsure.** Interactive: when the rules and the repo do not settle something, ask, in the
decision format below; never ask what they already answer. Non-interactive (nobody can answer):
do the plan phase, print the plan and the open decisions, and stop without changing anything.

**Hard rules.** Never push commits to a `renovate/*` branch. Never use GitHub's *Update branch*.
Never tick a dashboard box under *PR Edited (Blocked)* or *Pending Status Checks*. Merge a major
only as its major-ticket verdict allows; anything sent to the user needs their explicit yes in
this session. Never force-push. Never bypass the release age: ten days, or twelve hours for a
security fix.

## Gather state with one command

`bun run renovate:status` prints one JSON snapshot:
- `renovateRun`: the last run, including `repositoryResult`, parsed from the log.
- `openPullRequests`: each with its merge state, automerge flag and failed checks.
- `dashboard.sections`: the Dependency Dashboard, by section.
- `holds`: every `HOLD:` rule, with the registry's latest version and peer ranges for the held
  packages and for each package named in its REMOVE condition.

Use it instead of hand-written `gh`, `bun info` or `npm view` queries, and re-run it after each
action. Write any extra shell as single commands, not loops: the user's shell may be zsh, which
does not word-split unquoted variables.

## Known normal states (do not investigate)

- **Pending Status Checks**: the release-age wait (`renovate/stability-days`). Items leave on
  their own. The all-non-major group shows up here whenever any of its members is too young.
- **Repository Problems: "Could not re-extract the packageFile after updating it"**: a known Bun
  manager warning (`dependency-updates.md`, "Diagnosing a stalled queue"). Only act on it if a
  PR's lockfile looks wrong.
- **No open PRs**: normal between releases. Continue with holds, tickets and the lockfile.
- **`repositoryResult` other than `done`**: *not* normal. Stop and diagnose per
  `dependency-updates.md` before anything else.

## Asking the user for decisions

The user decides: tickets labelled `deps:awaiting-user`, auth-stack PRs (never automerged), an
exploited security fix before its twelve hours, and vendor-side preconditions once their
upstream part is met. Decide everything else yourself and report it.

- **Separate report from requests.** Status tables are for information only. Never bury a
  question in a table cell or a prose recommendation. Put all open decisions together under a
  **Decisions needed** heading, after the report. Ask mid-run only when the next step is
  blocked on the answer.
- **One decision per item.** Name the item (`package from → to`, with its ticket). Give one or
  two lines on what it changes and the evidence, then the options, each with its consequence
  in a few words. Put the recommended option first and mark it *(Recommended)*.
- **Only real choices.** Never ask about something the user cannot act on yet, such as a
  release inside its release age or a precondition whose upstream part is not met.
- **Use the harness's structured question tool when it has one** (in Claude Code:
  `AskUserQuestion`): one question per decision, 2–4 options, up to four questions per call.
  The header is the package name.
- **Otherwise, a numbered list with lettered options**, and say how to reply:

  ```
  1. @zxcvbn-ts/core 3 → 4, #137 (security-relevant: the new word list changes password scores)
     A. Adopt: merge #140; some passwords accepted today will be rejected (Recommended)
     B. Hold: keep today's scoring, re-check next run
     C. Reject: record why, revisit on the next major
  2. Node 24 → 26 (Node 26 is Active LTS and Vercel supports it; your Vercel projects run 24)
     A. Done: I switched the Vercel projects, start the baseline ticket
     B. Remind me next run (Recommended)

  Run this plan now? Reply like "green light 1A 2B", "green light, all recommended", or "not now".
  ```

| Decision | Options, and what you then do |
|---|---|
| Ticket `deps:awaiting-user` | **Adopt**: merge its PR. **Hold** or **Reject**: rework its PR as step 7 of the major-ticket procedure describes (revert the bump, keep the tests, add the `HOLD:` rule and decision record), label the ticket `deps:held` or `deps:rejected`, merge. **Ask me next run**: leave it. |
| Auth-stack PR | **Merge**: bring it up to date, merge it. **Leave open**. |
| Exploited security fix inside twelve hours | **Adopt now** · **Wait** for twelve hours |
| Precondition met upstream | **Done**: remove `deps:held` from its ticket (open one if missing) and work it. **Remind me next run**. |

## Plan phase (read-only, always)

Dispatch nothing and edit no PR, issue or file. Run `bun run renovate:status`, say when that run
finished, and require `repositoryResult: "done"`. Work through steps 1 and 3–6 below and say
what you *would* do. Classify each ticket from the ticket and the snapshot only: package,
expected tier, codebase-wide or not, and order. The research happens when the ticket is worked.
Then present, in this order:

1. **Report**: status tables, for information.
2. **Plan**: a numbered list of the actions the run phase will take, e.g. "rebase and merge #131
   (all non-major)", "work #135 typescript 6 (codebase-wide, alone)". Mark each action that
   depends on a decision. If there is nothing to do and nothing to decide, say so and stop.
3. **Decisions needed**, including tickets already labelled `deps:awaiting-user`.
4. **Green light**, asked last: *Run this plan now?* Options: **Green light** (Recommended) ·
   **Not now**. It covers the plan as adjusted by the answers. Ask it in the same structured
   call as the decisions when it fits, otherwise in its own call. In the text fallback, the user
   replies "green light" with their answers, e.g. "green light 1A 2B".

"Not now" ends the skill with nothing changed.

## Run phase (after the green light)

Refresh first (step 2). If the new snapshot differs from the plan, e.g. new PRs or new
*Pending Approval* items, show the difference and ask again before acting on anything new.
Otherwise carry out the answers and steps 3–7.

**Merging** anything here means: wait for green checks, make sure the branch is up to date with
`main`, then `gh pr merge <n> --squash`. A Renovate PR is brought up to date with its rebase box
(step 3); a `deps/` branch by merging `main` into it (a new commit; on a `bun.lock` conflict take
`main`'s copy, then `bun install --minimum-release-age=864000`) and pushing.

## Steps

1. **See what is in flight.** Open non-Renovate PRs (`gh pr list --search "-head:renovate/"`), so
   the report can say which feature work may land during the run; do not ask anyone to stop.
   Open tickets (`gh issue list --label dependencies --state open`) with their status labels.
2. **Refresh** (run phase only). `gh workflow run renovate.yml`. Wait with
   `gh run watch $(gh run list --workflow=renovate.yml --limit 1 --json databaseId --jq '.[0].databaseId')`,
   then run `bun run renovate:status` and require `repositoryResult: "done"`.
3. **Drain loop.** Repeat until no Renovate PR can move further. One PR at a time, following the
   state table in the doc:
   - Green and `BEHIND`: tick its rebase box by editing the PR body
     (`- [ ] <!-- rebase-check -->` → `- [x] <!-- rebase-check -->`), dispatch Renovate, then
     `gh pr checks <n> --watch` and wait for the automerge. A feature merge can push it `BEHIND`
     again; repeat.
   - Red: read the failed logs (`gh run view <id> --log-failed`). Flaky: re-run the failed jobs
     once. One member of a group breaks it: add a temporary `HOLD:` rule for that member (a PR
     you merge yourself; holding is always safe), open a ticket for it, and let the rest merge
     on the next Renovate run. Otherwise it needs code: open a ticket for it.
   - `security` label: merges after twelve hours like any other green PR. If the fix is only in a
     new major, open a ticket.
   - Auth stack (never automerged): a decision for the user.
4. **Holds and preconditions.**
   - Every `HOLD:` rule has a ticket; open any that is missing. If its REMOVE condition depends
     on upstream, label it `deps:held`. If it depends on our own work (e.g. a Vite 8 migration),
     leave it without a status label so it gets worked.
   - Evaluate each upstream REMOVE condition against the `holds` facts. When one is met, remove
     `deps:held`; the ticket's PR lifts the hold.
   - Validate any `renovate.json` edit with
     `npx --yes --package renovate renovate-config-validator renovate.json`.
   - For each `deps:held` ticket *Awaiting external preconditions*: when its
     upstream part is met, it is a decision; otherwise only list it in the report.
5. **Tickets, one major-ticket run each.** Every *Pending Approval* major gets a ticket; open the
   missing ones. Never tick dashboard boxes: the major-ticket procedure bumps on a `deps/` branch. Work every
   open ticket without a `deps:held`, `deps:rejected` or `deps:awaiting-user` label:
   - **Codebase-wide first, alone**: `typescript`, the runtime baseline (Node, Bun,
     `@types/node`), `react`/`react-dom`/`next`, and lint tooling (`eslint` and its plugins).
     One at a time, each merged before the next starts.
   - **Then the rest in parallel** if the harness has subagents (in Claude Code: the Agent tool,
     each in its own worktree), at most three at once. Tell each: "Follow `platform/agent-skills/platform-deps/references/major-ticket.md` on
     ticket #N as a subagent: push your `deps/` branch, open the PR, do not merge, and report
     the verdict." Without subagents, work them one after another yourself.
   - **Merge one at a time yourself**, then bring the next `deps/` branch up to date.
   - A ticket that ends `deps:awaiting-user` becomes a decision in the close-out. One too large
     for this run stays open with its progress; say it can be worked later or in parallel with
     `/platform-deps ticket #<ticket>`.
6. **Lockfile refresh.** Renovate's lockfile maintenance is off because it ignores the release
   age for transitive dependencies. If no `chore(deps): refresh lockfile` commit on `main` is
   newer than seven days, refresh on `deps/lockfile-<date>`: delete `bun.lock`, run
   `bun install --minimum-release-age=864000`, then `bun install --frozen-lockfile`. Open the PR
   titled `chore(deps): refresh lockfile` and merge it.
7. **Close out.**
   - Ask the decisions still open (interactive only), and carry out the answers.
   - Record the run in the report: one line per merged Renovate PR, the lockfile refresh, and any
     holds added or lifted (tickets and their PRs carry their own records).
   - Dispatch one last Renovate run so the dashboard is current.
   - Report the merged PRs, the PRs and tickets left open and why, and the holds re-checked.
