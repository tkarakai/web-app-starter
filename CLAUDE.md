# Project Conventions for AI Agents

This document provides project-specific guidance for AI agents working on this codebase. It covers commands, testing, code patterns, and best practices.

## Quick Reference

```bash
# Start development (Convex + all apps via dev-start.sh)
bun run dev                  # All apps (landing:3000, web:3001, admin:3002, storybook:3003)
bun run dev:web              # Convex + web app only (port 3001)
bun run dev:admin            # Convex + admin app only (port 3002)
bun run dev:landing          # Landing page only (port 3000, no Convex)
bun run dev:storybook        # Component storybook only (port 3003, no Convex)
bun run dev:stop             # Stop all services
bun run dev:status           # Show running processes

# Run all CI checks locally before pushing (recommended!)
bun run ci                   # Full CI: lint, types, tests, build, e2e
bun run ci:quick             # Skip E2E tests for faster feedback
bun run ci:act               # Run in Docker via act (first run populates caches)
bun run ci:act:offline       # Offline mode (fast, no network required)

# Run tests via Turborepo (ALWAYS use "bun run test", never bare "bun test")
bun run test                 # Bun unit tests (across all workspaces)
bun run test:unit            # Vitest component tests
bun run test:convex          # Convex backend tests
bun run test:e2e             # Playwright E2E tests (requires browser)
bun run test:all             # All of the above

# Type checking and linting (via Turborepo)
bun run lint                 # ESLint (all packages)
bun run typecheck            # TypeScript check (all packages)

# Build for production
bun run build                # Build all apps via Turborepo
```

> **WARNING**: Never use bare `bun test` - it picks up ALL test files including those requiring Vitest's DOM environment. Always use `bun run test` which runs the scoped npm script.

## Project Overview

This is a **monorepo** powered by **Bun workspaces** and **Turborepo**, containing:
- **Four Next.js 16 apps**: landing (port 3000), web (port 3001), admin (port 3002), storybook (port 3003)
- **Three shared packages**: `@repo/design-system`, `@repo/auth`, `@repo/backend`
- **Convex** as the backend (database, file storage, API functions)
- **Better Auth** wired to Convex for authentication
- **React 19** with Server Components (App Router)
- **Radix UI** for accessible UI primitives (in `@repo/design-system`)
- **Tailwind CSS v4** for styling
- **TypeScript** with strict mode enabled

## Directory Structure

