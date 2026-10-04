# GitHub Actions on a private repository: minutes, storage and your own runner

This guide owns **private-repository costs**. [The local worker guide](local-ci-workers.md)
owns worker installation, scope and upkeep.
[The CI guide](ci.md) owns **what runs, E2E policy, local pre-push commands and act simulation**.
Self-hosted runners execute real jobs scheduled by GitHub and publish PR checks; running
`bun run ci` or `act` locally does not.

Most apps built on the starter live in a **private** GitHub repository. That's the right call, but
it changes one thing you may not have noticed while you were exploring the public starter: on a
private repository **GitHub Actions is metered**. One busy afternoon of pull-request pushes can
use up a month's allowance, and when the allowance runs out GitHub simply stops running your
workflows until the next billing cycle.

This guide explains where the minutes go and gives you options, cheapest first. If you take just
one thing from it: **iterate in draft pull requests**, and consider letting a machine you already
own run CI for free.

## How GitHub bills Actions, in two minutes

- **Public repositories:** standard GitHub-hosted runners are free, without limit.
- **Private repositories:** each account gets a monthly allowance of minutes and artifact storage,
  shared by all its private repositories:

  | Plan | Included minutes / month | Artifact storage |
  |---|---|---|
  | Free | 2,000 | 500 MB |
  | Pro | 3,000 | 1 GB |
  | Team | 3,000 | 2 GB |

  Organisation repositories use the organisation's allowance, not yours.
- **Each job is rounded up to a whole minute.** A job that runs for 4 seconds costs 1 minute.
  Linux is the baseline. Windows runners count double and macOS runners ten times.
- **Storage** is the artifacts workflows upload, averaged over the month. The dependency and
  browser caches don't count toward it: they have their own 10 GB per repository.
- **When the allowance runs out** and no payment method or budget is set, workflows are blocked
  until the allowance resets at the start of the next billing cycle. With a budget, extra Linux
  minutes cost a fraction of a cent each (see "Set a budget" below).
- **Self-hosted runners** (your own machine) use no included minutes.

Details: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

### See your own numbers

**Settings → Billing and licensing → Usage** shows minutes per repository and per day. From the
command line (needs the `user` scope once: `gh auth refresh -h github.com -s user`):

```bash
gh api /users/<your-login>/settings/billing/usage/summary
```

