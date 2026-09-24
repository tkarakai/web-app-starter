---
name: update-deps
description: Use to update dependencies, process Renovate PRs, the Dependency Dashboard, or pending majors.
---

# Update dependencies

Bring `main` up to date with every eligible dependency update, one merge after another. Decide
what the rules let you decide, and get the user's decision on the rest.

Sources of truth:
- `docs/dependency-updates.md`: Renovate policy, holds, and the PR-state table under
  "Draining the queue".
- `docs/dependency-migrations.md`: how to migrate a major that needs code changes, and the
  runtime-baseline playbook.
- `docs/dependency-log.md`: every dependency decision, and what is *Awaiting external
  preconditions*.
- The `assess-upgrade` skill: how to decide on a major, a migration, or a security fix that needs
  a major, and who may merge it. Load it only when such an item is in the queue.

**No merge freeze.** Other agents and people keep merging while this runs; nothing is paused or
locked. A feature merge only leaves Renovate PRs `BEHIND`, which the drain loop already handles.

**Announce before acting.** Your first output is text, never a tool call. Say in one or two
lines what you are about to do and whether it changes anything, e.g. "Planning a dependency
update. Read-only: I'll read the Renovate queue, the dashboard and the holds; nothing changes
until you give the green light." Before each later step, and before every action that writes
(dispatching Renovate, ticking a box, re-running a job, opening a PR), say in one line what it is
and why.

**Plan first, then the green light.** Every invocation starts as a dry run: the read-only plan
phase below. Show the plan, ask the decisions, and end with one **green light** question. Act
only after the user gives the green light. If the user already gave it in the same message
(e.g. `/update-deps green light`), still show the plan and ask the decisions, but skip the green
light question.

**Hard rules.** Never push commits to a `renovate/*` branch. Never use GitHub's *Update branch*.
Never tick a dashboard box under *PR Edited (Blocked)* or *Pending Status Checks*. Merge a major
only as its `assess-upgrade` verdict allows; anything that verdict sends to the user needs their
explicit yes in this session. Never force-push. Never bypass the release age: ten days, or twelve
hours for a security fix.

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

- **Pending Status Checks**: the release-age wait (`renovate/stability-days`). Items leave on
  their own. The all-non-major group shows up here whenever any of its members is too young.
- **Repository Problems: "Could not re-extract the packageFile after updating it"**: a known Bun
  manager warning, documented in `dependency-updates.md` ("Diagnosing a stalled queue"). Only
  act on it if a PR's lockfile looks wrong.
- **No open PRs**: normal between releases. Continue with majors, the lockfile and holds.
- **`repositoryResult` other than `done`**: *not* normal. Stop and diagnose per
  `dependency-updates.md` before anything else.

## Asking the user for decisions

The user decides what `assess-upgrade` sends to them (tier C, security-relevant behaviour
changes, large or security-sensitive migrations), an exploited security fix before its twelve
hours, and vendor-side changes *Awaiting external preconditions*. Everything else, decide
yourself and report it. Make every request easy to see and quick to answer:

- **Separate report from requests.** Status tables are for information only. Never bury a
  question in a table cell or a prose recommendation. Put all open decisions together, after the
  report, under a **Decisions needed** heading. Ask mid-run only when the next step is blocked
  on the answer.
- **One decision per item.** Name the item (`package from → to`). Give one or two lines on what
  it changes and the evidence, then the options. Each option states its consequence in a few
  words. Put the recommended option first and mark it *(Recommended)*.
- **Only real choices.** Do not ask about things with no choice, such as a release still inside
  its release age.
- **Use the harness's structured question tool when it has one** (in Claude Code:
  `AskUserQuestion`). Ask one question per decision with 2–4 options, up to four questions per
  call, and use more calls for the rest. The header is the package name.
