# CI Guide

> Detailed guide for AI agents. See [AGENTS.md](../../AGENTS.md) for the quick reference.

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
./scripts/ci-local-act.sh -w shared    # Shared workflow (checks listed below)
./scripts/ci-local-act.sh -w web       # Just web app CI
./scripts/ci-local-act.sh -w admin     # Just admin app CI
./scripts/ci-local-act.sh -w landing   # Just landing app CI
./scripts/ci-local-act.sh -w storybook # Just storybook app CI

# Run a specific job
./scripts/ci-local-act.sh -j lint      # Just linting
./scripts/ci-local-act.sh -l           # List available jobs
./scripts/ci-local-act.sh -o           # Offline mode
```

**CI is split into 5 independent workflows** that `ci-local-act.sh` runs sequentially:
1. `ci-shared.yml` — Lint, typecheck, backend tests, and the required starter ownership checks and demo upgrade rehearsal (see `apps/demo/README.md`)
2. `ci-web.yml` — Web app: unit tests, component tests, build, bundle size, E2E
3. `ci-admin.yml` — Admin app: same checks as web
4. `ci-landing.yml` — Landing app: same checks (no Convex dependency)
5. `ci-storybook.yml` — Storybook app: build, E2E (non-blocking, not required for merge)

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

For Node, `.github/actions/setup-bun/find-node.sh` checks the requested major
version and runner architecture in `RUNNER_TOOL_CACHE`. A cache miss falls back
to `actions/setup-node`, including under act. An older cached major does not meet
the new request. `scripts/tests/setup-node-cache.test.ts` covers this selection.

For Bun under act, `.github/actions/setup-bun/setup-bun-act.sh` reuses a cached
binary only when its reported version exactly matches the requested version.
A missing or stale binary triggers installation; download failure or a mismatched
installed version fails setup before publishing its directory to `GITHUB_PATH`.
See `scripts/tests/setup-bun-cache.test.ts` for regression coverage. After a Bun
upgrade, populate the matching binary online before returning to offline mode.

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

### Pattern for Adding New Tools

When introducing a tool that downloads from the internet, create a composite action
in `.github/actions/<tool-name>/action.yml`. Use
[setup-bun](../../.github/actions/setup-bun/action.yml) and its
[act helper](../../.github/actions/setup-bun/setup-bun-act.sh) as the reference for
version-aware cache reuse, installation failure handling, and path publication.

Then use it in any workflow job:
```yaml
steps:
  - uses: ./.github/actions/setup-toolname
```

**Key principles:**
1. Use composite actions to avoid duplicating setup across workflows
2. Use `if: ${{ !env.ACT }}` for standard GitHub Actions setup steps
3. Use `if: ${{ env.ACT }}` for act-specific cache-aware setup
4. Reuse a cached tool only when it satisfies the requested version
5. Install to a path that's mounted as a Docker volume
6. Verify successful installation and the requested version before adding the tool to `$GITHUB_PATH`

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
so ordinary PR or deployment CI cannot cancel it. Starter tags are created only on
a commit with a green run (see "What gets tagged" in `VERSIONING.md`).
