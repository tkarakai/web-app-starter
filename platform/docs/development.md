# Development Workflow

The default dev launcher, local CI and deployment workflows require `apps/landing`. `bun run dev:landing` starts it on its own, through the managed launcher, logs and stop/status commands. The landing app remains a static export; its browser-side onboarding, waitlist and announcements use Convex. `dev:landing` starts Convex and supplies its public HTTP URL. See [onboarding ownership](authentication-and-onboarding.md#onboarding-ownership-and-landing-handoff) for the marketing-to-web flow.

> Detailed guide. See [platform/AGENTS.md](../AGENTS.md) for the quick reference.

## Starting Development

```bash
# Start core apps + Convex (recommended)
bun run dev                  # Starts installed core apps; skips apps removed during adoption

# Start a specific app + Convex (ports: runtime.ports in app.config.ts)
bun run dev:web              # Convex + web app
bun run dev:admin            # Convex + admin app
bun run dev:landing          # Landing + Convex
bun run dev:storybook        # Component storybook only (no Convex)

# Check service status
bun run dev:status           # Shows running processes

# Stop all services
bun run dev:stop
```

> **Note**: Do NOT use `turbo dev` directly. The custom `dev-start.sh` script handles Convex setup, port management, and environment configuration.

Whenever web, admin or landing starts Convex, the launcher also sets the
backend's `LANDING_URL` to the landing's actual URL, or its configured local
origin if it is not started. The backend needs this for CORS and announcement links
from the browser even though landing is statically hosted. Starting landing alone also starts Convex.

### App configuration (`app.config.ts`)

The root `app.config.ts` holds every value an app built on the starter is expected to change:

| Group | Values | Read by |
|-------|--------|---------|
| `identity` | product name, legal entity, support email | page titles and headers, landing footer, TOTP issuer, email footer, the `{productName}` message argument |
| `runtime` | local port per app, Better Auth cookie prefix | dev scripts, each app's `dev` script, Playwright configs, CI, `@web-app-starter/auth`, both proxies, both `clear-session` routes, Convex `auth.ts` and `sessions.ts` |
| `brand` | icon sources, design-token overrides, email palette, `lang` and footer | `copy-shared-assets.sh`, `BrandTokenStyle` (given the app's id, for per-app token overrides) in each root layout, Convex email templates |
| `features` | `waitlist`, `invitations`, `announcements`, `environmentBanner` | admin feature controls and navigation, announcement banners, environment banner |
| `i18n` | `locales` | the locales every app routes, lists and loads app messages for (`@web-app-starter/i18n` `locales`); `bun run check:i18n` |

It is validated when loaded (`platform/packages/app-config/src/schema.ts`); an invalid or unknown value
stops dev, build and tests with a message naming each bad setting. Everything in it is public:
it is checked in and bundled into client code. Per-deployment values (deployed URLs, Convex URLs)
and secrets stay environment variables.

How each consumer reads it:

- **TypeScript** (Next.js server, edge and client code, Convex functions, Playwright configs,
  tests): `import { appConfig, localAppOrigin } from "@web-app-starter/app-config"`. Cookie names come from
  `@web-app-starter/auth/cookies` (`sessionCookieNames()`, `isSessionCookie()`), never from string literals.
- **Shell scripts**: `eval "$(./platform/tooling/node-ts.sh platform/tooling/app-config.ts shell)"` defines
  `APP_CONFIG_PORT_<APP>`, `APP_CONFIG_ORIGIN_<APP>`, `APP_CONFIG_DIR_<APP>` (the app's directory,
  e.g. `platform/apps/admin`), `APP_CONFIG_AUTH_COOKIE_PREFIX` and friends.
  `platform/tooling/app-config.ts port web` (or `dir admin`) prints one value. Apps' `dev` scripts go through
  `platform/tooling/next-dev.sh <app>`.
- **GitHub Actions**: the `setup-bun` action exports the same `APP_CONFIG_*` variables to
  `$GITHUB_ENV`, so later steps use e.g. `APP_ORIGIN: ${{ env.APP_CONFIG_ORIGIN_WEB }}`.
- **Turborepo**: `app.config.ts` is a `globalDependencies` entry, so changing it invalidates
  every cached build and test.

Changing the cookie prefix signs every existing user out. `apps/demo` is not configured here: it
stands in for a separate business app and owns its own settings.

### Development process isolation

See [Development process isolation](../README.md#development-process-isolation)
for launcher requirements, process ownership checks and safe stop commands.

### Dev Seed Accounts

On first startup, `dev-start.sh` automatically creates two test accounts via `packages/backend/convex/platform/devSeed.ts`:

| Email | Password | Role |
|-------|----------|------|
| `admin@admin.com` | `admin!admin.comadmin@admin.comadmin#admin.com` | admin |
| `user@user.com` | email pasted x 3 | user |

The seed and disposable E2E fixtures require local app and backend origins, an explicit local
runtime marker and a random 256-bit harness secret. `bun run dev` verifies the anonymous
backend against its local state and provisions these settings automatically. It refuses inherited
cloud deployment keys, self-hosted overrides or a non-anonymous deployment selection. Use a
separate terminal and checkout for hosted administration.

The launcher writes the capability to the gitignored, owner-readable `.env.e2e.local` at the
repository root. Playwright's Node helpers read it and send `X-Dev-Fixture-Secret` directly to
the local Convex HTTP router; browsers do not receive it. Do not copy it into `NEXT_PUBLIC_*`,
CI artifacts or hosted configuration. Missing or incorrect authorization returns 404 before
creating an invitation or account. Addresses remain restricted to `e2e-<token>@e2e.local`;
existing fixture addresses are rejected rather than reused or assigned a different role.

The seed is idempotent. Restart `bun run dev` after resetting the database, or after upgrading
a running dev backend to provision its new fixture authorization. Delete `.env.e2e.local` and
restart to rotate the capability; the previous capability then stops working. Neither local app
origins nor canonical Convex URLs alone establish local runtime identity. Hosted deployment
preflight rejects all fixture settings, even a disabled seed flag; see the
[deployment runbook](deployment-runbook.md#local-fixtures-and-hosted-deployments).

## Testing Commands (Detailed)

> **CRITICAL**: Always use `bun run test` (with `run`), never bare `bun test`.
> Bare `bun test` picks up ALL test files and fails because some require Vitest's DOM environment.

All test commands run via Turborepo from the project root:

```bash
# Bun Tests (fast, for utility functions)
bun run test                 # Run all Bun unit tests across workspaces

# Vitest Tests (React components with DOM)
bun run test:unit            # Run Vitest once (apps/web)
bun run test:watch           # Watch mode for development (run from apps/web)

# Convex Tests (backend functions)
bun run test:convex          # Run Convex backend tests (packages/backend)
```

For browser tests and full validation, follow [reliable E2E execution](testing.md#running-playwright-e2e-reliably).

To run tests for a specific workspace directly:

```bash
# From apps/web/
cd apps/web
bun run test                 # Bun unit tests for web app
bun run test:unit            # Vitest component tests

# From packages/backend/
cd packages/backend
bun run test:convex          # Convex backend tests
```

## Build and Lint

```bash
bun run build                # Production build (all apps via Turborepo)
bun run lint                 # ESLint (all packages via Turborepo)
bun run typecheck            # TypeScript check (all packages via Turborepo)
```

## Debugging

### Common Issues

**Tests not finding modules:**
```bash
# Check path aliases match tsconfig.json
bun run typecheck
```

**Vitest configuration errors:**
```bash
# Run from the specific app directory
cd apps/web && bunx vitest --version
cd apps/web && bunx vitest run --reporter=verbose
```

**Playwright browser not installed:** Follow the [E2E setup instructions](../README.md#tests).

**Convex sync issues:**
```bash
# Restart the dev environment
bun run dev:stop && bun run dev:web
```

**convex-test module discovery fails in monorepo:**
```bash
# Ensure you pass the glob as second arg to convexTest()
# convexTest(schema, import.meta.glob("./**/*.*s"))
```

## Environment banner

With `features.environmentBanner` enabled, `EnvironmentBannerWrapper` displays development
and staging build metadata, including `starter vX.Y.Z` from `platform/VERSION`. Production
remains hidden. The version describes the built artifact and stays the same when promoted.

The supplied Next.js configurations populate `NEXT_PUBLIC_PLATFORM_VERSION` automatically;
do not set it in deployment environments. For a custom app, import `getPlatformVersion` from
`@web-app-starter/design-system/build-utils` and add
`NEXT_PUBLIC_PLATFORM_VERSION: getPlatformVersion(monorepoRoot)` to the Next.js `env` config,
where `monorepoRoot` is the absolute repository root. Keep `platform/VERSION` in the root
`turbo.json` `globalDependencies` so a version change invalidates cached builds. Restart dev
after a platform upgrade. Direct `EnvironmentBanner` users can pass `platformVersion`.