```
├── apps/
│   ├── web/                     # Main web app (@repo/web, port 3001)
│   │   ├── src/
│   │   │   ├── app/             # Next.js App Router pages
│   │   │   │   ├── (auth)/      # Authentication routes (grouped)
│   │   │   │   ├── (dashboard)/ # Dashboard routes (grouped)
│   │   │   │   └── api/auth/    # Auth API route handler
│   │   │   ├── components/
│   │   │   │   ├── ui/          # App-specific UI components
│   │   │   │   ├── auth/        # Authentication components
│   │   │   │   └── launchpad/   # Feature-specific components
│   │   │   └── lib/             # Utility functions and helpers
│   │   └── qa/                  # Testing artifacts
│   │       ├── tests/           # Unit + component tests
│   │       │   ├── *.test.ts    # Bun unit tests (utility functions)
│   │       │   ├── *.test.tsx   # Vitest component tests
│   │       │   ├── helpers/     # Test utilities (auth-mock, visual-regression)
│   │       │   └── fixtures/    # Test data
│   │       └── e2e/             # Playwright E2E specs
│   ├── admin/                   # Admin dashboard (@repo/admin, port 3002)
│   │   ├── src/
│   │   └── qa/                  # Testing artifacts (same structure as web)
│   │       ├── tests/           # Unit + component tests
│   │       └── e2e/             # Playwright E2E specs
│   ├── landing/                 # Landing/marketing page (@repo/landing, port 3000)
│   │   ├── src/
│   │   └── qa/                  # Testing artifacts (same structure as web)
│   │       ├── tests/           # Unit + component tests
│   │       └── e2e/             # Playwright E2E specs
│   └── storybook/               # Component storybook (@repo/storybook, port 3003)
│       ├── src/
│       │   ├── app/             # Next.js App Router pages
│       │   ├── components/      # Sidebar, page layout components
│       │   ├── lib/             # Component registry
│       │   └── showcase/        # Per-component demo files
│       └── qa/
│           └── e2e/             # Playwright E2E specs
├── packages/
│   ├── backend/                 # Convex backend (@repo/backend)
│   │   ├── convex/              # Schema, queries, mutations, actions
│   │   │   ├── _generated/      # Auto-generated Convex files (DO NOT EDIT)
│   │   │   ├── schema.ts        # Database schema definition
│   │   │   └── *.ts             # Server functions
│   │   ├── index.ts             # Main export (re-exports convex/_generated/api)
│   │   └── vitest.config.ts     # Backend test configuration
│   ├── auth/                    # Authentication (@repo/auth)
│   │   └── src/
│   │       ├── client.ts        # Client-side auth hooks
│   │       ├── server.ts        # Server-side auth utilities
│   │       └── provider.tsx     # Auth context provider
│   └── design-system/           # Shared UI components (@repo/design-system)
│       ├── src/                 # Radix UI + shadcn/ui components
│       │   └── index.ts         # Component exports
│       ├── tokens/
│       │   └── index.css        # Design tokens / global styles
│       └── tailwind.config.ts   # Shared Tailwind configuration
├── scripts/
│   ├── dev-start.sh             # Start dev environment (Convex + apps)
│   ├── dev-stop.sh              # Stop all services
│   ├── dev-status.sh            # Show running services
│   ├── ci-local.sh              # Native CI checks (bun run ci)
│   ├── ci-local-act.sh          # Docker-based CI via act
│   ├── ensure-local-deps.sh     # Dependency setup
│   └── ensure-branch-tracking.sh # Git utility
├── .github/
│   ├── actions/
│   │   ├── setup-bun/           # Composite action: checkout + Bun + deps
│   │   └── setup-playwright/    # Composite action: Playwright browser setup
│   └── workflows/
│       ├── ci-shared.yml        # Shared CI: lint, typecheck, backend tests
│       ├── ci-web.yml           # Web app CI: test, build, E2E
│       ├── ci-admin.yml         # Admin app CI: test, build, E2E
│       ├── ci-landing.yml       # Landing app CI: test, build, E2E
│       ├── ci-storybook.yml    # Storybook app CI: build, E2E (non-blocking)
│       └── security.yml         # CodeQL, dependency audit, secrets scan
├── turbo.json                   # Turborepo task configuration
└── package.json                 # Root workspace definition (Bun workspaces)
```

## Development Commands

### Starting Development

```bash
# Start all apps + Convex (recommended)
bun run dev                  # Uses scripts/dev-start.sh

# Start a specific app + Convex
bun run dev:web              # Convex + web app (port 3001)
bun run dev:admin            # Convex + admin app (port 3002)
bun run dev:landing          # Landing only (port 3000, no Convex needed)
bun run dev:storybook        # Component storybook only (port 3003, no Convex)

# Check service status
bun run dev:status           # Shows running processes

# Stop all services
bun run dev:stop
```

> **Note**: Do NOT use `turbo dev` directly. The custom `dev-start.sh` script handles Convex setup, port management, and environment configuration.

### Testing Commands

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

### Build and Lint

```bash
bun run build                # Production build (all apps via Turborepo)
bun run lint                 # ESLint (all packages via Turborepo)
bun run typecheck            # TypeScript check (all packages via Turborepo)
```

### Local CI (Pre-Push Checks)

Run the same checks that GitHub Actions CI runs before pushing:

```bash
bun run ci                   # Full CI check (runs everything)
bun run ci:quick             # Skip E2E tests for faster feedback
```

