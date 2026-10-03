# GitHub Actions on a private repository: minutes, storage and your own runner

This guide owns **private-repository costs, runner installation, sharing and upkeep**.
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
runner in a container, and the starter ships one ready to build: `platform/tooling/ci-runner/`.

#### Choose repository or organization scope

**For several private repos with the same trusted maintainers, prefer one GitHub Free
organization and an organization-level pool.** The default runner group can serve selected
repositories; a paid plan is not needed for this shared pool. Four workers then run at most four
jobs concurrently across those repos, instead of reserving four workers for each repo.

| Scope | Who can use the runners | Use it when |
|---|---|---|
| Repository | One repository, whether personally or organization owned | One project, or separate capacity and trust boundaries |
| Organization | Allowed repositories in the same organization, including on GitHub Free | Several trusted private projects sharing capacity |
| Enterprise | Multiple organizations allowed by an enterprise account | Sharing across organizations under Enterprise |

Personal accounts have no account-wide runner pool. Their repos need separate registrations
and containers, although those containers can use the same Mac and image. Multiple Free
organizations also need separate pools; moving related repos into **one** organization enables
sharing. Restrict the default group's repository access to the private repos you intend to serve.
Repository access policy grants access; a matching runner label alone does not.

See GitHub's [runner scopes](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners)
and [group access settings](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access).
This recommendation needs only the default group. Private-repo branch protection and required
reviewers remain paid features ([plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)).

