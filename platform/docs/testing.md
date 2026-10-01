# Testing Guide

> Detailed guide. See [platform/AGENTS.md](../AGENTS.md) for the quick reference.

## When to Use Each Test Type

| Test Type | Framework | Use For | Location |
|-----------|-----------|---------|----------|
| Unit | Bun | Pure functions, utilities, helpers | `apps/*/qa/tests/*.test.ts` |
| Component | Vitest | React components, UI interactions | `apps/*/qa/tests/*.test.tsx` |
| E2E | Playwright | Full user flows, navigation, auth | `apps/*/qa/e2e/*.spec.ts` |
| Backend | convex-test | Convex functions (queries, mutations) | `packages/backend/convex/*.test.ts` (app), `packages/backend/convex/platform/*.test.ts` (platform) |

## Bun Test Pattern (Utility Functions)

Platform auth unit and component tests live in `platform/packages/auth-ui/qa/tests/` and
run through that package's `test` and `test:unit` commands, root Turbo commands, and CI Shared.
They use only platform message catalogues and do not need the sample app. Browser flows
remain in `apps/web/qa/e2e/` to exercise the real app wiring and account page.

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

## Vitest Component Test Pattern

```typescript
// apps/web/qa/tests/button.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "@web-app-starter/design-system";

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

## Running Playwright E2E reliably

Install the pinned browsers once with `bun run setup:e2e`, then run from the repository root:

```bash
CI=true bun run test:e2e  # App suites run sequentially; web uses one worker and retries
CI=true bun run ci        # Full local validation, including E2E
```

For only web, run `CI=true bun run --cwd apps/web test:e2e`. `CI=true` selects the
supported single-worker configuration and prevents reuse of an unrelated existing server.
Without it, Playwright chooses several local workers. Their requests share one IP and can
exceed the web proxy's default **200 page requests per 60 seconds**, producing HTTP 429
`Too Many Requests`, empty titles and cascading locator/`fillStable` timeouts that look like
unrelated app failures. See [edge rate limiting](rate-limiting-architecture.md#layer-3-edge-proxy-http-requests).

Do not disable rate limiting or raise deployment limits to make tests pass. Stop this
checkout's dev servers before switching to CI mode (`bun run dev:stop`); the test harness
starts its own managed local services. An explicitly supplied `E2E_BASE_URL` still targets
that deployment, so use only a disposable test environment, never production. A focused
interactive run may use `bun run --cwd apps/web test:e2e --workers=1`, but it still reuses an
existing local server and does not enable CI retries. After a 429, wait for `Retry-After`
or restart only the managed server for this checkout before retrying.

## Playwright E2E Test Pattern

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

## Convex Backend Test Pattern

Use `createTestEnv` from `convex/test.modules.ts` so every test registers the platform
component. If you construct your own `convexTest(schema, modules)`, call
`registerPlatform(t)` from `@web-app-starter/convex-platform/test` before invoking any
function that writes audit events, including scheduled writes. Register Better Auth
separately when the test creates real sessions. Component storage tests live in
`platform/packages/convex-platform/src/component/` and run with `bun run test:convex`.

```typescript
// packages/backend/convex/projects.test.ts (the sample domain)
import { createTestEnv } from "./test.modules";
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api";

describe("projects", () => {
  test("stores a project", async () => {
    // Includes the platform component and the root module glob.
    const t = createTestEnv();

    // Seed test data
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        name: "Test project",
        description: "Description",
        ownerId: "test-user",
        createdAt: Date.now(),
      });
    });

    // Query and verify
    const items = await t.run(async (ctx) => {
      return ctx.db.query("projects").collect();
    });

    expect(items).toHaveLength(1);
  });
});
```

> **IMPORTANT**: In monorepos with hoisted `node_modules`, `convexTest()` needs the glob as its second argument: `convexTest(schema, import.meta.glob("./**/*.*s"))`. Without it, auto-discovery of Convex modules fails. The glob must be taken from the `convex/` root: a test in a subdirectory (such as the platform's own tests in `convex/platform/`) imports `modules` from `convex/test.modules.ts` instead, because a glob taken there keys its own directory's files as `./x.ts` and convex-test cannot find them.

### Scheduled Functions and Fake Timers

When a Convex mutation calls `ctx.scheduler.runAfter()`, convex-test auto-executes the scheduled function via `setTimeout`. If the scheduled function is an `internalAction` that can't run in the test environment (e.g. it calls external APIs or uses features unavailable in tests), this causes unhandled rejection errors.

**Fix:** Use `vi.useFakeTimers()` to prevent `setTimeout` from firing. The scheduled function is still recorded but never executed.

```typescript
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

describe("myModule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("mutation that schedules an action", async () => {
    const t = convexTest(schema, modules);
    // The mutation calls ctx.scheduler.runAfter() internally,
    // but fake timers prevent the scheduled action from running.
    await t.mutation(internal.myModule.myMutation, { arg: "value" });
  });
});
```

> **When to use this:** Only when the scheduled function can't run in tests. If the scheduled function is a simple mutation/query that works in convex-test, you don't need fake timers — let it run normally.

## Contracts

The contracts CI job also runs `bun run check:advisories` for adopted apps. High/critical
advisories affecting `.platform-base.json` fail the job; lower severity warns. This check
runs even when automatic update delivery is disabled. See [platform updates](platform-updates.md).

Contracts are black-box tests of platform behaviour: HTTP handlers and Convex calls, not UI, so
they survive an app replacing its screens. `bun run test:contracts` runs them, and CI's
**Contracts** job runs them on every PR.

| Contract | Where | Checks |
|---|---|---|
| Session and cookie isolation, security headers, environment | `platform/packages/contracts/tests/http.test.ts`, per app in `APPS` (web, admin) | `clear-session` deletes exactly this app's session cookies (never another app's on the same host); the proxy treats only this app's cookie as a session; nonce CSP and `next.config` security headers; required runtime variables in `.env.example` and `turbo.json` |
| Endpoint authorization | `packages/backend/convex/platform/endpoint-authorization.test.ts` | Every public platform function is classified `public`, `user` or `admin` in `ACCESS`, and `user`/`admin` functions refuse anonymous callers, `admin` ones non-admins. A new platform function fails until classified |
| The app's own | `packages/backend/convex/*contract*.test.ts` (sample: `authorization-contract.test.ts`) | The sample domain's ownership rules: anonymous and non-owner reads and writes are refused and leave records and stored bytes unchanged |

Name your own backend contracts `*contract*.test.ts` so `test:contracts` picks them up.

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

## TDD Workflow

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
CI=true bun run ci
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

## Task Division

| Task Type | Recommended Approach |
|-----------|---------------------|
| **Research** | Read files, grep patterns, understand codebase |
| **Unit Test** | Create test in `apps/<app>/qa/tests/`, implement function, verify with `bun run test` |
| **Component** | Create test in `apps/<app>/qa/tests/`, implement component, verify with Vitest |
| **E2E Flow** | Create spec in `apps/<app>/qa/e2e/`, implement, verify with Playwright |
| **Convex Function** | Define in `packages/backend/convex/schema.ts`, implement handler, test with convex-test |
| **Shared UI** | Add component in `platform/packages/design-system/src/`, export from index.ts |

## Context Boundaries

- Each file should be self-contained with clear imports
- Use `@web-app-starter/*` for platform packages, `@repo/backend` and `@repo/messages` for app
  packages, and `@/` for app-internal imports
- Document public APIs with JSDoc comments
- Keep component files under 200 lines