The `bun run ci` command runs these checks in order (all via `turbo`):
1. **TypeScript check** (`turbo typecheck`)
2. **ESLint** (`turbo lint`)
3. **Bun unit tests** (`turbo test`)
4. **Vitest component tests** (`turbo test:unit`)
5. **Convex backend tests** (`turbo test:convex`)
6. **Production build** (`turbo build`)
7. **Bundle size check** (all apps with `.size-limit.json`)
8. **Playwright E2E tests** (`turbo test:e2e`)

Use `bun run ci:quick` to skip E2E tests when you need faster feedback. The script will exit on the first failure with a clear error message.

> **Note**: Lighthouse performance audits are only run in GitHub Actions CI, not locally.

### Running GitHub Actions Locally with `act`

[act](https://github.com/nektos/act) runs GitHub Actions workflows locally in Docker containers:

```bash
# Install act (requires Docker)
brew install act

# Run all CI workflows
bun run ci:act                # Full output + summary
bun run ci:act:quick          # Quiet mode, summary only
bun run ci:act:offline        # Offline mode (after caches are populated)

# Run a specific workflow
./scripts/ci-local-act.sh -w shared    # Just lint + backend tests
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
1. `ci-shared.yml` — Lint, typecheck, backend tests (shared across all packages)
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

### Offline CI Mode (act)

#### Rationale

Running CI tests locally should be fast and not require internet access for every run. When you're iterating on code without changing dependencies, there's no need to re-download tools, packages, or browser binaries. Offline mode enables:

1. **Fast iteration** — Skip network downloads on subsequent runs
2. **Airplane mode development** — Work without internet connectivity
3. **Reduced bandwidth** — Don't re-download the same artifacts repeatedly
4. **Consistent environments** — Use the exact same cached binaries across runs

#### How It Works

The `ci-local-act.sh` script uses **Docker volumes** to persist downloaded artifacts between runs:

| Volume Name | Container Path | Contents |
|-------------|----------------|----------|
| `act-bun-cache` | `/root/.bun` | Bun binary + package cache (node_modules) |
| `act-playwright-cache` | `/root/.cache/ms-playwright` | Chromium browser binaries |
| `act-toolcache` | `/opt/act-toolcache` | Node.js installations |

**First run (online):** Downloads and caches everything to Docker volumes
**Subsequent runs:** Uses cached artifacts from volumes (fast, works offline)

#### Usage

```bash
# First run: populate caches (requires internet)
bun run ci:act

# Subsequent runs: use offline mode (no internet required)
bun run ci:act:offline
```

The offline flag (`-o`) adds:
- `--pull=false` — Don't pull Docker images
- `--action-offline-mode` — Don't fetch GitHub Actions

#### Pattern for Adding New Tools

When introducing a new tool that downloads from the internet, create a **composite action** in `.github/actions/<tool-name>/action.yml`:

```yaml
name: 'Setup ToolName'
runs:
  using: 'composite'
  steps:
    # Standard GitHub Actions (uses official setup action)
    - name: Setup ToolName
      if: ${{ !env.ACT }}
      uses: vendor/setup-toolname@v1
      with:
        version: "1.2.3"

    # act offline mode (checks cache first, downloads if needed)
    - name: Setup ToolName (act)
      if: ${{ env.ACT }}
      shell: bash
      run: |
        TOOL_DIR="/path/to/cache"
        if [ -x "$TOOL_DIR/bin/tool" ]; then
          echo "Tool already installed"
        else
          curl -fsSL https://example.com/install.sh | bash
        fi
        echo "$TOOL_DIR/bin" >> $GITHUB_PATH
```

Then use it in any workflow job:
```yaml
steps:
  - uses: ./.github/actions/setup-toolname
```

**Key principles:**
1. Use composite actions to avoid duplicating setup across workflows
2. Use `if: ${{ !env.ACT }}` for standard GitHub Actions setup steps
3. Use `if: ${{ env.ACT }}` for act-specific cache-aware setup
4. Check if the tool exists before downloading
5. Install to a path that's mounted as a Docker volume
6. Add the tool to `$GITHUB_PATH`

#### Currently Cached Tools

| Tool | Cache Location | Setup Pattern |
|------|----------------|---------------|
| Bun | `/root/.bun/bin/bun` | Custom script checks existence |
| Node.js | `/opt/act-toolcache/node/` | `setup-node` respects `RUNNER_TOOL_CACHE` |
| Playwright | `/root/.cache/ms-playwright/` | Volume persists browser binaries |
| npm packages | `/root/.bun/install/cache/` | Bun's package cache |

#### Troubleshooting

**Cache issues (tar errors):** The `actions/cache` step is skipped in act (`if: ${{ !env.ACT }}`) because multiple parallel jobs sharing the same volume causes race conditions. Docker volumes provide persistence instead.

**Tool not found offline:** Run `bun run ci:act` once online to populate caches.

**Clearing caches:** Remove Docker volumes to start fresh:
```bash
docker volume rm act-bun-cache act-playwright-cache act-toolcache
```

## Testing Patterns

### When to Use Each Test Type

| Test Type | Framework | Use For | Location |
|-----------|-----------|---------|----------|
| Unit | Bun | Pure functions, utilities, helpers | `apps/*/qa/tests/*.test.ts` |
| Component | Vitest | React components, UI interactions | `apps/*/qa/tests/*.test.tsx` |
| E2E | Playwright | Full user flows, navigation, auth | `apps/*/qa/e2e/*.spec.ts` |
| Backend | convex-test | Convex functions (queries, mutations) | `packages/backend/convex/*.test.ts` |

### Bun Test Pattern (Utility Functions)

```typescript
// apps/web/qa/tests/myFunction.test.ts
import { describe, expect, it } from "bun:test";
import { myFunction } from "../../src/lib/myModule";

describe("myFunction", () => {
  it("handles happy path", () => {
    expect(myFunction("input")).toBe("expected");
  });

  it("handles edge cases", () => {
    expect(myFunction("")).toBe("default");
    expect(myFunction(null)).toBe("default");
  });
});
```

### Vitest Component Test Pattern

```typescript
// apps/web/qa/tests/button.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "@repo/design-system";

describe("Button", () => {
  it("renders with text", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button")).toHaveTextContent("Click me");
  });

  it("calls onClick handler", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

### Playwright E2E Test Pattern

```typescript
// apps/web/qa/e2e/homepage.spec.ts
import { expect, test } from "@playwright/test";

test.describe("Homepage", () => {
  test("loads and displays content", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Web App/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("navigates to dashboard", async ({ page }) => {
    await page.goto("/");
    await page.click('a[href="/dashboard"]');
    await expect(page).toHaveURL(/dashboard/);
  });
});
```

### Convex Backend Test Pattern

```typescript
// packages/backend/convex/launchItems.test.ts
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

describe("launchItems", () => {
  test("returns items for authenticated user", async () => {
    // IMPORTANT: In monorepos, pass glob as second arg for module discovery
    const t = convexTest(schema, import.meta.glob("./**/*.*s"));

    // Seed test data
    await t.run(async (ctx) => {
      await ctx.db.insert("launchItems", {
        title: "Test Item",
        description: "Description",
        status: "idea",
        priority: 1,
        ownerId: "test-user",
        createdAt: Date.now(),
      });
    });

    // Query and verify
    const items = await t.run(async (ctx) => {
      return ctx.db.query("launchItems").collect();
    });

    expect(items).toHaveLength(1);
  });
});
```

> **IMPORTANT**: In monorepos with hoisted `node_modules`, `convexTest()` needs the glob as its second argument: `convexTest(schema, import.meta.glob("./**/*.*s"))`. Without it, auto-discovery of Convex modules fails.

## Test Helpers

### Authentication Mocking (`apps/web/qa/tests/helpers/auth-mock.ts`)

```typescript
import { createMockUser, mockUseAuth, createMockAuthContext } from "../qa/tests/helpers/auth-mock";

