# CI Guide

This guide owns **what CI checks, workflow behavior and local pre-push testing**. For
**private-repository costs**, use [the private CI guide](private-repo-ci.md). Worker installation,
operation and isolation are owned by [the local worker guide](local-ci-workers.md).

## Choose how to run checks

| Method | Execution | Results | Guide |
|---|---|---|---|
| `CI=true bun run ci` / `bun run ci:quick` | Native tools in your checkout | Local feedback before pushing | [Pre-push checks](#local-ci-pre-push-checks) |
| `bun run ci:act` | Local workflow simulation in Docker | Local debugging; does not publish GitHub PR checks | [act](#running-github-actions-locally-with-act) |
| GitHub Actions on local workers | GitHub schedules jobs in disposable containers | Real PR checks and Actions logs, like hosted runners | [Worker setup](local-ci-workers.md) |

For multiple repositories, see the [worker installation scope](local-ci-workers.md#set-up-before-using-local-ci).
Local test commands and `act` do not register a runner or satisfy GitHub required checks.

> Detailed guide. See [platform/AGENTS.md](../AGENTS.md) for the quick reference.

## Local CI (Pre-Push Checks)

Run the same checks that GitHub Actions CI runs before pushing:

```bash
CI=true bun run ci           # Full CI check; supported single-worker web E2E
bun run ci:quick             # Skip E2E tests for faster feedback
```

The `bun run ci` command runs these checks in order (workspace checks use `turbo`;
starter upgrade checks use the root scripts):
1. **TypeScript check** (`bun run typecheck:dev-scripts`, `turbo typecheck`)
2. **ESLint** (`bun run lint:dev-scripts`, `turbo lint`)
3. **Development-script behavior and Bun unit tests** (`bun run test:dev-scripts`, `turbo test`)
4. **Vitest component tests with coverage** (`turbo test:coverage`)
5. **Coverage summary display** + artifact saving
6. **Convex backend tests** (`turbo test:convex`)
7. **Starter ownership and upgrade rehearsal** (`bun run check:starter-ownership`, `bun run test:starter-upgrade`, `bun run test:starter-rehearsal`; scripts also get typechecked/linted)
8. **Production builds**, including Storybook (`turbo build --filter=@repo/$APP...` for web, admin, landing and storybook)
9. **Bundle size check** (all apps with `.size-limit.json`)
10. **Playwright E2E tests** (CI mode starts managed local services through each app's Playwright configuration and refuses to reuse an occupied local server; an explicit `E2E_BASE_URL` instead targets that disposable deployment)

Artifacts (coverage reports, Playwright reports, visual snapshots, dev logs) are saved to `.ci-local-artifacts/` for local inspection.

Use `CI=true` for full local CI and standalone E2E (`CI=true bun run test:e2e`).
Web's Playwright configuration then uses one worker and retries instead of local parallel
workers that can exceed the per-IP edge rate limit and cause HTTP 429/locator timeouts.
This selects test execution settings, not a rate-limit bypass; production defaults stay
unchanged. See [running E2E reliably](testing.md#running-playwright-e2e-reliably) for server
isolation and troubleshooting.

With `CI=true`, the dev harness gives its anonymous local Convex backend a five-second query
execution budget. This avoids one-second wall-clock timeouts while small shared runners compile
Next.js. Set `DATABASE_UDF_USER_TIMEOUT_SECONDS` explicitly to use a different local budget.
Interactive development keeps Convex's default; hosted deployments and browser assertions are
unchanged.

Use `bun run ci:quick` to skip E2E tests when you need faster feedback. The script will exit on the first failure with a clear error message.

> **Note**: The native local CI script does not run Security checks (CodeQL, dependency audit,
> secrets scan), Lighthouse audits or the GitHub CI gate. Runner location is a separate choice;
> the platform keeps Security and deployment jobs GitHub-hosted by default.

## Running GitHub Actions Locally with `act`

[act](https://github.com/nektos/act) runs GitHub Actions workflows locally in Docker containers:

```bash
# Install act (requires Docker)
brew install act

# Run all CI workflows
bun run ci:act                # Full output + summary
bun run ci:act:quick          # Quiet mode, summary only
bun run ci:act:offline        # Offline mode (after caches are populated)

# Run a specific workflow
./platform/tooling/ci-local-act.sh -w shared    # Shared workflow (checks listed below)
./platform/tooling/ci-local-act.sh -w web       # Just web app CI
./platform/tooling/ci-local-act.sh -w admin     # Just admin app CI
./platform/tooling/ci-local-act.sh -w landing   # Just landing app CI
./platform/tooling/ci-local-act.sh -w storybook # Just storybook app CI

# Run a specific job
./platform/tooling/ci-local-act.sh -j lint      # Just linting
./platform/tooling/ci-local-act.sh -l           # List available jobs
./platform/tooling/ci-local-act.sh -o           # Offline mode
```

**CI is split into 5 independent workflows** that `ci-local-act.sh` runs sequentially:
1. `ci-shared.yml` — Lint, typecheck, backend tests, and the required starter ownership checks and demo upgrade rehearsal (see `apps/demo/README.md`)
2. `ci-web.yml` — Web app: unit tests, component tests, build, bundle size, E2E
3. `ci-admin.yml` — Admin app: same checks as web
4. `ci-landing.yml` — Landing app: same checks; its E2E launcher starts Convex for browser-side onboarding and announcements
5. `ci-storybook.yml` — Storybook app: build, E2E

Each workflow uses **composite actions** (`.github/actions/setup-bun`, `.github/actions/setup-playwright`)
for shared setup. They handle GitHub-hosted runners, [local workers](local-ci-workers.md)
and act-specific cache setup. `.actrc` uses native ARM64 containers on Apple Silicon (no emulation)
and bind-mount mode (`-b`) to make composite actions visible to act.

For repeated runs without downloads, see [offline act](#offline-ci-mode-act).

## GitHub Actions workflows

### Reusable platform workflows and thin callers

The logic lives in the platform zone as reusable workflows, `platform-*.yml`
(`platform-ci-shared`, `-ci-web`, `-ci-admin`, `-ci-landing`, `-ci-storybook`, `-security`,
`-cd-staging`, `-cd-production`, `-cd-rollback`), and the composite actions in
`.github/actions/`. They are replaced on platform upgrade. The app owns thin callers with the
familiar names (`ci-*.yml`, `cd-*.yml`, `security.yml`): triggers, the permissions they grant, `secrets: inherit` for deploys, and the `CI <App> Complete` job that
branch rules require. Change triggers there, never in `platform-*.yml`.

`CI <App> Complete` passes when the platform workflow succeeds, that is when every job in it
succeeded or was skipped. Jobs are skipped when the PR touches no relevant files. Whether E2E
runs on a pull request is set by `PLATFORM_CI_PR_E2E` ([E2E on pull requests](#e2e-on-pull-requests));
with `require_e2e` (CI Verify Commit, the staging deploy) E2E always runs and must pass. The platform workflows have no summary job of their own: GitHub bills each job
for at least a minute, so a seconds-long check is kept to the one the branch rules need.

- **CI artifacts are kept small.** Playwright reports, sharded blob reports and visual snapshots
  are uploaded only when E2E fails, and web's sharded reports are merged only then. Coverage
  reports and the upgrade-rehearsal evidence are uploaded on every run. The repository variable
  `PLATFORM_CI_ARTIFACT_RETENTION_DAYS` (default 7) sets how long all of them are kept.
- **CI can run on disposable local workers.** Set up the [local worker manager](local-ci-workers.md)
  with `bun run ci:workers:setup`. It infers the repository from the current checkout. The manager
  owns `PLATFORM_CI_WORKER_POOL`; workflows request the pool, exact source SHA and run ID.
  New containers reuse immutable local images with private writable state. Summary jobs,
  Security and deployments stay hosted. The legacy `PLATFORM_CI_RUNNER` selector remains
  compatible with externally operated runners, but the shared-cache Compose setup is retired.

Deployment audit recording uses `.github/scripts/platform-record-ops.cjs`, which also
ships through platform upgrades. An older app-owned `.github/scripts/record-ops.cjs`
may remain after upgrading; the platform workflows no longer call it. Custom workflows
that use the old helper should switch to the platform-owned path.

- **The platform unit suite** (dev-script and ops tests, the starter upgrade rehearsal) runs in
  CI Shared only when `platform/**`, `.github/**`, `apps/demo/**`, `package.json` or `bun.lock`
  changed. Lint, typecheck, the zone check and contracts run on every PR.
- **Actions stay pinned to full commit SHAs** (`bun run check:actions-pinned`, in CI Shared).
  Some accounts refuse unpinned actions.
- **The demo app is optional.** CI Shared skips the demo rehearsal when `apps/demo` is absent.
  Web, admin, landing and backend are required: deploys and rollbacks fail early when the
  selected commit has no `apps/landing`.

### E2E on pull requests

E2E is the slowest and, on a private repository, the most expensive part of CI
([private-repo-ci.md](private-repo-ci.md)). The repository variable `PLATFORM_CI_PR_E2E` sets
when it runs on pull requests (Settings → Secrets and variables → Actions → Variables):

| `PLATFORM_CI_PR_E2E` | E2E on a ready PR | Before merge |
|---|---|---|
| `always` (default) | Runs on every push | `CI <App> Complete` includes E2E |
| `on-demand` | Runs only when the PR has the `run-e2e` label | `CI <App> Complete` fails until E2E has passed on the PR head |
| `off` | Skipped | Not enforced |

- **Draft PRs** skip E2E in every mode, and don't fail.
- **`on-demand`** is for teams that want E2E enforced before merge but run it once, when the PR
  is final. Without the label, the **E2E Required** job fails and says how to request E2E. Add
  the label (`gh pr edit --add-label run-e2e`): the **CI E2E Request** workflow
  (`ci-e2e-request.yml`) re-runs the waiting checks, and E2E then runs on every later push while
  the label stays. Iterate without the label and add it when you're done. The check
  reads the labels when it runs, so re-running it by hand also works. Enforcement needs
  `CI <App> Complete` as a required check with "Require branches to be up to date", so the
  squash-merged tree is the one E2E tested ([branch protection](deployment-runbook.md#configure-branch-protection)).
  On a private repository, branch protection needs a paid plan (Pro, Team or Enterprise). On
  GitHub Free nothing blocks the merge and only the deploy gate below applies.
  Pull requests from forks get a read-only token, so the label can't re-run their checks:
  re-run them by hand.
- **`off`** saves the most. Run E2E locally (`bun run ci`) instead.
- **Deploys always run E2E**, whatever the mode. The staging deploy calls the CI workflows with
  `require_e2e: true`, and production deploys only a commit whose staging CI passed
  (`ci/gate-passed`). CI Verify Commit also forces E2E.

A value other than the three modes fails pull-request CI with an error naming the variable.

It is a repository variable on GitHub, not a local setting: one value applies to everyone's CI
runs in the repository, and only a repository admin can change it. `bun run adopt` and
`bun run deploy:setup` ask for it on a private repository. Until it is set there, CI Web shows a
notice on each pull-request run; setting it to `always` keeps the default and hides the notice.

### Platform update delivery

The app-owned `update-platform.yml` calls `platform-update.yml` to discover releases, verify
upgrades without write credentials, and deliver a ready/draft PR or an issue from a separate
job. See [update delivery](update-delivery.md) for App setup, token fallback and review recovery.

### Paid features on private repositories

Every workflow runs on GitHub Free with a private repository. Features that GitHub gives free
only to public repositories run when the repository is public or a repository variable turns
them on (Settings → Secrets and variables → Actions → Variables); otherwise their job is
skipped and a **Paid feature skipped** notice explains why (`.github/actions/paid-feature`).

| Feature | Where | Enable on a private repository |
|---|---|---|
| CodeQL, dependency review | `platform-security.yml` | GitHub Code Security, then `PLATFORM_CODE_SECURITY=true` |
| Build provenance attestations | `platform-cd-staging.yml`, `platform-cd-production.yml` | Organisation on Enterprise Cloud, then `PLATFORM_ATTESTATIONS=true` (user-owned private repositories can't). A failed attestation never fails a deploy |
| Production approval (required reviewers) | `production` environment | Enterprise (private repositories), then `PLATFORM_ENVIRONMENT_PROTECTION=true`. Informational: without it the `confirm` input is the only gate |

Deploy jobs name the `staging` and `production` environments but read only repository-level
secrets, so they work on every plan.

## Offline CI Mode (act)

### Rationale

Running CI tests locally should be fast and not require internet access for every run. When you're iterating on code without changing dependencies, there's no need to re-download tools, packages, or browser binaries. Offline mode enables:

1. **Fast iteration** — Skip network downloads on subsequent runs
2. **Airplane mode development** — Work without internet connectivity
3. **Reduced bandwidth** — Don't re-download the same artifacts repeatedly
4. **Consistent environments** — Use the exact same cached binaries across runs

### How It Works

The `ci-local-act.sh` script uses **Docker volumes** to persist downloaded artifacts between runs:

| Volume Name | Container Path | Contents |
|-------------|----------------|----------|
| `act-bun-cache` | `/root/.bun` | Bun binary + package cache (node_modules) |
| `act-playwright-cache` | `/root/.cache/ms-playwright` | Chromium browser binaries |
| `act-toolcache` | `/opt/act-toolcache` | Node.js installations |

**First run (online):** Downloads and caches everything to Docker volumes
**Subsequent runs:** Uses cached artifacts from volumes. After a required tool
version changes, run online again to populate that version before using offline mode.

### Usage

```bash
# First run: populate caches (requires internet)
bun run ci:act

# Subsequent runs: use offline mode (no internet required)
bun run ci:act:offline
```

The offline flag (`-o`) adds:
- `--pull=false` — Don't pull Docker images
- `--action-offline-mode` — Don't fetch GitHub Actions

### Currently Cached Tools

| Tool | Cache Location | Setup Pattern |
|------|----------------|---------------|
| Bun | `/root/.bun/bin/bun` | See exact-version selection under “How It Works” above |
| Node.js | `/opt/act-toolcache/node/` | `setup-node` respects `RUNNER_TOOL_CACHE` |
| Playwright | `/root/.cache/ms-playwright/` | Volume persists browser binaries |
| npm packages | `/root/.bun/install/cache/` | Bun's package cache |

### Troubleshooting

**Cache issues (tar errors):** The `actions/cache` step is skipped in act (`if: ${{ !env.ACT }}`) because multiple parallel jobs sharing the same volume causes race conditions. Docker volumes provide persistence instead.

**Tool not found offline:** Run `bun run ci:act` once online to populate caches.

**Clearing caches:** Remove Docker volumes to start fresh:
```bash
docker volume rm act-bun-cache act-playwright-cache act-toolcache
```

## Full commit verification

Pull-request CI tests the PR head, not the squash-merged commit on main. The manual
`ci-verify.yml` workflow (**CI Verify Commit**) runs on main only and calls the existing
CI workflows with the tip's `git_sha` and `require_e2e: true` for app workflows,
forcing E2E whatever `PLATFORM_CI_PR_E2E` says. Its final **Verified** job succeeds only
when every workflow succeeds. Called-workflow concurrency includes the caller name,
so ordinary PR or deployment CI cannot cancel it. Run it on a commit before tagging or
releasing it.

### Pull-request base branches

App-owned `ci-*.yml` and `security.yml` callers run on all pull-request bases, including stacked and migration branches. They are upgrade seams: upstream trigger fixes merge against your baseline; intentional customization stays yours and conflicts require review. For required summary checks, see the [branch-protection checklist](deployment-runbook.md#configure-branch-protection).

### Prepared worker parity

`starter-workers check --install` runs two disposable smoke workers and an offline install.
`starter-workers check --ci` runs native CI inside the same image and container policy used by
GitHub-dispatched workers. It tests the committed revision, never a writable bind mount of your
checkout. `check --github` tests actual GitHub scheduling through two sequential jobs. See
[branch testing](local-ci-workers.md#test-a-branch-before-enabling-normal-ci).

`ci:act` remains a trusted local workflow simulator with its own mutable caches. Its containers
are not proof of managed-worker parity and must not be used for untrusted pull requests.
