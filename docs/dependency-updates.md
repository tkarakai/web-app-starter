# Dependency Updates (Renovate)

Dependency bumps in this monorepo are automated with [Renovate](https://docs.renovatebot.com/).
Renovate proposes updates, regenerates `bun.lock`, lets the existing CI pipeline run, and opens
PRs — but **only for releases that are at least 10 days old**, so we adopt versions that the wider
ecosystem has already vetted (not yanked, not a fresh supply-chain surprise).

- Config: [`renovate.json`](../renovate.json)
- Workflow: [`.github/workflows/renovate.yml`](../.github/workflows/renovate.yml)
- Current catch-up and compatibility holds: [`dependency-catchup.md`](dependency-catchup.md)

## "Self-hosted" — what that means (and doesn't)

Renovate can run two ways: via Mend's cloud-hosted GitHub App, or **"self-hosted"**, which in
Renovate jargon just means *we run the bot ourselves*. Here, "ourselves" is a plain GitHub Actions
workflow on **GitHub-hosted runners**. **Nothing runs outside GitHub**, and this has nothing to do
with "self-hosted runners." We chose this over the Mend app so no third party gets write access to
the repo and we control exactly when it runs; the price is owning the `RENOVATE_TOKEN` secret
(below).

## How it runs

| | |
|---|---|
| **Schedule** | GitHub Actions cron in `renovate.yml` — Monday & Thursday at 06:00 UTC, as a safety net; dependency work is drained in [Renovate windows](#renovate-windows). Runs on GitHub's scheduler, which can delay runs 15–60 min under load. |
| **Manual run** | GitHub → **Actions → Renovate → Run workflow** (`workflow_dispatch`). Pick `debug` log level to troubleshoot. |
| **Cooldown** | `minimumReleaseAge: "10 days"` + `internalChecksFilter: "strict"` — a new release is held until it has been public for 10 days. Younger releases show as *pending* on the dashboard rather than as open PRs. |
| **Security fixes** | The cooldown is **bypassed for known-vulnerable dependencies**: `vulnerabilityAlerts` (GitHub security alerts) and `osvVulnerabilityAlerts` (OSV database) open fix PRs immediately, labeled `security`. |
| **Progress** | Renovate maintains a **"Dependency Dashboard"** issue listing pending, open, and held updates. Start there. |
| **Lockfile** | Renovate updates `bun.lock` itself (the image bundles Bun and reads `packageManager: bun@…` from the root `package.json`). It also updates the root `overrides` pins. |

> **GitHub quirk:** on public repos, GitHub **disables scheduled workflows after 60 days without
> repo activity**. You get an email first; re-enabling is one click under Actions → Renovate. If
> bump PRs stop appearing on a dormant repo, check this before suspecting the token.

## Update & merge policy

Defined in `renovate.json` → `packageRules`:

- **Patch / minor / pin / digest** → **auto-merged** (squash, matching the linear-history rule on
  `main`) once all required CI checks pass (`platformAutomerge`).
- **All non-major updates** → grouped into a single "all non-major dependencies" PR per cycle, so
  automerge PRs do not compete for the "branch must be up to date" requirement on `main` (each merge
  would otherwise leave every other open PR behind until the next run). The auth stack is the one
  exception: it keeps its own never-automerged group.
- **Major versions** → **never auto-merged**, and **no PR opens until approved** on the dashboard
  (`dependencyDashboardApproval`; they wait under *Pending Approval*). Approve them during a
  [Renovate window](#renovate-windows), after reading the changelog / migration guide. Treat majors
  of the sensitive frameworks (`next`, `react`/`react-dom`, `convex`, `better-auth` +
  `@convex-dev/better-auth` + `@better-auth/passkey`, `tailwindcss` + `@tailwindcss/postcss`)
  with extra care. `convex` and `convex-test` majors travel together in the "convex monorepo" group.
- **Holds** → a major that cannot work yet (an upstream peer range, our runtime floor) is capped
  with `allowedVersions` in a rule whose `description` starts with `HOLD:` and states the
  evidence and the **REMOVE when** condition. Holds are decisions: add or remove them in a
  reviewed PR, never by closing a bot PR silently. Held versions do not appear on the dashboard,
  so each Renovate window re-checks the REMOVE conditions.
- **Lockfile maintenance** (weekly transitive-dependency refresh, Mondays) → deliberately **not**
  auto-merged: it pulls transitive deps to their latest versions, which **sidesteps the 10-day
  cooldown**, so a human approves it.
- **GitHub Actions** → Renovate pins all `uses:` references to **commit SHAs**
  (`helpers:pinGitHubActionDigests`) and keeps the pins updated. Tags like `@v4` are mutable and a
  compromised action repo could repoint them; digests can't be swapped.

> The first run is intentionally noisy — it clears an accumulated drift backlog (several apps trail
> on next/react/convex/tailwind), and one PR will digest-pin every workflow. Expect a wave of PRs,
> after which it stays quiet.

## Renovate windows

Renovate and coding agents both merge to `main`, and `main` requires PRs to be up to date, so
every merge from one side leaves the other side's PRs behind. Instead of running Renovate
constantly, pause feature merges and drain the dependency queue in one supervised window with the `renovate-window` skill
(`.agents/skills/renovate-window/SKILL.md`, usable by any agent; `/renovate-window` in Claude Code). It dispatches Renovate, gets each
automerge PR rebased and merged in sequence, triages red PRs, re-checks holds, and stops for a
human on majors and lockfile maintenance. The Monday/Thursday cron stays as a safety net that keeps
the dashboard current. Security PRs (`security` label) are not deferred to a window.

### Handling each PR state

| State | Action |
|---|---|
| Green, automerge armed, **behind** `main` | Tick the PR's *rebase/retry* checkbox, then dispatch Renovate. **Never** use GitHub's *Update branch*: its merge commit counts as a human edit and Renovate stops managing the branch. |
| Green, armed, up to date | GitHub merges it; nothing to do. |
| Conflicting (`DIRTY`) | Renovate rebases its own branches on the next run. |
| Red, flaky | Re-run the failed jobs. |
| Red, needs code changes | Migrate per [`dependency-migrations.md`](dependency-migrations.md) on a `deps/<name>` branch, then close the bot PR with a link. Do not push to `renovate/*`. |
| Red, cannot work yet | Add a `HOLD:` rule with the evidence; Renovate autocloses the PR on its next run. |
| *PR Edited (Blocked)* on the dashboard | Human commits exist; do not tick its checkbox (it discards them). Close or finish the PR by hand. |

## Security model

What automating bumps actually risks, and what defends against it:

- **Malicious release of a legit package** (compromised maintainer): the **10-day cooldown** is the
  main defense — nearly all npm supply-chain attacks are detected and yanked within days, so the
  ecosystem is our canary. Majors additionally always get human review.
- **Install scripts**: this repo has **no `trustedDependencies`** in any `package.json`, so Bun runs
  **no dependency lifecycle scripts** (beyond Bun's small built-in allowlist) — in CI *or* inside
  the Renovate container. Preserve this: adding a package to `trustedDependencies` is a
  security-relevant change and deserves review.
- **Blast radius**: an auto-merged bump lands on `main`, which triggers `cd-staging.yml` → an
  **unattended staging deploy**. This is a deliberate trade — staging exists to absorb exactly this,
  and production deploys stay manual.
- **The token is the crown jewel**: the only actor that can arm auto-merge programmatically is
  whoever holds `RENOVATE_TOKEN`. Keep it a fine-grained PAT scoped to this single repo.

### About "Allow auto-merge"

The repo setting is **repo-wide and cannot be scoped** to Renovate — but it is inert on its own.
It only *permits* arming auto-merge on a PR; a human (or Renovate via its token) must explicitly
enable it **per PR**, and GitHub still merges only after every required check passes and the branch
is up to date. Feature PRs are unaffected unless someone deliberately clicks "Enable auto-merge" on
them.

## The `RENOVATE_TOKEN` secret

**This is the one piece of manual setup, and the system does not work without it.**

### Why it's needed

Renovate authenticates to GitHub with this token. It **must not** be the default `GITHUB_TOKEN`,
because PRs opened by `GITHUB_TOKEN` **do not trigger other workflows** (a GitHub anti-recursion
rule). If Renovate used the default token, our `ci-*.yml` `pull_request` workflows would never run on
bump PRs — so "the tests run" would silently be false, and auto-merge (which waits on those checks)
could never complete.

### Creating it (fine-grained PAT)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** the org/user that owns this repo. **Repository access:** *Only select repositories* → this repo.
3. **Repository permissions:**
   - Contents: **Read and write**
   - Pull requests: **Read and write**
   - Workflows: **Read and write**
   - Issues: **Read and write** (for the Dependency Dashboard)
   - Commit statuses: **Read and write** (for the `renovate/stability-days` hold)
   - Dependabot alerts: **Read-only** (for the security-fix fast path / `vulnerabilityAlerts`)

   > **Commit statuses is not optional, and omitting it fails quietly.** Renovate publishes
   > the `minimumReleaseAge` hold as a commit status. Without the permission,
   > `POST /repos/:owner/:repo/statuses/:sha` returns `403 Resource not accessible by
   > personal access token`; Renovate turns that into a `repository-changed` result and
   > **aborts the repository run while the workflow step still exits 0**. The 2026-09-16
   > verification dispatch got through 4 of 34 branches before stopping, never pushed
   > `renovate/auth-stack`, and never created the Dependency Dashboard — on a green run.
   > The only expected 403 is `GET /user/emails`, which fine-grained PATs cannot read.
4. **Expiration:** set a finite expiry (e.g. 90 days) and note the date — see *Rotation* below.
5. Generate and copy the token.

> **Team alternative:** for shared ownership, create a dedicated **GitHub App** instead of a PAT
> (no personal account tied to it, finer control, longer-lived) and pass its installation token to
> the action. A PAT is fine to start.

### Storing it

GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:

- **Name:** `RENOVATE_TOKEN`
- **Value:** the token from above

`renovate.yml` reads it via `token: ${{ secrets.RENOVATE_TOKEN }}`.

> Note: any repo Actions secret is readable by anyone who can push workflow changes to the repo.
> On a single-owner repo that collapses to the owner; on a team repo, prefer the GitHub App route
> and environment-scoped secrets.

### Managing & rotating it

- **Owner:** record who owns the token (a person, or the GitHub App).
- **Expiry:** fine-grained PATs expire. Put the renewal date somewhere visible.
- **Rotate:** regenerate the token (or extend its expiry) → update the `RENOVATE_TOKEN` secret with
  the new value. No code change needed.
- **Symptoms of an expired/invalid token:** the **Renovate** Actions run fails at authentication, or
  more subtly, Renovate stops opening PRs and the Dependency Dashboard goes stale. If bump PRs stop
  appearing, check the token first (then the 60-day schedule pause, above).

## Repo settings required for auto-merge

Auto-merge only works when GitHub permits it **and** CI checks are *required* — otherwise Renovate's
`platformAutomerge` merges as soon as GitHub allows, **before** CI finishes.

The following are already configured on this repo (via `gh api` / Settings):

1. **Settings → General → Pull Requests → "Allow auto-merge"** — enabled.
2. **Merge-commit method disabled** — the `main` ruleset requires linear history, so merge commits
   could never merge anyway; squash/rebase only. `renovate.json` sets
   `automergeStrategy: "squash"` to match.
3. **Required status checks on `main`** — the `*-complete` summary jobs from `ci-shared`, `ci-web`,
   `ci-admin`, `ci-landing`, `ci-landing-static` and `ci-storybook`, with "require branches to be
   up to date" (enforced by both the legacy branch protection and the `rule01` ruleset — the two
   are independent copies, so a change to one is not a change to the other).

   `CI Landing Static Complete` and `CI Storybook Complete` were **added on 2026-09-16**, so all
   six `*-complete` jobs are now required and a regression in any of the five apps can block an
   automerge. The list lives in **two** places — classic branch protection *and* ruleset `rule01`
   (id `12113493`) — and both must be updated; see step 9 item 1 in
   `docs/claude/auth-e2e-and-upgrade-plan.md` for the commands and the `PUT`-replaces-everything
   caveat on the ruleset.
4. The **`RENOVATE_TOKEN`** secret exists (above).

## Diagnosing a stalled queue

The dashboard is persistent: retain it after catch-up. Its **Open** section is a snapshot of
Renovate's last run, not a live PR query. Check current PR heads, checks, merge conflicts and
`auto_merge` state on GitHub; an eligible non-major PR can still have automerge manually disabled.
Strict branch protection also requires current-base validation, not just an older green head.
The five-PR concurrent limit holds further updates until slots open; **Pending Status Checks**
usually includes the release-age hold. Do not bypass both controls by selecting every checkbox.
**PR Edited (Blocked)** means Renovate detected human commits and stopped updating the branch.
Do not select its restart checkbox: it discards those commits. Repair additively on an isolated
branch (or use a replacement with explicit provenance), preserving the original history.

A successful workflow alone is not proof Renovate completed: inspect the repository result in
its logs. In particular, the Bun-manager warning **"Could not re-extract the packageFile after
updating it"** can occur *after* successful lockfile generation. It means the post-artifact
release-age check could not re-extract the resolved dependency, not that `package.json` is
necessarily malformed. The upstream investigation is
[renovatebot/renovate](https://github.com/renovatebot/renovate/pull/45278) (closed without merging).
Do not silence this warning by disabling the cooldown or assume a frozen install proves release
age: inspect the generated lockfile and registry publication dates for affected updates, and
track the upstream limitation until a released fix is verified. For a manual repair, regenerate
from the preserved pre-update lockfile with `bun install --minimum-release-age=864000` (10 days),
then run `bun install --frozen-lockfile` and inspect publication dates of newly resolved versions.
The age flag does not retroactively reject young versions already recorded in a lockfile.
This is separate from intentional lockfile maintenance, which already requires manual approval
because it refreshes transitives.

## Validating a config change

Before merging edits to `renovate.json`:

```bash
npx --yes --package renovate renovate-config-validator renovate.json
```

For a local dry run (no PRs created), from the repo root:

```bash
LOG_LEVEL=debug npx renovate --platform=local
```

Confirm it proposes bumps, **withholds** releases younger than 10 days ("Not enough time has
elapsed"), and plans to update `bun.lock` and the root `overrides`.