// Create a mock user
const user = createMockUser({ name: "Test User", email: "test@example.com" });

// Mock the useAuth hook for component testing
const auth = mockUseAuth({ isAuthenticated: true, user });

// Create mock auth context for Convex testing
const authCtx = createMockAuthContext(user);
```

### Test Fixtures (`apps/web/qa/tests/fixtures/data.ts`)

```typescript
import {
  launchItemFixtures,
  createLaunchItem,
  createManyLaunchItems,
  scenarios,
} from "../qa/tests/fixtures/data";

// Use pre-defined fixtures
const items = scenarios.multiUser.launchItems;

// Create a custom fixture
const customItem = createLaunchItem({
  title: "My Custom Item",
  status: "building",
  priority: 2,
});

// Bulk create for pagination testing
const manyItems = createManyLaunchItems(50, "owner-id");
```

### Visual Regression (`apps/web/qa/tests/helpers/visual-regression.ts`)

```typescript
import {
  expectPageSnapshot,
  expectResponsiveSnapshot,
  expectElementSnapshot,
  fullVisualTest,
} from "../qa/tests/helpers/visual-regression";

// Full page screenshot comparison
await expectPageSnapshot(page, "homepage");

// Responsive viewport testing
await expectResponsiveSnapshot(page, "dashboard", "mobile");
await expectResponsiveSnapshot(page, "dashboard", "tablet");
await expectResponsiveSnapshot(page, "dashboard", "desktop");