([billing usage API](https://docs.github.com/en/rest/billing/usage))

## Where the starter's minutes go

The starter's CI is deliberately thorough: lint, typecheck, unit, component and backend tests,
production builds with bundle-size budgets, and real-browser E2E tests against a real Convex
backend for every app. That is what keeps upgrades and refactors safe. On a public repository you
never notice the cost. On a private one, **a push to a pull request that touches the web app costs
roughly 55–65 billed minutes**:

| Workflow | Billed minutes, roughly | Why |
|---|---|---|
| CI Web | 30–40 | Four E2E shards of about 9–11 minutes each, each booting its own backend |
| CI Admin, CI Landing, CI Storybook | 5–12 each | Build plus E2E, when the PR touches them |
| CI Shared | 5–8 | Lint and typecheck across the monorepo, backend tests, contracts |
| Security | about 3 | Dependency audit, secrets scan |

Workflows for apps the PR doesn't touch skip their work after a quick change check, so a backend-
or landing-only change costs less. A documentation-only PR costs a few minutes.

On GitHub Free, that is **about 30 pushes a month**. If you push to a PR ten times a day, you'll
hit the limit in the first week.

## Your options, cheapest first

### 1. Iterate in draft pull requests (free, do this today)

E2E tests, the biggest cost, **don't run on draft pull requests**. Lint, typecheck, unit tests
and builds still run, so you get fast feedback for a fraction of the minutes.

```bash
gh pr create --draft          # open the PR as a draft
# ...push as often as you like...
gh pr ready                   # E2E runs once, on the version you want reviewed
```

Every later push to a ready PR runs E2E again, so finish your iterations before `gh pr ready`,
or use option 3 to run E2E only when you ask for it.
To go back to draft: `gh pr ready --undo`.

### 2. Run CI locally before you push (free)

Use the [native pre-push checks](ci.md#local-ci-pre-push-checks) for fast feedback, or
[act](ci.md#running-github-actions-locally-with-act) to debug workflows in Docker. Pushing once
when local checks are green avoids repeated remote runs; it does not replace GitHub PR checks.

### 3. Run E2E on pull requests only when you ask for it

The repository variable `PLATFORM_CI_PR_E2E` sets when E2E runs on pull requests
([details](ci.md#e2e-on-pull-requests)). It lives on GitHub and applies to everyone's CI runs in the
repository. `bun run adopt` and `bun run deploy:setup` offer the choice, or set it yourself:

```bash
gh variable set PLATFORM_CI_PR_E2E --body on-demand   # E2E once, when the PR is final
gh variable set PLATFORM_CI_PR_E2E --body off         # never on PRs: you run E2E locally
gh variable delete PLATFORM_CI_PR_E2E                 # back to the default, always
```

- **`on-demand`** keeps E2E as a merge requirement but runs it once. Push as often as you like
  without it; the **CI <App> Complete** check stays red with an "E2E Required" message. When
  the PR is ready, add the `run-e2e` label (`gh pr edit --add-label run-e2e`) and E2E runs on
  the current head. This needs branch protection to block the merge, which a private
  repository has only on a paid plan.
- **`off`** skips E2E on pull requests entirely. Run `CI=true bun run ci` locally before you merge.

Whatever you choose, **deploys still run E2E**: the staging deploy runs every check with E2E
forced on, and production only deploys what passed there. That costs one full CI run per merge
to `main`, not one per push. Before tagging a release you can also run **CI Verify Commit**
(`gh workflow run ci-verify.yml --ref main`), which forces E2E the same way.

### 4. Keep artifact storage small

E2E reports and screenshots are uploaded only when E2E fails, so green runs store little. All CI
artifacts are kept for 7 days by default. On the Free plan's 500 MB, a shorter retention helps:

```bash
gh variable set PLATFORM_CI_ARTIFACT_RETENTION_DAYS --body 2
```

Old artifacts can be deleted under **Actions → (a run) → Artifacts**, or in bulk with
`gh api` ([artifacts API](https://docs.github.com/en/rest/actions/artifacts)).

### 5. Run CI on your own machine (free, the biggest win)

Use the [local worker guide](local-ci-workers.md). The manager builds prepared images in your
local Docker engine and starts a **new container for every GitHub Actions job**. It infers the
repository from your checkout; no prepared-image registry is required.

Follow [setup and certification](local-ci-workers.md#set-up-before-using-local-ci) before enabling routing.

One operator keeps the worker machine available. Everyone else pushes normally. App CI uses
local workers; summary jobs, Security and deployment workflows remain hosted. Begin with one
worker, observe memory consumption, then increase concurrency if the machine has capacity.

For the retired shared-cache Compose runner, follow the [migration instructions](local-ci-workers.md#migrate-from-the-retired-compose-runner).

### 6. Set a budget, so you're never stuck

Even if you do everything above, a budget means a busy week never blocks a deploy. Add a payment
method, then under **Settings → Billing and licensing → Budgets and alerts** create an Actions
budget, for example $10 a month, with alerts at 75% and 90%
([set up budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets)). Standard 2-core
Linux minutes cost $0.006 each, so 1,000 extra minutes are about $6.

### 7. Or: is the repository really private?

If your app is open source, make it public: Actions on public repositories is free and unlimited.
For most commercial apps that isn't an option, and that's fine. Use the options above.

## Suggested setups

**Solo developer on GitHub Free.** Draft PRs while you work (1), `bun run ci:quick` before
pushing (2), retention of 2 days (4), and one or two runners on your Mac (5). Keep a small budget
(6) as a safety net. Your GitHub-hosted usage drops to the Security workflow, a few minutes per
push.

**Several projects on GitHub Free.** Use separate worker installations and credentials for each
repository, preferably on dedicated CI machines. Organization-wide shared pools are not supported
by this manager.

**Small team on GitHub Team.** A shared Linux runner on a small server (5) handles everyone's
PRs. Set `PLATFORM_CI_PR_E2E=on-demand` (3) so E2E runs once per PR, when it's ready for
review, and still blocks the merge. Set a team budget with alerts (6).

## Related

- [CI guide](ci.md): the workflows, change detection, paid features on private repositories, local CI
- [Full commit verification](ci.md#full-commit-verification): what CI Verify Commit checks
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners) and
  [securing them](https://docs.github.com/en/actions/reference/security/secure-use)
