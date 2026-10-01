# CI Guide

The default dev launcher, local CI and deployment workflows select exactly one landing app: `apps/landing` when its `package.json` exists, otherwise `apps/landing-static`. Keep at least one installed. There is no deployment opt-in flag. `bun run dev:landing` follows this selection; `bun run dev:landing-static` explicitly starts the static app for development. Both use the managed launcher, logs and stop/status commands. Static-only development needs no Convex backend.

> Detailed guide. See [platform/AGENTS.md](../AGENTS.md) for the quick reference.

## Local CI (Pre-Push Checks)

Run the same checks that GitHub Actions CI runs before pushing:

```bash
bun run ci                   # Full CI check (runs everything)
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
10. **Playwright E2E tests** (reuses running development servers or starts them through each app's Playwright configuration)

Artifacts (coverage reports, Playwright reports, visual snapshots, dev logs) are saved to `.ci-local-artifacts/` for local inspection.

With `CI=true`, the dev harness gives its anonymous local Convex backend a five-second query
execution budget. This avoids one-second wall-clock timeouts while small shared runners compile
Next.js. Set `DATABASE_UDF_USER_TIMEOUT_SECONDS` explicitly to use a different local budget.
Interactive development keeps Convex's default; hosted deployments and browser assertions are
unchanged.

Use `bun run ci:quick` to skip E2E tests when you need faster feedback. The script will exit on the first failure with a clear error message.

> **Note**: Security checks (CodeQL, dependency audit, secrets scan), Lighthouse audits, and CI gate are only run in GitHub Actions CI, not locally.

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
4. `ci-landing.yml` — Landing app: same checks; its E2E dev server starts local Convex for waitlist endpoints
5. `ci-storybook.yml` — Storybook app: build, E2E (non-blocking, not required for merge)

### Reusable platform workflows and thin callers

The logic lives in the platform zone as reusable workflows, `platform-*.yml`
(`platform-ci-shared`, `-ci-web`, `-ci-admin`, `-ci-landing`, `-ci-landing-static`,
`-ci-storybook`, `-security`, `-cd-staging`, `-cd-production`, `-cd-rollback`), and the
composite actions in `.github/actions/`. They are replaced on platform upgrade. The app owns thin
callers with the familiar names (`ci-*.yml`, `cd-*.yml`, `security.yml`): triggers, the
permissions they grant, `secrets: inherit` for deploys, and the `CI <App> Complete` job that
branch rules require. Change triggers there, never in `platform-*.yml`.

Deployment audit recording uses `.github/scripts/platform-record-ops.cjs`, which also
ships through platform upgrades. An older app-owned `.github/scripts/record-ops.cjs`
may remain after upgrading; the platform workflows no longer call it. Custom workflows
that use the old helper should switch to the platform-owned path for landing selection support.

- **The platform unit suite** (dev-script and ops tests, the starter upgrade rehearsal) runs in
  CI Shared only when `platform/**`, `.github/**`, `apps/demo/**`, `package.json` or `bun.lock`
  changed. Lint, typecheck, the zone check and contracts run on every PR.
- **Actions stay pinned to full commit SHAs** (`bun run check:actions-pinned`, in CI Shared).
  Some accounts refuse unpinned actions.
- **Removed reference apps are optional.** Landing CI checks the selected commit for its
  app, and CI Shared skips the demo rehearsal when `apps/demo` is absent. Deploys and
  rollbacks likewise inspect the selected commit for landing before building, checking
  credentials or checking health. Web, admin and backend checks remain required.

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

Each workflow uses **composite actions** (`.github/actions/setup-bun`, `.github/actions/setup-playwright`) for shared setup steps, handling both GitHub Actions and act-specific cache-aware setup automatically.

**Configuration**: `.actrc` uses native ARM64 containers on Apple Silicon (no emulation) and bind-mount mode (`-b`) to make composite actions visible to act.

**When to use which**:
- `bun run ci` — Fast native checks, no Docker required
- `bun run ci:act` — Full GitHub Actions simulation in Docker
- `bun run ci:act:offline` — Fast offline execution (no network required)

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
forcing E2E even when `SKIP_E2E` is set. Its final **Verified** job succeeds only
when every workflow succeeds. Called-workflow concurrency includes the caller name,
so ordinary PR or deployment CI cannot cancel it. Run it on a commit before tagging or
releasing it.

### Pull-request base branches

App-owned `ci-*.yml` callers run on all pull-request bases, including stacked and migration branches. They are upgrade seams: upstream trigger fixes merge against your baseline; intentional customization stays yours and conflicts require review. Require summary checks only for installed apps. Both installed landing variants have PR checks; a static-only app requires `CI Landing Static / CI Landing Static Complete`.