// Element-specific screenshot
const button = page.getByRole("button", { name: "Submit" });
await expectElementSnapshot(button, "submit-button");

// Full visual test (multiple viewports and themes)
await fullVisualTest(page, "settings-page", {
  viewports: ["mobile", "desktop"],
  themes: ["light", "dark"],
});
```

## Code Style Guidelines

### TypeScript

- **Strict mode** is enabled - no implicit `any` types
- Use **explicit return types** for functions exported from modules
- Prefer **`const`** over `let`, never use `var`
- Use **template literals** for string concatenation

```typescript
// Good
export function formatPrice(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// Bad
export function formatPrice(amount) {
  return "$" + amount.toFixed(2);
}
```

### React Components

- Use **function components** exclusively (no class components)
- Use **Radix UI primitives** from `@repo/design-system` for accessibility
- Shared components go in `packages/design-system/src/`, app-specific in `apps/<app>/src/components/`
- Use package imports for shared code, path aliases for app-internal code

```typescript
// App component: apps/web/src/components/launchpad/item-card.tsx
"use client";

import { Button } from "@repo/design-system";            // Shared UI
import { cn } from "@repo/design-system";                 // Utility from shared package
import { api } from "@repo/backend";           // Convex API
import { useMutation } from "convex/react";

interface ItemCardProps {
  className?: string;
  children: React.ReactNode;
}

export function ItemCard({ className, children }: ItemCardProps) {
  const deleteItem = useMutation(api.launchItems.remove);

  return (
    <div className={cn("base-styles", className)}>
      {children}
    </div>
  );
}
```

### Convex Backend

- **Schema** is defined in `packages/backend/convex/schema.ts`
- Use `v` validator for all fields
- Queries are read-only, mutations modify data
- Always validate inputs and handle errors

```typescript
// packages/backend/convex/myModule.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getItem = query({
  args: { id: v.id("items") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const createItem = mutation({
  args: { title: v.string(), priority: v.number() },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("items", {
      ...args,
      createdAt: Date.now(),
    });
    return id;
  },
});
```

### CSS/Styling

- Use **Tailwind CSS v4** utility classes
- Use `cn()` utility from `@repo/design-system` for conditional classes
- Follow **mobile-first** responsive design
- Use **CSS variables** for theming (`--foreground`, `--background`, etc.)

```typescript
import { cn } from "@repo/design-system";

<div className={cn(
  "flex items-center gap-2 p-4",
  isActive && "bg-primary text-primary-foreground",
  className
)}>
```

## Cross-Package Import Patterns

### Shared Package Imports

| Package | Import | Example |
|---------|--------|---------|
| `@repo/design-system` | Components, utilities | `import { Button, cn } from "@repo/design-system"` |
| `@repo/design-system` | Global styles | `import "@repo/design-system/styles/globals.css"` |
| `@repo/auth` | Client hooks | `import { authClient } from "@repo/auth/client"` |
| `@repo/auth` | Server utilities | `import { auth } from "@repo/auth/server"` |
| `@repo/auth` | Provider component | `import { AuthProvider } from "@repo/auth/provider"` |
| `@repo/backend` | Convex API | `import { api } from "@repo/backend"` |

### App-Internal Path Aliases

Within each app, use `@/` as a path alias for `src/`:

```typescript
// Inside apps/web/
import { formatDate } from "@/lib/format";
import { DashboardLayout } from "@/components/dashboard-layout";
```

> **Note**: `@/` is app-internal only. For cross-package imports, always use `@repo/` package names.

## Common Patterns

### Route Protection (Authentication)

The web app uses a **three-layer** auth system. New protected pages get all three layers automatically by placing them under `src/app/(dashboard)/`.

| Layer | Where | What it does | Speed |
|-------|-------|-------------|-------|
| **Proxy** | `src/proxy.ts` | Cookie-presence check + CSP headers (Edge) | ~1ms |
| **Layout** | `src/app/(dashboard)/layout.tsx` | Full session validation + user preload (RSC) | ~50ms |
| **AuthGuard** | `src/components/auth/auth-guard.tsx` | Client-side session watcher + redirect | Ongoing |

**To add a new protected page:** just create it under `src/app/(dashboard)/`:

```
src/app/(dashboard)/
  layout.tsx          ← auth check (already exists, shared by all pages)
  dashboard/page.tsx  ← existing page
  settings/page.tsx   ← new page — automatically protected!
```

**To access the current user** in any client component under `(dashboard)/`:

```typescript
import { useAuthUser } from "@/components/auth/auth-guard";

export function MyComponent() {
  const user = useAuthUser(); // { name?, email? } | null
  return <span>{user?.name ?? "Anonymous"}</span>;
}
```

**How the layers work together:**

1. **Proxy** (Edge, instant): Checks for the `better-auth.session_token` cookie. No cookie → redirect to `/sign-in`. Also redirects authenticated users away from `/sign-in` and `/sign-up` to `/dashboard`. Sets CSP headers with nonce.
2. **Layout** (Server Component): Calls `isAuthenticated()` for full session validation, then `preloadAuthQuery(api.auth.getCurrentUser)` to SSR the user data. Catches stale-session errors (e.g. signed out in another tab) and redirects.
3. **AuthGuard** (Client Component): Subscribes to the Convex user query for real-time updates and watches the Better Auth session. If the session is invalidated while the page is open, redirects immediately.

**Backend safety:** The `getCurrentUser` Convex query returns `null` (not throws) when unauthenticated, so client-side subscriptions degrade gracefully instead of crashing.

**To add a route to proxy protection:** edit the `PROTECTED_PREFIXES` array in `src/proxy.ts`. Auth-page redirects use the `AUTH_ROUTES` array.

### Guest Pages (Auth Pages)

Auth pages (`/sign-in`, `/sign-up`) are wrapped by `GuestGuard` via `src/app/(auth)/layout.tsx`. When a user logs in on another tab:

1. **BroadcastChannel** (instant): The auth form calls `broadcastAuth()` on success. Other tabs' `GuestGuard` receives the message and redirects to `/dashboard`.
2. **Visibility fallback**: When the tab becomes visible, `GuestGuard` calls `authClient.getSession()` to check for an active session and redirects if found.

**To broadcast auth from a new login flow:** call `broadcastAuth()` from `@/lib/auth-broadcast` after successful authentication.

### Rate Limiting

The application uses three layers of rate limiting. See `RATE-LIMITING.md` for the full architecture document.

| Layer | Scope | Storage | Config |
|-------|-------|---------|--------|
| **Better Auth** | Auth endpoints (sign-in, sign-up) | Convex DB (betterAuth component `rateLimit` table) | `packages/backend/convex/auth.ts` — env vars via `convex env set` |
| **Convex Functions** | All `authedMutation` calls | Convex DB (`rateLimits` table) | `packages/backend/convex/rateLimits.ts` — env vars via `convex env set` |
| **Edge Proxy** | HTTP page requests (web + landing) | In-memory `Map` (per-instance, capped) | `apps/*/src/proxy.ts` — env vars in `.env.local` |

**Key files:**
- `packages/backend/convex/rateLimits.ts` — Convex rate limit definitions
- `packages/backend/convex/functions.ts` — Global mutation rate limit in `authedMutation`
- `apps/web/src/lib/edge-rate-limit.ts` / `apps/landing/src/lib/edge-rate-limit.ts` — Edge rate limiter utility
- `apps/web/src/components/auth/auth-form.tsx` — Client-side 429 error handling

**What happens when rate limited:**
- **Auth endpoints**: HTTP 429, auth form shows "Too many attempts. Please wait a moment before trying again."
- **Convex mutations**: `ConvexError` with `{ kind: "RateLimited" }`, `useQuery` subscriptions unaffected
- **Edge proxy**: HTTP 429 with `Retry-After` header, plain "Too Many Requests" page

**Queries are NOT rate limited** — they are read-only and used by `useQuery` real-time subscriptions.

### Client vs Server Components

```typescript
// Server Component (default) - no directive needed
// Can use: async/await, direct database access, server-only code
export default async function ServerPage() {
  const data = await fetchData();
  return <div>{data}</div>;
}

// Client Component - requires directive
"use client";
// Can use: useState, useEffect, event handlers, browser APIs
export function ClientComponent() {
  const [state, setState] = useState(false);
  return <button onClick={() => setState(true)}>Click</button>;
}
```

### Convex React Hooks

```typescript
"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend";

export function MyComponent() {
  // Queries subscribe to real-time updates
  const items = useQuery(api.launchItems.list);

  // Mutations for creating/updating/deleting
  const createItem = useMutation(api.launchItems.create);

  const handleCreate = async () => {
    await createItem({ title: "New Item" });
  };

  if (items === undefined) return <Loading />;
  return <ItemList items={items} onCreate={handleCreate} />;
}
```

## Important Warnings

### DO NOT

- **Use bare `bun test`** - Always use `bun run test` (with `run`). Bare `bun test` picks up all test files and fails
- **Edit `packages/backend/convex/_generated/`** - These files are auto-generated
- **Use `npm` or `yarn`** - This project uses Bun exclusively
- **Use `turbo dev`** - Use `bun run dev` (which calls `dev-start.sh`) for proper port and Convex management
- **Skip TypeScript types** - Strict mode catches bugs early
- **Test Server Components with Vitest** - Use Playwright E2E instead
- **Commit `.env.local`** - Contains secrets, use `.env.example` as template
- **Use `var`** - Use `const` or `let` instead

### BE CAREFUL

- **Convex functions** run on the server - no browser APIs available
- **Server Components** cannot use React hooks or browser APIs
- **Client Components** must have `"use client"` directive at top
- **Path aliases** (`@/`) are app-internal only; use `@repo/` for cross-package imports
- **Playwright tests** require Chromium browser installed (`npx playwright install chromium`)
- **convex-test in monorepos**: Must pass `import.meta.glob("./**/*.*s")` as second arg to `convexTest()`

## Environment Variables

Required variables (see `.env.example`):

| Variable | Description | Required |
|----------|-------------|----------|
| `CONVEX_DEPLOYMENT` | Convex deployment identifier | Yes |
| `NEXT_PUBLIC_CONVEX_URL` | Convex API URL (dynamically assigned port) | Yes |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex site URL (dynamically assigned port) | Yes |
| `NEXT_PUBLIC_SITE_URL` | App URL (e.g., `http://localhost:3001` for web) | Yes |

> **Note**: `bun run dev` auto-manages `.env.local` with the correct ports. You rarely need to edit these manually for local development.

## TDD Workflow for AI Agents

### Recommended Approach

1. **Understand the requirement** - Read related files and understand context
2. **Write a failing test first** - Define expected behavior
3. **Implement minimal code** - Make the test pass
4. **Refactor** - Improve code while tests still pass
5. **Run all tests** - Ensure no regressions

### Quick Feedback Loop

```bash
# For utility functions (fastest, from apps/web/)
bun run test --watch

# For React components (from apps/web/)
bun run test:watch

# For full integration (from root)
bun run test:all
```

### Example TDD Session

```bash
# 1. Create test file
# apps/web/qa/tests/newFeature.test.ts

# 2. Run in watch mode (from apps/web/)
bun run test:watch

# 3. Write test, see it fail (red)
# 4. Implement code, see it pass (green)
# 5. Refactor with confidence
```

## Subagent Delegation Patterns

### Task Division

| Task Type | Recommended Approach |
|-----------|---------------------|
| **Research** | Read files, grep patterns, understand codebase |
| **Unit Test** | Create test in `apps/<app>/qa/tests/`, implement function, verify with `bun run test` |
| **Component** | Create test in `apps/<app>/qa/tests/`, implement component, verify with Vitest |
| **E2E Flow** | Create spec in `apps/<app>/qa/e2e/`, implement, verify with Playwright |
| **Convex Function** | Define in `packages/backend/convex/schema.ts`, implement handler, test with convex-test |
| **Shared UI** | Add component in `packages/design-system/src/`, export from index.ts |

### Context Boundaries

- Each file should be self-contained with clear imports
- Use `@repo/` for cross-package imports, `@/` for app-internal imports
- Document public APIs with JSDoc comments
- Keep component files under 200 lines

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

**Playwright browser not installed:**
```bash
npx playwright install chromium
```

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

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Component | kebab-case.tsx | `user-avatar.tsx` |
| Page | kebab-case in folder | `apps/web/src/app/sign-up/page.tsx` |
| Utility | camelCase.ts | `formatDate.ts` or `format.ts` |
| Test | same-name.test.ts(x) | `format.test.ts`, `button.test.tsx` |
| E2E Test | descriptive.spec.ts | `auth-flow.spec.ts` |
| Convex | camelCase.ts | `launchItems.ts` |
| Package export | index.ts | `packages/design-system/src/index.ts` |

## Verification Checklist

Before pushing changes, run the local CI check:

```bash
bun run ci          # Full check (recommended before push)
bun run ci:quick    # Faster check (skips E2E)
```

Or verify individually:
- [ ] TypeScript compiles: `bun run typecheck`
- [ ] Linting passes: `bun run lint`
- [ ] Unit tests pass: `bun run test`
- [ ] Component tests pass: `bun run test:unit`
- [ ] Backend tests pass: `bun run test:convex`
- [ ] Build succeeds: `bun run build`
- [ ] E2E tests pass: `bun run test:e2e`

Code quality:
- [ ] No console.log debugging statements
- [ ] Proper error handling in place
- [ ] Types are explicit, not `any`

## Resources

- [Next.js 16 Docs](https://nextjs.org/docs)
- [Convex Docs](https://docs.convex.dev)
- [Radix UI](https://www.radix-ui.com)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Vitest Docs](https://vitest.dev)
- [Playwright Docs](https://playwright.dev)
- [Turborepo Docs](https://turbo.build/repo/docs)
