# web-app-starter

[![CI Shared](https://github.com/tkarakai/web-app-starter/actions/workflows/ci-shared.yml/badge.svg)](https://github.com/tkarakai/web-app-starter/actions/workflows/ci-shared.yml)

A production-shaped monorepo starter that wires Bun, Turborepo, Tailwind, shadcn/ui, Convex, and Better Auth into a ready-to-extend starter. It includes six Next.js apps, shared packages for UI, auth, backend, i18n, and rate limiting, and a comprehensive testing and CI setup.

## What this starter gives you

- **Monorepo** powered by Bun workspaces + Turborepo for orchestration.
- **Five Next.js apps**: web, admin, landing, storybook and demo.
- **One configuration file**, `app.config.ts`, for the values an app changes: product name, ports, auth cookie prefix, brand and optional features. See [App configuration](docs/development.md#app-configuration-appconfigts).
- **Shared packages** for UI, auth, backend, i18n, rate limiting and starter sidebar policy; see [Shared packages](#shared-packages).
- Convex for database, file storage, and API functions (queries/mutations/actions).
- Better Auth wired to Convex, including Next.js route handlers and client hooks.
- Tailwind v4 + shadcn/ui styling with a bold, modern interface.
- Sample launch dashboard with realtime updates and file uploads.
- Multi-tier testing: Bun unit tests, Vitest component tests, Convex backend tests, Playwright E2E.
- Internationalization (15 languages including RTL) via `@web-app-starter/i18n` and `next-intl`.
- Local CI checks that mirror GitHub Actions, with offline Docker mode via `act`.

## Stack

- [Next.js](https://nextjs.org/docs)
- [React](https://react.dev)
- TypeScript
- Bun
- [Turborepo](https://turbo.build/repo/docs)
- [Tailwind CSS](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [shadcn/ui](https://ui.shadcn.com/docs/installation/next) components (in `@web-app-starter/design-system`)
- [Convex](https://docs.convex.dev/home)
- [Better Auth](https://better-auth.com/docs/integrations/next) ([Convex integration](https://better-auth.com/docs/integrations/convex))

Versions are defined in the root and workspace `package.json` files and resolved
in `bun.lock`; root overrides take precedence over workspace version ranges.

## Quick start

Install the Node and Bun versions specified by `engines` and `packageManager` in
[package.json](../package.json) before running these commands.

1. Install dependencies:

```bash
bun install
```

   On a fresh clone that is to become your app, run `bun run adopt` once (see
   [Adopting the starter](#adopting-the-starter)).

2. Start the development environment:

```bash
bun run dev
```

This starts Convex and the core apps (web, admin, landing, storybook) in local anonymous mode. On first run, it creates a `.env.local` file with a deployment name derived from your directory path and seeds two test accounts:

| Account | Email | Password | Role |
|---------|-------|----------|------|
| Admin | `admin@admin.com` | `admin!admin.comadmin@admin.comadmin#admin.com` | admin |
| User | `user@user.com` | email pasted x 3 | user |

These are created automatically via `devSeed` and persist across restarts. Subsequent runs skip seeding.

To start only a specific app:

```bash
bun run dev:web              # Convex + web app
bun run dev:admin            # Convex + admin app
bun run dev:landing          # Landing + Convex
bun run dev:storybook        # Component storybook (no Convex)
```

3. Open the apps on the ports set in `app.config.ts` (`runtime.ports`). The defaults:
   - Web app: `http://localhost:3001`
   - Admin dashboard: `http://localhost:3002`
   - Landing page: `http://localhost:3000`
   - Storybook: `http://localhost:3003`

   The **Convex UI** URL is printed by `bun run dev` and `bun run dev:status` when
   the local dashboard is running. It defaults to `http://127.0.0.1:6790/`, but
   Convex chooses another available port if that one is occupied (for example,
   by another worktree). Use the printed URL for this deployment.

   In anonymous local development, Convex starts the dashboard and supplies its
   deployment credentials automatically. No Convex account, app admin login, or
   separate dashboard setup is needed. Keep `bun run dev` running while using it.
   To open it directly, run `cd packages/backend && bunx convex dashboard`;
   add `--no-open` to print the URL without opening a browser.

4. When you're done, stop everything:

```bash
bun run dev:stop
```

5. Check status of running services:

```bash
bun run dev:status
```

6. If processes have accumulated across multiple worktrees (causing `EMFILE: too many open files` errors or high memory usage), kill everything:

```bash
bun run dev:nuke-all
```

This lists verified development services across this repository’s worktrees and asks for confirmation before stopping them. It leaves unrelated servers and all saved databases alone.

### Development process isolation

The launcher requires Node.js 22.6 or newer (it runs `platform/tooling/dev-processes.ts` through `platform/tooling/node-ts.sh`) and the usual `ps`, `pgrep`, and `lsof` utilities. Each checkout records its own service PIDs and process start identities in ignored `.dev-pids` and `.dev-processes.json` files. Start, restart, and stop verify the identity and working directory before signalling a process or its descendants. Unrelated Convex servers, other clones, and unregistered processes are left alone; there is no machine-wide orphan cleanup.

- `bun run dev:stop` stops verified services in this checkout.
- `bun run dev:stop:convex` stops only this checkout's verified Convex process tree.
- `bun run dev:nuke-all` explicitly stops verified services across this Git repository's worktrees, with confirmation (`--yes` for non-interactive use). It preserves databases, dependencies and build caches.
- Existing servers started before this change have no identity record. Stop them from their original terminals once, then restart with the updated launcher. Unknown or stale PIDs are never adopted automatically.
- Legacy PID cleanup uses one open file descriptor and rejects symlinks, hardlinks and non-files. Stopping all services leaves `.dev-pids` empty rather than deleting a path that another process may have replaced.

Keep separate deployments and API/HTTP ports for separate applications. A different deployment's process name does not indicate a conflict. Run the isolation regression tests with `bun run test:dev-scripts`; they use disposable processes and temporary checkouts.

### Branch and worktree isolation

Each git branch or worktree gets its own independent Convex deployment automatically. The deployment name is derived from the working directory path, so:

- **Main repo on `main` branch**: `web-app-starter` deployment
- **Worktree for `feature-x`**: `web-app-starter-feature-x` deployment
- **Separate clone in different folder**: Different deployment based on that path

Each deployment has its own:
- Database with separate tables and data
- File storage
- Environment variables (set via `bunx convex env set`)

This means you can switch branches or work in multiple worktrees simultaneously without data conflicts.

### Offline development

The local Convex backend runs entirely on your machine—no internet connection required. Data persists in `~/.convex/anonymous-convex-backend-state/<deployment-name>/` between sessions.

### Better Auth auto-configuration

On the first run for a new deployment, the startup script automatically:
- Generates a `BETTER_AUTH_SECRET` and sets it in Convex
- Configures `SITE_URL` to match your Next.js URL

These values persist in the local Convex backend between sessions.

## Project structure

Anything under `platform/` is the platform zone: owned by the starter and replaced as a whole
when you take a newer release. Everything else is yours.

```
├── README.md  LICENSE         # Short entry point; evaluation licence until adoption
├── AGENTS.md  CLAUDE.md       # App guide for coding agents (layer 1)
├── app.config.ts              # App-owned configuration: name, ports, cookie prefix, brand, features
├── package.json  turbo.json  tsconfig.json  eslint.config.mjs  # Thin; extend platform/config/
├── apps/                      # Reference apps (app zone)
│   ├── web/                   # Main web app (@repo/web)
│   │   ├── src/
│   │   │   ├── app/           # Next.js App Router pages
│   │   │   ├── components/    # React components (auth, launchpad, ui)
│   │   │   └── lib/           # Utility functions and helpers
│   │   └── qa/
│   │       ├── tests/         # Unit + component tests, helpers, fixtures
│   │       └── e2e/           # Playwright E2E specs
│   ├── landing/               # Landing page, static export (@repo/landing)
│   └── demo/                  # Standalone UI/dispatch demo; also tests starter upgrades
├── packages/
│   └── backend/               # Convex backend (@repo/backend)
│       └── convex/            # Schema, queries, mutations, actions; _generated/ is generated
├── platform/                  # Platform zone
│   ├── AGENTS.md              # Platform rules for coding agents (layer 2)
│   ├── README.md              # This file
│   ├── CHANGELOG.md  UPGRADING.md  VERSIONING.md  VERSION
│   ├── LICENSE  COMMERCIAL-LICENSE.md
│   ├── apps/
│   │   ├── admin/             # Admin dashboard (@repo/admin)
│   │   └── storybook/         # Component showcase (@repo/storybook)
│   ├── packages/              # @web-app-starter/* packages
│   │   ├── app-config/        # Schema and loader for app.config.ts
│   │   ├── auth/              # Better Auth client, server, provider, cookies, clear-session
│   │   ├── design-system/     # Radix UI + shadcn/ui components, tokens, brand assets
│   │   ├── design-patterns/   # Composite UI patterns
│   │   ├── i18n/              # Locale config, navigation, messages (15 languages)
│   │   ├── edge-rate-limit/   # Edge rate limiting for proxies
│   │   ├── ops/  paper-roll/  # Operations CLI and its terminal UI
│   │   └── starter-sidebar-policy/ # Versioned sidebar sizing policy
│   ├── agent-skills/          # Platform skills (linked from .claude/skills and .agents/skills)
│   ├── config/                # tsconfig and ESLint bases
│   ├── docs/                  # Platform usage docs
│   ├── templates/             # Starting points for app-owned files (README, LICENSE, AGENTS.md, ...)
│   └── tooling/               # Dev scripts, local CI, E2E setup, codemods, upgrade tooling
├── infra/aws/                 # Optional AWS hosting
└── .github/
    ├── actions/               # Composite actions (build, deploy, setup)
    └── workflows/             # platform-*.yml (reusable, platform-owned); ci-*, cd-*, security.yml callers (yours; see docs/ci.md)
```

## Shared packages

### `@web-app-starter/app-config` — App configuration

The validated contents of the root `app.config.ts`, for every TypeScript consumer:

```typescript
import { appConfig, localAppOrigin } from "@web-app-starter/app-config";
```

### `@web-app-starter/design-system` — UI Component Library

Shared Radix UI + shadcn/ui components used by all apps. Import components:

```typescript
import { Button, Input, Avatar } from "@web-app-starter/design-system";
```

### `@web-app-starter/auth` — Authentication

Better Auth + Convex integration, exported as client/server/provider:

```typescript
import { authClient } from "@web-app-starter/auth/client";
import { auth } from "@web-app-starter/auth/server";
import { AuthProvider } from "@web-app-starter/auth/provider";
```

### `@repo/backend` — Convex Backend

Convex schema, queries, mutations, and actions. Import the API:

```typescript
import { api } from "@repo/backend";
```

### `@web-app-starter/i18n` — Internationalization

15-language support (including RTL) via `next-intl`. Provides locale configuration, translation messages, and i18n utilities. See `platform/docs/i18n-architecture.md` for the full architecture.

### `@web-app-starter/edge-rate-limit` — Edge Rate Limiting

Shared edge rate limiter used by web, admin, and landing app proxies. Provides per-IP rate limiting at the edge layer.

### `@web-app-starter/design-patterns` — Design Patterns

Shared design patterns and utilities.

### `@web-app-starter/starter-sidebar-policy` — Sidebar Sizing

Shared sizing policy used by the design system and the standalone demo. See the
[package guide](packages/starter-sidebar-policy/README.md) for consumption and
release instructions, and [the demo guide](../apps/demo/README.md) to run the app.

## Run against cloud Convex + Better Auth

1. Create a Convex project in the Convex dashboard and grab the deployment URLs:
   - `https://<deployment>.convex.cloud` (API)
   - `https://<deployment>.convex.site` (site proxy)
2. Set your local `.env.local` to the cloud values:

```env
# apps/web and platform/apps/admin — read unprefixed at request time, so one build can be
# promoted between environments. Neither needs a site-URL variable: both derive
# their origin from the request Host header.
CONVEX_DEPLOYMENT=dev:<your-deployment>
CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_SITE_URL=https://<deployment>.convex.site

# apps/landing is a static export, so it must inline its configuration
# at build time and keep the NEXT_PUBLIC_ prefix.
NEXT_PUBLIC_SITE_URL=https://your-app-domain.com
NEXT_PUBLIC_WEB_APP_URL=https://your-web-app-domain.com
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
# Landing reads onboarding and announcements in the browser and hosts the waitlist.
```

3. Configure Convex env vars for that deployment:

```bash
bunx convex env set BETTER_AUTH_SECRET $(openssl rand -base64 32)
bunx convex env set SITE_URL https://your-app-domain.com
# Optional for passkeys across sibling subdomains (hostname only):
# bunx convex env set PASSKEY_RP_ID your-shared-parent-domain.com
```

Important: Better Auth validates request origins. If you are running the app locally
but pointing to a cloud Convex deployment, add localhost to trusted origins:

```bash
bunx convex env set BETTER_AUTH_TRUSTED_ORIGINS "http://localhost:3001,https://your-app-domain.com"
```

4. Run `bunx convex dev` and select the cloud deployment when prompted (or use the deployment configured in `CONVEX_DEPLOYMENT`).
5. Start the Next.js app: `bun run dev:web` or deploy to your hosting provider.

Notes:
- Better Auth data lives inside the same Convex deployment, so there is no separate auth database to provision.
- The `SITE_URL` Convex env var must match your app URL for auth redirects to work.
- Passkeys use a single RP ID. If web/admin are on different hostnames and both must use passkeys, set `PASSKEY_RP_ID` to a shared parent domain (for example `staging.example.com` for `web.staging.example.com` + `admin.staging.example.com`).

## Adopting the starter

`bun run adopt` (`tooling/adopt.ts`) turns a fresh clone into your app, once. It asks for what it
needs, or takes flags (`--name`, `--repo owner/name`, `--support-email`, `--cookie-prefix`,
`--port app=N`, `--remove demo`, `--remove-sample`, `--pr-e2e always|on-demand|off`, `--yes`).
Install and authenticate the GitHub CLI (`gh auth login`). Start from a clean checkout; adoption refuses to overwrite uncommitted work:

Adoption requires a **published stable release** from `tkarakai/web-app-starter`.
By default, the checkout must be at that release commit, with no intervening app commits or
merge commits; for an existing-repository merge, use [the procedure below](#existing-repositories).
For example, clone with
`git clone --branch v2.0.0 https://github.com/tkarakai/web-app-starter.git my-app`, then
`cd my-app` and `git switch -c main`. Select an actually published version. Adoption verifies the published GitHub release and its remote tag before changing files; a version string on `main` alone is not a released baseline. Existing apps adopted from unpublished source need the
[one-time source migration](UPGRADING.md#apps-adopted-before-the-first-published-release).

1. Sets the product name, support email, auth cookie prefix and ports in `app.config.ts`.
2. Replaces the root `README.md`, `LICENSE`, `AGENTS.md` and `CLAUDE.md` with `templates/`, and
   points `renovate.json` at your repository (`local>owner/name//platform/config/renovate-preset`),
   and installs the app-owned `update-platform.yml` weekday caller.
3. Optionally removes the `demo` reference app and its wiring. `landing` is required: the dev launcher, CI and deployments use it.
   `--remove-sample` removes project, task and upload tables, functions, screens and strings,
   leaving a dashboard shell with account settings, announcements and sign-out.
4. Links the platform skills into `.claude/skills/` and `.agents/skills/`.
5. Writes `.platform-base.json` (platform version and commit) and, if absent, adds a main-only, no-tags `upstream` remote (omit with `--no-upstream`). Existing remotes are unchanged; see [existing repositories](#existing-repositories) to narrow their fetches. It also sets `gh` to your app repository when its remote is configured, or prints the command to run afterward.
6. Runs the zone check and a build, and prints what is yours and what is the platform's.
7. On a private repository, where GitHub Actions minutes are billed, asks when CI should run E2E
   on pull requests (`--pr-e2e`) and sets the repository variable `PLATFORM_CI_PR_E2E`, which
   applies to everyone's CI runs in the repository. Without an answer it prints the command for
   later. See [E2E on pull requests](docs/ci.md#e2e-on-pull-requests).

CI and local CI skip removed apps and the demo rehearsal with a notice. Staging, production
and rollback inspect the selected commit, so removing landing does not require a landing
Vercel project or block the remaining apps. `bun run dev` regenerates the Convex API after
sample removal; adoption itself needs no live backend. Configure the updater GitHub App for
automatic CI on update PRs; see [update delivery](docs/update-delivery.md).

### Deployment setup

Run `bun run deploy:setup --check` early to identify account, DNS and credential prerequisites. `bun run deploy:setup` configures Vercel, Convex and GitHub in a resumable terminal wizard; see [the setup guide](docs/deploy-setup.md). An unconfigured app skips automatic staging deployment with a clear notice. Once configured, pushes to the app’s CD branch deploy staging.

### Existing repositories

Do this on an adoption branch, with a clean checkout and a backup of the existing app. This is initial adoption, not the procedure for an already adopted app or an old starter fork.

1. Before moving files, inspect [installed GitHub Apps](https://github.com/settings/installations), the repository’s Settings → Webhooks, and each hosting dashboard. Pause or repoint builds tied to the old repository root. GitHub cannot list every external host for you.
2. Move the old site into a subfolder, commit it, and resolve root-file collisions deliberately. Preserve existing licence obligations and app documentation before adoption replaces the root templates.
3. Select a published starter release, fetch only its tag, then merge its source. For example:

   `git fetch --no-tags https://github.com/tkarakai/web-app-starter.git tag vX.Y.Z`

   `git merge --allow-unrelated-histories vX.Y.Z`

4. Commit conflict resolutions, keeping the release’s platform zone intact. Install its Node/Bun versions and dependencies, then run `bun run adopt --from-release vX.Y.Z --repo owner/app`. This verifies publication and platform bytes and records the **release commit**, not your merge commit. Replace vX.Y.Z with a published release containing this option; for v2.0.0 itself follow the [one-time source migration](UPGRADING.md#apps-adopted-before-the-first-published-release).
5. Review and commit the adoption. Run `bun run platform:upgrade --to vX.Y.Z --dry-run` for the adopted version; expect `unchanged`. This checks baseline acceptance, not application correctness; run normal CI too.

Use `gh ... --repo owner/app` for repository operations, or `gh repo set-default owner/app` after configuring the app remote. For an existing unrestricted starter remote, narrow future fetches with `git config remote.upstream.fetch '+refs/heads/main:refs/remotes/upstream/main'` and `git config remote.upstream.tagOpt --no-tags`. Existing local refs are left alone. Fetch individual release tags explicitly; do not use `git fetch upstream --tags`.

## Sample functionality

- Projects and their tasks are stored in Convex and stream into the dashboard in realtime.
- File uploads use Convex storage and show uploaded assets immediately.
- Better Auth sessions are used in both the client UI and server-side checks.

## Tests

Run tests via Turborepo (from the project root), with a separate E2E setup command:

```bash
bun run test            # Bun unit tests (across all workspaces)
bun run test:unit       # Vitest component tests
bun run test:convex     # Convex backend tests
bun run setup:e2e       # Download Chromium before first E2E run / after Playwright upgrades
CI=true bun run test:e2e # Playwright E2E; one web worker avoids edge-rate-limit failures
CI=true bun run test:all --concurrency=1 # All test suites above, serially (setup:e2e first)
```

Use `CI=true` for full E2E runs: local parallel web workers share one IP and can exceed
its 200-requests-per-minute edge limit, causing HTTP 429 and cascading test timeouts.
Rate limiting remains enabled; see [reliable E2E execution](docs/testing.md#running-playwright-e2e-reliably).

Development startup does not install browsers. After `bun install`, run
`bun run setup:e2e` before the first E2E run (including local CI with E2E), and
again after Playwright upgrades. It downloads Chromium using each installed app
workspace's Playwright CLI, including a hoisted root install, without fetching a
different Playwright version. Installer output and failure status are preserved;
setup stops at the first failure. Avoid package runners that could fetch a newer
CLI: its browser build may not match the installed version. GitHub Actions uses
the dedicated [setup-playwright action](../.github/actions/setup-playwright/action.yml).

> **WARNING**: Always use `bun run test` (with `run`), never bare `bun test`. Bare `bun test` picks up all test files and fails because some require Vitest's DOM environment.

Run the full CI check before pushing:

```bash
CI=true bun run ci      # Full CI: lint, types, tests, build, single-worker web E2E
bun run ci:quick        # Quick local checks; see the CI guide
bun run ci:act          # Run in Docker via act (mirrors GitHub Actions)
bun run ci:act:offline  # Offline mode (fast, no network required)
```

See the [CI guide](docs/ci.md#local-ci-pre-push-checks) for the check inventory and skipped browser checks.

## Conventions

### Coding
- Keep server/client boundaries explicit. Client components include `"use client"`.
- Use Convex for all APIs (queries/mutations/actions). Next.js API routes are only for auth proxying.
- Prefer small, composable components with single responsibilities.
- Import shared packages by name: `@web-app-starter/design-system`, `@web-app-starter/auth/client`, `@repo/backend`.
- UI components live in `@web-app-starter/design-system`. App-specific components live in `apps/<app>/src/components/`.

### Testing
- Bun unit tests for pure functions and utilities (`apps/web/qa/tests/*.test.ts`).
- Vitest for React component tests (`apps/web/qa/tests/*.test.tsx`).
- convex-test for backend functions (`packages/backend/convex/*.test.ts`).
- Playwright for E2E flows (`apps/web/qa/e2e/*.spec.ts`).

### Documentation
- Update README sections when changing core architecture or workflows.
- Document any new environment variables in `.env.example`.
- Keep component-level comments brief and focused on non-obvious behavior.

### DevOps
- Use Convex deployments for environment-specific configuration.
- Keep secrets in Convex env vars, never in committed files.
- CI runs via Turborepo: `turbo lint`, `turbo typecheck`, `turbo build`, etc.
- web, admin and landing deploy to Vercel. `infra/aws` hosts them on AWS instead (Convex stays on
  Convex Cloud), with a local target that runs in Docker: see
  [deployment-architecture-aws.md](docs/aws/deployment-architecture-aws.md).

## Local vs cloud deployments

### Convex data and files

- Local: `bun run dev` runs a local Convex backend in anonymous mode. Data and file storage persist in `~/.convex/anonymous-convex-backend-state/<deployment-name>/`. Each branch or worktree gets its own isolated deployment. The supported way to access local data is through Convex queries/mutations (your app or admin-only functions).
- Cloud: data and files live in Convex-managed cloud storage. Use the Convex dashboard and deployment tooling to inspect or export data.

### Better Auth data

- Local: Better Auth stores users, sessions, and credentials inside the same local Convex deployment via the Better Auth component. There is no separate local auth database.
- Cloud: the same tables live in the Convex cloud deployment for that environment.

### Where user data lives (and how to manage it)

- Better Auth user data is stored inside the Better Auth Convex component, not in your app tables.
- In the Convex dashboard, switch to the component data view for `betterAuth` to inspect users, sessions, and accounts.
- For management, use the authorized endpoint builders in [custom endpoints](docs/authentication-and-onboarding.md#86-enrollment-recovery-and-custom-endpoints) before calling component APIs.

### Environment differences

- Local web/admin env uses `CONVEX_URL` and `CONVEX_SITE_URL` pointing to localhost ports. Ports are dynamically assigned per deployment and automatically updated in `.env.local` by `bun run dev`. Landing inlines `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WEB_APP_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` for browser-side onboarding, waitlist and announcements.
- Cloud env uses `https://<deployment>.convex.cloud` (API) and `https://<deployment>.convex.site` (site proxy).
- `NEXT_PUBLIC_SITE_URL` is the landing's URL. Convex's `SITE_URL` contains the trusted web/admin origins. Web and admin derive their own origin from the request `Host` header.

## Convex workflow primer

Use this mental model to avoid surprises when switching between local and cloud.

### Fully local

- Run: `bun run dev` (or `bun run dev:web` for just the web app)
- Convex starts a local backend in anonymous mode and syncs your local functions/schema into it.
- The app automatically points at the correct local ports (dynamically assigned).
- Changes apply immediately because the local backend is the one you are using.
- Stop with: `bun run dev:stop`

### Hybrid (local app + cloud Convex)

- Your app points to cloud URLs (`https://<deployment>.convex.cloud`).
- Local function/schema changes do nothing until you push them.
- Push options:
  - Run `bunx convex dev` targeting the cloud deployment (live sync).
  - Or run `bunx convex deploy` when you want to push changes.

### Fully cloud

- App and Convex are both deployed.
- Use `bunx convex deploy` (often in CI) for changes.

### Mental model

- `CONVEX_URL` (`NEXT_PUBLIC_CONVEX_URL` in the landing app) = where your app sends requests.
- `bun run dev` (local) / `bunx convex deploy` (cloud) = how local code is pushed to that backend.

## Environment conventions

This repo does not enforce a naming scheme, but the following conventions are clear and common:

- Fully local (app + Convex local): `.env.local` (managed automatically by `bun run dev`)
- Hybrid (app local + Convex cloud): `.env.cloud`
- Fully cloud (app + Convex cloud): `.env.production` (or provider env vars)

### Example: fully local

```env
CONVEX_DEPLOYMENT=anonymous:<deployment-name>
CONVEX_URL=http://127.0.0.1:<cloud-port>
CONVEX_SITE_URL=http://127.0.0.1:<site-port>
```

Note: `bun run dev` automatically manages these values. Ports are dynamically assigned per deployment. These examples are for `apps/web` and `platform/apps/admin`, which read the unprefixed names at request time and need no site-URL variable. `apps/landing` is a static export and uses the `NEXT_PUBLIC_` forms instead.

### Example: hybrid (local app + cloud Convex)

```env
CONVEX_DEPLOYMENT=dev:<deployment>
CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_SITE_URL=https://<deployment>.convex.site
```

### Example: fully cloud

```env
CONVEX_DEPLOYMENT=prod:<deployment>
CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_SITE_URL=https://<deployment>.convex.site
```

### Operations CLI

Start with `bun run ops setup` for guided GitHub/Vercel login and team/project selection; existing `gh` and `vercel` sessions are reused without tokens in ops config. Run `bun run ops` in a terminal for a guided operations console: monitor environments, investigate failures, review and deploy releases, roll back, and explore audit evidence using arrow keys and Enter. Explicit commands such as `ops status`, `ops diagnose RUN`, and `ops verify --run RUN` remain available for scripts; `--watch --until serving` follows a release through workflow success and serving verification. See the [operations CLI guide](docs/ops-cli.md) for setup and the end-to-end walkthrough.
