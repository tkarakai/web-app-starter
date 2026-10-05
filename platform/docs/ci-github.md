# CI on GitHub Actions

GitHub Actions is the starter's CI provider: it schedules workflows, records job results and
publishes the checks used by pull requests and deployment gates. This guide explains that
process and its repository-wide policy. GitHub can execute jobs on hosted runners or on your
own disposable workers; changing the execution machine does not change the provider.

| Task | Guide |
|---|---|
| Understand GitHub workflows, required checks, E2E policy and costs | [CI on GitHub Actions](ci-github.md) |
| Check your changes before pushing or debug workflows with act | [Pre-push CI](ci-pre-push.md) |
| Set up and operate disposable workers for GitHub jobs | [Local CI workers](ci-workers.md) |

## CI process

1. A pull-request push starts the app and shared CI callers plus Security. Change detection selects
   affected workloads; the repository's E2E policy decides which browser tests run.
2. The callers publish completion checks. Configure branch protection to require the installed
   apps' checks and the applicable security checks before merging.
3. Staging deployment verifies the selected commit with E2E required. Production uses a commit
   that passed staging's CI gate. See the [deployment runbook](deployment-runbook.md).
4. Use [full commit verification](#full-commit-verification) when you need CI on the merged main
   commit independently of deployment, for example before tagging a release.

Local [pre-push checks](ci-pre-push.md) provide feedback before step 1. They do not publish or
satisfy GitHub required checks.

## Checks and workflows

| Caller | Main checks |
|---|---|
| `ci-shared.yml` | Checkout/platform inventory, workspace lint/typecheck, startup smoke, backend tests, contracts, ownership and the demo upgrade rehearsal when present |
| `ci-web.yml` | Web unit/component tests, coverage, production build, bundle budget and E2E |
| `ci-admin.yml` | Admin unit/component tests, coverage, production build, bundle budget and E2E |
| `ci-landing.yml` | Landing tests, production build, bundle budget, export browser smoke and E2E |
| `ci-storybook.yml` | Storybook production build and E2E |
| `security.yml` | Dependency/advisory and secret scans, CodeQL and dependency review when available, and Security Complete |

The shared check profiles live in `platform/tooling/ci-checks.ts`; native CI and GitHub use the
same inventory. The [pre-push guide](ci-pre-push.md#local-ci-pre-push-checks) lists the native
execution order. Test-specific behavior belongs in [testing](testing.md).

## Workflow ownership

Reusable `platform-*.yml` workflows contain the implementation: app/shared CI, Security,
deployment and rollback. They and the composite setup actions under `.github/actions/` are
platform-owned and replaced on upgrade.

Your app owns the thin `ci-*.yml`, `security.yml` and `cd-*.yml` callers: their triggers,
permissions, deployment `secrets: inherit`, and completion jobs. Customize triggers in the
callers. Upgrades merge trigger fixes against your baseline; customized seams may need conflict
resolution. Keep Actions pinned to full commit SHAs (`bun run check:actions-pinned`).

The setup actions support hosted runners, managed [workers](ci-workers.md), and
[act simulation](ci-pre-push.md#running-github-actions-locally-with-act).

## Pull-request base branches

App-owned `ci-*.yml` and `security.yml` callers run on all pull-request bases, including stacked
and migration branches. Require the summary checks for the installed apps and remove a deleted
app's required check. Copy exact check names from a completed PR run; see
[branch protection](deployment-runbook.md#configure-branch-protection).

All app CI and staging deployment selectors consume `.github/platform-impact.json`, the
authoritative path policy. Shared packages, including new `packages/*`, platform packages and
CI/tooling changes select all app consumers and backend tests/deployment. App-only changes stay
scoped. Documentation outside those paths does not select app work; platform documentation
still selects shared platform checks. The demo upgrade rehearsal runs only when the demo is
present. Web, admin, landing and backend are required for the starter's deployment workflows.

## E2E on pull requests

E2E is usually the largest part of a CI run. On private repositories, repeated hosted runs
can consume much of the Actions allowance. The repository variable `PLATFORM_CI_PR_E2E` sets
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

## Required checks and security

Each `CI <App> Complete` check passes when its reusable workflow succeeds: every job succeeded
or was legitimately skipped. E2E enforcement follows the policy above. Keep those completion
checks required in branch protection.

The **Security Complete** job requires every applicable scan to succeed. Paid CodeQL/dependency
review can skip when unavailable; dependency review also skips outside PRs. Registry failures,
missing tools/lockfiles and malformed audit output fail the scan. High/critical dependency findings
fail; lower severities warn.

On public repositories, require both **Security Complete** and the standalone **CodeQL** check.
Security Complete verifies scan execution; CodeQL separately enforces the repository's alert
policy and can fail even when analysis and upload succeeded.

## Full commit verification

Pull-request CI tests the PR head, not the squash-merged main commit. The normal mode of
`ci-verify.yml` (**CI Verify Commit**) runs on main and calls the existing workflows with the
selected `git_sha` and `require_e2e: true`. Its final **Verified** job succeeds only when every
workflow succeeds. Called-workflow concurrency includes the caller name, so ordinary PR or
deployment CI cannot cancel it.

```sh
gh workflow run ci-verify.yml --ref main
```

The same workflow has a separate [worker diagnostic mode](ci-workers.md#test-a-branch-before-enabling-normal-ci)
that can run from a reviewed branch. That mode checks worker parity and isolation, skips
**Verified**, and does not count as full commit verification.

## Where jobs run

Hosted `ubuntu-latest` runners are the default. The optional [worker manager](ci-workers.md)
sets `PLATFORM_CI_WORKER_POOL`; CI workloads then request that pool, exact source SHA and run ID.
Each job receives a fresh container while reusing immutable prepared images. PR and push CI
summaries and Security jobs use the same source-bound route. Scheduled Security, deployment,
Renovate and updater coordination use `PLATFORM_CI_AUX_RUNNER` when configured; updater jobs can
also use their separate prepared pools.

The legacy `PLATFORM_CI_RUNNER` setting supports externally operated Linux runners, including
native Security scans on amd64/arm64. With no local selector, jobs use hosted runners unless
`PLATFORM_CI_LOCAL_ONLY=true`, which instead requests an unmatched local label and leaves those
jobs queued. See [all-local routing](ci-workers.md#keep-every-actions-job-local) for the auxiliary
runner and cutover sequence. The retired shared-cache Compose runner is replaced for prepared CI
jobs by the manager; follow the [migration guide](ci-workers.md#migrate-from-the-retired-compose-runner).

## Artifacts and private repository costs

GitHub-hosted runs in private repositories consume the owner's plan allowance. Standard hosted
runs in public repositories and self-hosted execution are free under GitHub's current billing
policy. Artifacts and caches have separate storage allowances. Consult
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
for current quotas and prices; use **Settings → Billing and licensing → Usage** to measure your
own workload rather than relying on a fixed minutes-per-push estimate.

Reduce repeated work by checking locally before pushing and iterating in draft PRs. Use the
[E2E policy](#e2e-on-pull-requests) to choose when browser tests run. With `on-demand`, E2E runs
again on later pushes while the label remains; it is not a one-time exemption. Local workers
reduce hosted execution while requiring an available, maintained host.

Playwright reports, sharded blob reports and visual snapshots upload only on E2E failure; web
merges sharded reports only then. Coverage and upgrade-rehearsal evidence upload on every run.
CI artifact retention defaults to seven days:

```sh
gh variable set PLATFORM_CI_ARTIFACT_RETENTION_DAYS --body 2
```

This variable applies to CI artifacts, not the worker manager's local image/log retention.
Delete old artifacts under **Actions → a run → Artifacts**, or through the
[artifacts API](https://docs.github.com/en/rest/actions/artifacts).

Set alerts and any intended spending limit under **Billing and licensing → Budgets and alerts**.
Whether a budget stops usage depends on its settings; a budget alone does not guarantee
uninterrupted workflows. See [GitHub's budget instructions](https://docs.github.com/en/billing/how-tos/set-up-budgets).

## Paid features on private repositories

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

## Platform update delivery

The app-owned `update-platform.yml` calls `platform-update.yml` to discover releases, verify
upgrades without write credentials, and deliver a ready/draft PR or an issue from a separate
job. See [update delivery](update-delivery.md) for App setup, token fallback and review recovery.

Deployment audit recording uses `.github/scripts/platform-record-ops.cjs`, which ships through
platform upgrades. Custom workflows using the older app-owned
`.github/scripts/record-ops.cjs` should switch to the platform-owned path.
