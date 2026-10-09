Before any task, read `platform/AGENTS.md`.

# <Product name>

<!--
This is your app's guide for coding agents. It is yours: platform upgrades never change it.
Keep it short. Platform rules live in platform/AGENTS.md, which upgrades keep current; don't
copy them here.
-->

## What this product is

<One paragraph: what the product does, who uses it, and which apps in `apps/` make it up.>

## Apps

| App | Path | Purpose |
|---|---|---|
| <app> | `apps/<app>` | <what it is for> |

## Change workflow

Before editing, inspect the current branch and GitHub default branch. Create a task branch
for adoption and app changes, then open a draft PR early. Never commit or push app work
directly to the default branch without explicit owner authorization. An empty repository
needs only a deliberate minimal base; `bun run adopt --bootstrap` creates it locally and
prints the exact separate base push and draft-PR commands.

Run `bun run platform:setup-repository --check --json` early. Resume with
`--discover-pr <number>` after the draft publishes completion checks. Read
[repository workflow](platform/docs/repository-workflow.md) for enforcement and first-PR setup.
Follow `PLATFORM_CI_PR_E2E`: full local CI with E2E before readying a private PR or
adding `run-e2e`, and before merge in every mode. Authors create/update PRs; an owner
or independent reviewer decides the merge. Per-PR owner authorization can permit an agent
to merge after all required evidence passes; it never grants standing authority.

Bootstrap and feature PRs have no automatic merge authority. Never enable blanket agent
auto-merge. Named maintenance bots may arm squash auto-merge only under an owner-approved
policy with live required checks and branch enforcement verified; private Free policy-only
repositories cannot use it. Preserve existing protection, credentials and caller settings.

## Our conventions

<Conventions your team adds on top of the platform's: domain vocabulary, where features live,
naming, review rules. Delete this section if you have none yet.>

## Upgrading the platform

Before diagnosing or changing update delivery, inspect the app-owned `.github/update-delivery.json`
and run `bun run platform:setup-updates --check --json`. Intent and live readiness are separate;
For updater job machines, preserve existing routing or explicitly choose `--workers hosted|local`;
local setup tests both Docker installations before enabling them. Read the worker section in
`platform/docs/setup-updates.md`. Never substitute ordinary CI routing or infer live readiness from a saved choice.
missing credentials do not select fallback. See `platform/docs/setup-updates.md`. Preserve
credentials, caller customisations and auto-merge intent. Obtain explicit owner consent before
switching identities or enabling repository-wide permissions. An existing update branch must
be resumed from its saved report with `--relocate`; do not merge report-only drafts.

Platform releases replace `platform/` and touch a few seams. Follow `platform/UPGRADING.md`
and read `platform/CHANGELOG.md` for the release you are taking.
