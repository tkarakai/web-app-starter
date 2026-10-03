# GitHub Actions on a private repository: minutes, storage and your own runner

> Practical guide. For how the CI workflows are built, see [ci.md](ci.md).

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

The same checks run on your machine:

```bash
bun run ci:quick              # everything except E2E: a few minutes
CI=true bun run ci            # the full suite, E2E included
```

Pushing once when it's green costs one CI run, not five. See [local CI](ci.md#local-ci-pre-push-checks).

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

GitHub doesn't count minutes on **self-hosted runners**. Any machine you already own can run the
starter's CI: a Mac you work on, a spare Linux box, a small cloud server. Set one repository
variable and all CI jobs (CI Shared, Web, Admin, Landing, Storybook, and CI Verify Commit) run
there instead of on GitHub's machines:

```bash
gh variable set PLATFORM_CI_RUNNER --body starter-ci     # the label your runner registers with
gh variable delete PLATFORM_CI_RUNNER                    # back to GitHub-hosted runners
```

The Security workflow and deployments stay on GitHub-hosted runners: the secrets scan needs Docker,
and deployment credentials shouldn't live on a personal machine. Security costs about 3 minutes
per push. To save those as well, edit the triggers in your app-owned `.github/workflows/security.yml`
to run on `main` and on the weekly schedule only.

> **Security first: only ever attach a self-hosted runner to a private repository.** On a public
> repository, anyone can open a pull request from a fork and run code on your machine. On a private
> repository, anyone with write access still can, so treat the runner like a shared machine. Run it
> in a container (as below) that can't see your home directory, and never mount your Docker socket
> into it. Read GitHub's [hardening advice for self-hosted runners](https://docs.github.com/en/actions/reference/security/secure-use).

The CI jobs expect an **Ubuntu-like Linux machine with passwordless `sudo`**: Playwright installs
browser system libraries with `apt`. The easiest way to get exactly that, on any computer, is a
runner in a container.

#### On a Mac (Apple Silicon or Intel)

You'll run a Linux runner inside a container. On Apple Silicon it runs natively as arm64 Linux,
with no emulation. Bun, Node, Playwright's Chromium and the Convex local backend all ship arm64
Linux builds. Don't use GitHub's native macOS runner for this: the workflows assume Linux.

**Step 1: install a container engine.** Any of these works:

- [OrbStack](https://docs.orbstack.dev/) (light and fast, our pick for a Mac): `brew install orbstack`
- [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/)
- [Colima](https://github.com/abiosoft/colima) (free, command line): `brew install colima docker docker-compose && colima start --cpu 6 --memory 10`

**Give it enough memory.** An E2E job runs a Convex backend, a Next.js server and Chromium at
once: plan for about **3 GB per runner**. In Docker Desktop, Settings → Resources → Memory:
8 GB or more for two runners. OrbStack takes memory as needed; check its limit under Settings.

**Step 2: create a token for the runner.** The runner container registers itself with GitHub on
every start, so it needs a personal access token:

- **Fine-grained** (recommended): [create one](https://github.com/settings/personal-access-tokens/new)
  with access to **only this repository** and the permission **Administration: Read and write**.
  That permission is what lets it create runner registration tokens.
- **Classic**: the `repo` scope.

Give it an expiry date and put a reminder in your calendar.

**Step 3: start the runners.** Create a folder outside your repository, for example
`~/ci-runner/`, with a `.env` file holding the token:

```bash
GITHUB_RUNNER_PAT=github_pat_...
```

and this `compose.yaml`. It uses the community-maintained
[docker-github-actions-runner](https://github.com/myoung34/docker-github-actions-runner) image,
which wraps GitHub's official runner:

```yaml
services:
  runner:
    image: myoung34/github-runner:ubuntu-noble
    restart: always
    environment:
      REPO_URL: https://github.com/<owner>/<repo>
      RUNNER_SCOPE: repo
      ACCESS_TOKEN: ${GITHUB_RUNNER_PAT}
      LABELS: starter-ci
      RUNNER_NAME_PREFIX: mac-ci
      EPHEMERAL: "true"        # a fresh registration for every job
```

```bash
cd ~/ci-runner
docker compose up -d --scale runner=2     # two runners work on two jobs at once
docker compose logs -f                    # watch them register and pick up jobs
```

After a minute, the runners appear under the repository's **Settings → Actions → Runners** as
idle, with the `starter-ci` label.

**How many runners?** One runner runs one job at a time, and a PR push queues about 15–20 jobs.
Two runners are a good start on a 16 GB Mac; three or four if you have 32 GB or more. More runners
make CI finish sooner; they don't change what it costs, which is nothing.

**Step 4: switch CI over.**

```bash
gh variable set PLATFORM_CI_RUNNER --body starter-ci
```

Push to a PR and watch the jobs show up in `docker compose logs`.

**Step 5: keep the Mac available.** Jobs wait in the queue while your Mac sleeps or is offline,
and fail after 24 hours. Some habits that help:

- Keep it awake while plugged in: System Settings → Battery → Options → "Prevent automatic
  sleeping on power adapter when the display is off", or run `caffeinate -s` in a terminal.
- Start the container engine at login (OrbStack and Docker Desktop both have the setting). With
  `restart: always` the runners come back by themselves.
- Leaving for a trip? `gh variable delete PLATFORM_CI_RUNNER` puts CI back on GitHub's machines
  while you're away.

**Housekeeping.** Images and build output accumulate. Prune now and then with
`docker system prune`. To update the runner image: `docker compose pull && docker compose up -d --scale runner=2`.
To stop: `docker compose down`, then delete any leftover offline runners under Settings → Actions → Runners.

#### On a Linux machine or server

Use the same `compose.yaml` with Docker on any x86-64 or arm64 Linux host. Or install GitHub's
runner directly on an Ubuntu machine whose user has passwordless `sudo`
([adding a self-hosted runner](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)),
and add the label `starter-ci` when you configure it. A 4-core, 8 GB server comfortably runs two
runners. More: [about self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners).

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

**Small team on GitHub Team.** A shared Linux runner on a small server (5) handles everyone's
PRs. Set `PLATFORM_CI_PR_E2E=on-demand` (3) so E2E runs once per PR, when it's ready for
review, and still blocks the merge. Set a team budget with alerts (6).

## Related

- [CI guide](ci.md): the workflows, change detection, paid features on private repositories, local CI
- [Full commit verification](ci.md#full-commit-verification): what CI Verify Commit checks
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners) and
  [securing them](https://docs.github.com/en/actions/reference/security/secure-use)