- **Otherwise, use a numbered list with lettered options** and say how to reply, for example:

  ```
  1. @zxcvbn-ts/core 3 → 4 (tier B, but security-relevant: new word list changes password scores)
     A. Adopt: scores get stricter, some passwords accepted today would be rejected (Recommended)
     B. Hold: keep today's scoring, re-check next run
  2. Node 24 → 26 (awaiting external precondition: Vercel project Node setting)
     A. Done: I switched the Vercel projects to Node 26, go ahead with the repo change
     B. Remind me next run (Recommended)

  Run this plan now? Reply like "green light 1A 2B", "green light, all recommended", or "not now".
  ```

Default options per kind:

| Kind | Options |
|---|---|
| Upgrade sent to the user by `assess-upgrade` | Adopt · Hold · Defer · Never (close with reason) |
| Exploited security fix inside its twelve hours | Adopt now · Wait for twelve hours |
| Awaiting external precondition | Done, continue · Remind me next run |

## Plan phase (read-only, always)

Dispatch nothing and edit no PR, issue or file. Work from the last Renovate run: run
`bun run renovate:status`, say when that run finished, and require `repositoryResult: "done"`.
Work through steps 1 and 3–6 below and say what you *would* do for each item; for majors, run
only the read-only steps of `assess-upgrade`. Then present, in this order:

1. **Report**: status tables, for information.
2. **Plan**: a numbered list of the actions the run phase will take, e.g. "rebase and merge #131
   (all non-major)", "trial size-limit 13 (tier A)". Mark each action that depends on a
   decision. If there is nothing to do and nothing to decide, say so and stop. There is no green
   light question.
3. **Decisions needed**, in the format above.
4. **Green light**, asked last: *Run this plan now?* Options: **Green light** (Recommended) ·
   **Not now**. The green light covers the plan as adjusted by the decision answers. Ask it in
   the same structured call as the decisions when it fits (four questions per call), otherwise
   in its own call. In the text fallback, ask the user to reply "green light" together with
   their answers, e.g. "green light 1A 2B".

"Not now" ends the skill with nothing changed. The answers stay in the conversation as the plan
for a later green light.

## Run phase (after the green light)

Refresh first (step 2). If the new snapshot differs from the plan, e.g. new PRs or new
*Pending Approval* items, show the difference and ask again before acting on anything new.
Otherwise carry out steps 3–7 with the user's decisions.

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
     Flaky: re-run the failed jobs once. Needs code, or cannot work yet: `assess-upgrade`.
     If one member of a group breaks, hold that member and let the rest merge.
   - `security` label: it merges after twelve hours like any other green PR. If the fix is only
     in a new major, `assess-upgrade`.
4. **Majors.** For each *Pending Approval* item, run `assess-upgrade`. To adopt, tick its box in
   the dashboard issue body, dispatch Renovate, and handle the new PR like any other; when the
   verdict needs code, the work happens on a `deps/` branch instead. Never tick "Create all
   pending approval PRs at once".
5. **Lockfile refresh.** Renovate's lockfile maintenance is off, because it ignores the release
   age for transitive dependencies. If the last `chore(deps): refresh lockfile` commit on `main`
   is more than seven days old, refresh it yourself on `deps/lockfile-<date>`: delete `bun.lock`,
   run `bun install --minimum-release-age=864000`, then `bun install --frozen-lockfile`, open the
   PR, and merge it when CI is green.
6. **Re-check holds and preconditions.** Evaluate each hold's REMOVE condition against the `holds`
   facts in the snapshot; a hold that can lift goes to `assess-upgrade`, and the lift is part of
   that upgrade's PR. Validate any `renovate.json` edit with
   `npx --yes --package renovate renovate-config-validator renovate.json`. Re-check every item
   *Awaiting external preconditions* in `docs/dependency-log.md` and ask about each one.
7. **Close out.** Record the run in `docs/dependency-log.md`: one line per merged Renovate PR,
   plus any holds added or lifted. Upgrades assessed by `assess-upgrade` carry their own entry.
   Open that as a docs-only PR and merge it when CI is green. Dispatch one last Renovate run so
   the dashboard is current. Report the merged PRs, the PRs left open and why, and the holds
   re-checked. Then list any decisions still waiting, in the format above.
