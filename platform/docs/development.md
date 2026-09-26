# Development Workflow

> Detailed guide. See [platform/AGENTS.md](../AGENTS.md) for the quick reference.

## Starting Development

```bash
# Start core apps + Convex (recommended)
bun run dev                  # Uses platform/tooling/dev-start.sh

# Start a specific app + Convex (ports: runtime.ports in app.config.ts)
bun run dev:web              # Convex + web app
bun run dev:admin            # Convex + admin app
bun run dev:landing          # Landing only (no Convex needed)
bun run dev:landing-static   # Static landing page (no Convex)
bun run dev:storybook        # Component storybook only (no Convex)

# Check service status
bun run dev:status           # Shows running processes

# Stop all services
bun run dev:stop
```

> **Note**: Do NOT use `turbo dev` directly. The custom `dev-start.sh` script handles Convex setup, port management, and environment configuration.

### App configuration (`app.config.ts`)

The root `app.config.ts` holds every value an app built on the starter is expected to change:

| Group | Values | Read by |
|-------|--------|---------|
| `identity` | product name, legal entity, support email | page titles and headers, landing footer, TOTP issuer, email footer, the `{productName}` message argument |
| `runtime` | local port per app, Better Auth cookie prefix | dev scripts, each app's `dev` script, Playwright configs, CI, `@web-app-starter/auth`, both proxies, both `clear-session` routes, Convex `auth.ts` and `sessions.ts` |
| `brand` | icon sources, design-token overrides, email palette, `lang` and footer | `copy-shared-assets.sh`, `BrandTokenStyle` in each root layout, Convex email templates |
| `features` | `waitlist`, `invitations`, `announcements`, `environmentBanner` | admin feature controls and navigation, announcement banners, environment banner |

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
| `admin@admin.com` | email pasted x 3 | admin |
| `user@user.com` | email pasted x 3 | user |

The seed is gated behind the `DEV_SEED_ENABLED` Convex env var (set automatically by `dev-start.sh`), refuses to run unless every `SITE_URL` origin is loopback HTTP (`packages/backend/convex/platform/developmentOnly.ts`), and is idempotent — it skips if the accounts already exist. To re-seed after a database reset, just restart `bun run dev`.

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

# Playwright E2E Tests
bun run test:e2e             # Run all E2E tests

# Run everything
bun run test:all             # Bun + Vitest + Convex + Playwright
```

To run tests for a specific workspace directly:

```bash
# From apps/web/
cd apps/web
bun run test                 # Bun unit tests for web app
bun run test:unit            # Vitest component tests
bun run test:e2e             # Playwright E2E

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
