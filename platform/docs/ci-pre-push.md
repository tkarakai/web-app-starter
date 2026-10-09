# Pre-push CI for developers

Use this guide to check your changes before pushing and to debug GitHub workflow logic locally.
Start with native `bun run ci:quick` during iteration, then run `CI=true bun run ci` before
requesting final review or merging. Native checks use your current checkout, including
uncommitted changes. They do not publish GitHub PR checks.

| Task | Guide |
|---|---|
| Understand GitHub workflows, required checks, E2E policy and costs | [CI on GitHub Actions](ci-github.md) |
| Check your changes before pushing or debug workflows with act | [Pre-push CI](ci-pre-push.md) |
| Set up and operate disposable workers for GitHub jobs | [Local CI workers](ci-workers.md) |

## Local CI pre-push checks

Run from the repository root after installing dependencies with `bun install --frozen-lockfile`:

Before your first browser test run, and after a Playwright upgrade, run `bun run setup:e2e` to
install the matching Chromium binaries. Development startup does not install browsers. Use the
[development setup](development.md) for the required Node/Bun versions and local configuration.

```bash
CI=true bun run ci           # Full CI check; supported single-worker web E2E
bun run ci:quick             # Skip E2E and export browser tests
```

The `bun run ci` command runs these checks in order (workspace checks use `turbo`;
starter upgrade checks use the root scripts):

1. **Workspace TypeScript check** (`turbo typecheck`).
2. **Workspace ESLint** (`turbo lint`).
3. **Shared checkout and platform inventory** (`platform/tooling/ci-checks.ts`): runtime, skills, pinned Actions, i18n, zone, dependency floors in the product, tooling typecheck/lint/tests, ops, auth UI, agentic gateway/test-client contracts and shared-package coverage. Native CI and GitHub execute the same inventory.
4. **Authorization contracts** (`bun run test:contracts`).
5. **Public startup smoke** (`bun run test:startup`): a stale Bun workspace installation, real Next/Tailwind pages and CSS, and a compile-failure cleanup check. Only this isolated regression stubs the backend executable; normal E2E uses the real local backend.
6. **Bun unit tests** (`turbo test`, per app).
7. **Vitest component tests with coverage** (`turbo test:coverage`)
8. **Coverage summary display** + artifact saving
9. **Convex backend tests** (`turbo test:convex`)
10. **Starter ownership and upgrade rehearsal** (`bun run check:starter-ownership`, `bun run test:starter-upgrade`, `bun run test:starter-rehearsal`; scripts also get typechecked/linted)
11. **Production builds**, including Storybook (`turbo build --filter=@repo/$APP...` for web, admin, landing and storybook)
12. **Built landing browser smoke** (`bun run test:landing-artifacts`): see [shared UI and production artifacts](testing.md#shared-ui-and-production-artifacts).
13. **Bundle size check** (all apps with `.size-limit.json`)
14. **Playwright E2E tests** (CI mode starts managed local services through each app's Playwright configuration and refuses to reuse an occupied local server; an explicit `E2E_BASE_URL` instead targets that disposable deployment)

Artifacts (coverage reports, Playwright reports, visual snapshots and dev logs) are saved to
`.ci-local-artifacts/`. Each run replaces the preceding run's local artifacts; copy evidence you
need to retain before starting another run.

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

Use `bun run ci:quick` to skip browser tests (E2E and the export smoke) when you need faster feedback. The script will exit on the first failure with a clear error message.

Native CI runs the shared application checks, without GitHub change detection, uploaded artifacts
or PR completion checks. CodeQL, dependency audit, secrets scans and Lighthouse are additional
[GitHub checks](ci-github.md#required-checks-and-security).

## Optional online checks

Run the published-advisory and Bun registry audit checks separately when you need local feedback
on dependency security:

```sh
./platform/tooling/node-ts.sh platform/tooling/ci-checks.ts online
```

These require network access. Registry errors, missing tools/lockfiles and malformed audit output
fail, as do high/critical findings. This command does not run CodeQL or replace
[GitHub Security](ci-github.md#required-checks-and-security).

## Running GitHub Actions locally with act

Use [act](https://github.com/nektos/act) when you need to debug workflow steps and composite actions
in Docker. Native checks are the normal pre-push path. Act simulates workflows locally; its
containers and mutable caches do not establish parity with managed CI workers.

```sh
brew install act              # macOS; Docker must also be running
bun run ci:act                # simulate all five CI callers sequentially
bun run ci:act:quick          # quiet output, not fewer checks
bun run ci:act:offline        # reuse cached images and Actions

./platform/tooling/ci-local-act.sh -w shared
./platform/tooling/ci-local-act.sh -w web
./platform/tooling/ci-local-act.sh -w admin
./platform/tooling/ci-local-act.sh -w landing
./platform/tooling/ci-local-act.sh -w storybook
./platform/tooling/ci-local-act.sh -j lint
./platform/tooling/ci-local-act.sh -l
```

The wrapper runs the five [app/shared callers](ci-github.md#checks-and-workflows), each using the
same composite setup actions as GitHub. `.actrc` uses native ARM64 containers on Apple Silicon
and bind-mount mode (`-b`) so act can see the composite actions. Use it only with trusted local
code. Inspect `.act-output.log` and `.act-artifacts/` for results; each simulation replaces its
previous output.

### Offline CI mode act

First run `bun run ci:act` online to populate the required images, Actions and tools. The wrapper
persists these tool caches:

| Docker volume | Container path | Cached bytes |
|---|---|---|
| `act-bun-cache` | `/root/.bun` | Bun binary and package cache |
| `act-playwright-cache` | `/root/.cache/ms-playwright` | Playwright browser binaries |
| `act-toolcache` | `/opt/act-toolcache` | Node installations |

`bun run ci:act:offline` adds `--pull=false` and `--action-offline-mode`, avoiding image pulls
and Action fetches. It does not disable every network request made by workflow steps. Populate
changed tool/dependency versions online before relying on cached execution; tests that require
external services still require those services.

If tools are missing, run online again. The setup action skips GitHub's `actions/cache` in act;
Docker volumes provide persistence. To reset those caches, stop the act runs, inspect the named
volumes, then remove only them:

```sh
docker volume rm act-bun-cache act-playwright-cache act-toolcache
```

## Test in the prepared worker environment

When you need to verify the exact image and runtime policy used by your local GitHub workers,
use `starter-workers check --install` or `starter-workers check --ci` after
[worker setup](ci-workers.md#test-a-branch-before-enabling-normal-ci). These checks use committed
source without mounting the checkout. They therefore omit uncommitted changes, unlike native
pre-push CI. `check --github` separately exercises actual GitHub scheduling and certifies parity.
The [worker guide](ci-workers.md#test-a-branch-before-enabling-normal-ci) owns those commands,
their baseline-fetch contract and their operating requirements.