The setup below defaults to repository scope. To share an organization pool, create an
organization registration credential and adjust the **copied** Compose file as described below.
Moving a repository does not turn its existing runners into organization runners: re-register
the pool at organization scope, then enable it for each selected repo. Review GitHub's
[repository transfer checklist](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
before moving a repo, including integrations and references to its old owner/name.

#### On a Mac (Apple Silicon or Intel)

You'll run a Linux runner inside a container. On Apple Silicon it runs natively as arm64 Linux,
with no emulation. Bun, Node, Playwright's Chromium and the Convex local backend all ship arm64
Linux builds. Don't use GitHub's native macOS runner for this: the workflows assume Linux.

**Step 1: install a container engine.** Any of these works:

- [OrbStack](https://docs.orbstack.dev/) (light and fast, our pick for a Mac): `brew install orbstack`
- [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/)
- [Colima](https://github.com/abiosoft/colima) (free, command line): `brew install colima docker docker-compose && colima start --cpu 6 --memory 10`

**Give it enough memory.** An E2E job runs a Convex backend, a Next.js server and Chromium at
once: plan for about **4 GB per runner**, plus whatever else you run in containers, because they all
share the engine's memory limit. In Docker Desktop, Settings → Resources → Memory: 12 GB for two
runners, 16 GB for three. Too little doesn't fail cleanly: E2E jobs fail at random, with Convex
timing out ("Function execution timed out") or the app server dying mid-test
(`ERR_CONNECTION_REFUSED`). OrbStack takes memory as needed; check its limit under Settings.

**Step 2: create a token for the runner.** The runner container registers itself with GitHub on
every start, so it needs a personal access token:

For a **repository runner**:

- **Fine-grained** (recommended): [create one](https://github.com/settings/personal-access-tokens/new)
  with access to **only this repository** and the permission **Administration: Read and write**.
  That permission is what lets it create runner registration tokens.
- **Classic**: the `repo` scope.

For an **organization pool**, an organization owner creates a fine-grained token (recommended) with the
organization as resource owner and organization **Self-hosted runners: Read and write**
permission, subject to the organization's token approval policy. A classic token needs
`admin:org` plus `repo` for private-repository access; a repository-only token is insufficient. See the
[registration API permissions](https://docs.github.com/en/rest/actions/self-hosted-runners#create-a-registration-token-for-an-organization).

Give it an expiry date and put a reminder in your calendar. Keep the credential outside git
and restrict the `.env` file to its owner (`chmod 600 .env`).

**Step 3: build the runner image and start the runners.** Copy the starter's runner files into a
folder outside your repository, for example `~/ci-runner/`:

```bash
mkdir -p ~/ci-runner
cp platform/tooling/ci-runner/Dockerfile platform/tooling/ci-runner/compose.yaml ~/ci-runner/
(cd apps/web && ./node_modules/.bin/playwright --version)    # e.g. "Version 1.63.0"
```

Next to them, create a `.env` file with the token, your repository and that Playwright version:

```bash
GITHUB_RUNNER_PAT=github_pat_...
REPO_URL=https://github.com/<owner>/<repo>
PLAYWRIGHT_VERSION=1.63.0
```

For **organization scope**, use an organization-capable token in that file and add
`ORG_NAME=<your-org>`. In the copied `compose.yaml`, remove the `REPO_URL` environment line,
change `RUNNER_SCOPE: repo` to `RUNNER_SCOPE: org`, and add:

```yaml
      ORG_NAME: ${ORG_NAME:?set ORG_NAME in .env}
```

The remaining environment, volumes and image settings stay the same. Merely adding
`RUNNER_SCOPE` to `.env` does not override the template's hard-coded value. These are the
runner image's [organization settings](https://github.com/myoung34/docker-github-actions-runner/wiki/Usage#org-runners).
Use a separate folder/Compose project for each independent pool so their cache volumes stay
separate. When changing registration scope, wait for active jobs to finish, stop the old pool,
update its configuration and credentials, then recreate it.

Then build the image and start two runners:

```bash
cd ~/ci-runner
docker compose build                      # a minute or two, once
docker compose up -d --scale runner=2     # two runners work on two jobs at once
docker compose logs -f                    # watch them register and pick up jobs
```

After a minute, the runners appear under the repository's (or organization's)
**Settings → Actions → Runners** as idle, with the `starter-ci` label. For an organization pool,
use **Settings → Actions → Runner groups → Default → Repository access** to select its repos.

The image is the community-maintained
[docker-github-actions-runner](https://github.com/myoung34/docker-github-actions-runner) image,
which wraps GitHub's official runner, plus the system libraries and fonts Playwright's Chromium
needs. Everything else stays out of the image and in Docker volumes that every runner on the
Compose project shares:

| Volume | Holds | Downloaded |
|---|---|---|
| `toolcache` | Node | once per Node major version |
| `bun` | Bun and its package cache | once per Bun version; packages once per lockfile change |
| `playwright` | Playwright's Chromium | once per Playwright upgrade |
| `convex` | the Convex local backend | once per Convex backend release |

On GitHub's machines every job downloads all of that again from GitHub's cache, about 9 GB per PR
push. Your runners download each version once and then reuse it, and they don't use the
repository's 10 GB cache quota either. The first run after starting fresh volumes still downloads
everything; if two jobs happen to fetch the same new version at the same moment and one fails,
re-run it.

**How many runners?** One runner runs one job at a time, and a PR push queues about 15–20 jobs.
Two runners are a good start on a 16 GB Mac; three or four if you have 32 GB or more. With two
runners, a PR push that touches everything takes about 10 minutes. More runners
make CI finish sooner; they don't change what it costs, which is nothing.

**Step 4: switch CI over.** Run this for **each** repository allowed to use the pool
(from that repository's checkout, or add `--repo <org>/<repo>`):

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

**After a Playwright upgrade**, E2E jobs show a "Rebuild the CI runner image" notice and install
the browser system libraries themselves, which costs about 20 seconds per job. Update
`PLAYWRIGHT_VERSION` in `.env` and rebuild:

```bash
docker compose build --pull && docker compose up -d --scale runner=2
```

The same command picks up a new base image now and then. Taking a starter release that changes
`platform/tooling/ci-runner/` means refreshing the copied Dockerfile and `compose.yaml`. Preserve
or reapply your local pool settings before rebuilding and recreating the runners: organization
pools must retain `RUNNER_SCOPE: org`, `ORG_NAME`, and the removal of `REPO_URL` from the Compose
environment ([organization setup](#on-a-mac-apple-silicon-or-intel)). Keep your `.env`, labels,
runner name prefix, volume configuration and Compose project identity, and use your existing
worker count instead of the example `--scale runner=2`.

**Housekeeping.** Each new Node, Playwright or Convex version adds to the volumes, and old ones
stay. Check with `docker system df -v`. To start a volume over, stop the runners and remove it;
the next jobs download what they need again:

```bash
docker compose down
docker volume ls                          # names start with the folder name, e.g. ci-runner_playwright
docker volume rm ci-runner_playwright     # or all four
docker compose up -d --scale runner=2
```

Prune images and build output now and then with `docker system prune`. To stop:
`docker compose down`, then delete any leftover offline runners under Settings → Actions → Runners.

**What the shared volumes mean for security.** A job can change what later jobs find in the
volumes, so a malicious pull request could leave a tampered binary behind for the next run. That
is acceptable only because a self-hosted runner belongs on a private repository whose writers you
trust (see the warning above). An organization pool extends that trust to every allowed repo:
one repo's job can affect another repo's cached tools. Use separate pools and cache volumes for
different trust boundaries. If you suspect a run, remove the volumes.

#### On a Linux machine or server

Use the same runner files and `compose.yaml` with Docker on any x86-64 or arm64 Linux host. Or
install GitHub's runner directly on an Ubuntu machine whose user has passwordless `sudo`
([adding a self-hosted runner](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)),
and add the label `starter-ci` when you configure it. Its home folder keeps Node, Bun, the
packages and the browsers between jobs by itself. To skip installing the browser system libraries
in every E2E job, install them once and record the version, as the runner image does:

```bash
(cd apps/web && sudo ./node_modules/.bin/playwright install-deps chromium)
echo "playwright=1.63.0" | sudo tee /etc/starter-ci-runner    # the version installed
```

A 4-core, 8 GB server comfortably runs two runners. More: [about self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners).

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

**Several projects on GitHub Free.** Keep related private repos with the same trusted maintainers
in one Free organization and share an organization-level pool ([scope choice](#choose-repository-or-organization-scope)).
Select the allowed repos and set `PLATFORM_CI_RUNNER` in each. Start with two workers and scale
within the host's resources; four workers means four concurrent jobs across the whole pool.

**Small team on GitHub Team.** A shared Linux runner on a small server (5) handles everyone's
PRs. Set `PLATFORM_CI_PR_E2E=on-demand` (3) so E2E runs once per PR, when it's ready for
review, and still blocks the merge. Set a team budget with alerts (6).

## Related

- [CI guide](ci.md): the workflows, change detection, paid features on private repositories, local CI
- [Full commit verification](ci.md#full-commit-verification): what CI Verify Commit checks
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners) and
  [securing them](https://docs.github.com/en/actions/reference/security/secure-use)
