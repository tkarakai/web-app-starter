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
that deployment. Suites that create fixture accounts require a disposable local backend;
use the [development launcher's fixture authorization](development.md#dev-seed-accounts) or
the [local AWS target settings](aws/deployment-architecture-aws.md#running-the-e2e-suites-against-a-target).
Never target production. A focused
interactive run may use `bun run --cwd apps/web test:e2e --workers=1`, but it still reuses an
existing local server and does not enable CI retries. After a 429, wait for `Retry-After`
or restart only the managed server for this checkout before retrying.

The local backend retains admin settings across launcher restarts. Tests that depend on
onboarding policy must select their mode explicitly rather than assume the default.
Web's `qa/e2e/helpers/onboarding.ts` provides a disposable admin session separate from the
guest browser, checks the local backend URL, and restores the prior effective policy in
fixture teardown, including after assertion failures. Use its `onboarding.setMode(...)`
fixture for mode-dependent tests. It requires one worker because policy is shared by all
browser contexts; CI shards each have their own backend.

### Web E2E shards in CI

CI runs web E2E in four parallel shards (`platform-ci-web.yml`). Playwright's own `--shard`
splits by test count, and the slow, serial auth suites would pile into one shard while the
others finish early. So each shard runs **whole spec files**, assigned longest-first by the
per-file seconds in `apps/web/qa/e2e/shard-durations.json`
(`platform/tooling/e2e-shard-plan.ts`). The job log's "Plan this shard" step shows every
shard's files and estimate.

A new or renamed spec file without a recorded duration is estimated from its test count, so
the plan never misses a test, but the balance drifts as the suite changes. When one web shard
takes much longer than the others, refresh the durations from a full run:

```bash
cd apps/web
CI=true bun run test:e2e --project=chromium --reporter=json
cd ../..
./platform/tooling/node-ts.sh platform/tooling/e2e-shard-plan.ts record \
  --report apps/web/qa/safe-e2e-report/report.json --out apps/web/qa/e2e/shard-durations.json
```

Only the proportions matter, so a local run works as well as a CI one. Commit the file.

### Credential-safe browser reports

Run web/admin browser tests through `bun run test:e2e`. Their runner publishes only outcomes,
source locations, timing and diagnostic categories in `qa/safe-e2e-report/report.json` and
`index.html`. Passwords, recovery codes, bearer links, raw action titles, console output and
attachments are excluded. Automatic screenshots, video, traces and AI error snapshots are off.
The wrapper captures child output and removes its own temporary raw artifacts after execution;
its exit code still reports test failure. Each failed hosted web shard publishes its own safe report.

`--reporter=list`, `github`, `json` and `html` select safe output formats. Direct Playwright
execution and custom/blob reporters are refused by the shipped authenticated-app configs;
`playwright test --list --reporter=json` is allowed for discovery without running ceremonies.
Interactive `--ui`/`--debug` and capture overrides are unsupported for these credential-bearing
suites; use a focused headless run and the failing source location to diagnose a failure.
Server logs retained by the development launcher can contain auth email links. Keep them private
and do not upload them with browser reports.

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

Platform session-assurance and recovery tests use test-only endpoints registered by
`convex/platform/sessionAssurance.test-helpers.ts`. They exercise the real authenticated
query and mutation wrappers without depending on sample tables or functions, so they keep
running after `adopt --remove-sample`. The fixture endpoints are never deployed.
Organization membership, enrollment and operator-boundary tests use
`privateResources.test-helpers.ts`: a test-only schema with real tenant wrappers, explicit
organization context and private ownership checks. It imports no sample API and adds no
deployed endpoint. Pass the test's `modules` map into the helper, keeping test discovery out
of the production TypeScript graph.

The adoption tooling tests execute the retained backend suite, the organization/context web
tests, typechecks and browser-test discovery after actual sample removal. Workspace imports
resolve to that copied app, not the original starter. Fresh `adopt --remove-sample` installs
empty-domain migration registration and acceptance templates; these retain identity, authority
retirement, audit privacy, readiness, interrupted migration and forward-recovery checks, plus
a test-only custom business migration. The source inventory must still reject unclassified
tables and exports. Sample graph/file tests remain with the optional sample implementation.
After changing backend modules in a real app, run Convex code generation against your own
development deployment before treating an app typecheck as final generated-API evidence.

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

### Organization and operator acceptance

Exercise registered APIs with real canonical Better Auth users, sessions and memberships. Include
independent owners in two organizations and a shared identity with differing membership roles;
check explicit/missing/forged context, cross-owner/parent children, suspension/removal/reactivation,
async transfer reauthorization and captured-context writes. Prove that strict tenant getters return
no untagged/foreign data and that the separate legacy-private bridge neither guesses a mapping nor
accepts a wrong personal ID. Preserve rows and bytes in negative tests.

Operator tests must distinguish canonical global operators from customer org-admins, reserved
emails and mixed identities. Execute both direct and native interfaces, including persisted proof,
unknown captured-operation denial and safe DTO/cursor/artifact projections. A supplied owner/user
snapshot or source-code assertion is not evidence of authorization. Pure ownership helper unit
tests do not replace this registered-interface coverage. See [organization context](organization-context.md).

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

## Shared UI and production artifacts

App-owned shared UI needs a package-local component suite and `test:coverage` command. `bun run test:shared-packages` runs those commands in both native and GitHub CI. The onboarding form owns its behavior tests in `packages/onboarding/qa/tests` and enforces V8 coverage thresholds in its Vitest configuration; consuming apps retain wiring tests. When extracting UI, move its behavior tests and coverage with the code.

`bun run test:landing-export` serves the existing production export and runs Chromium against it. Build first with `NEXT_PUBLIC_CONVEX_SITE_URL` configured; set `EXPORT_EXPECT_CONFIGURED=false` only for an export built with that variable empty. The test uses controlled enabling HTTP responses while exercising real built HTML, JS and CSS, asserting waitlist and announcement presence or absence according to the build's feature switches. Dev-server E2E remains a separate check.

`bun run test:landing-artifacts` builds and tests both missing and configured variants, leaving the configured output last. Native CI, GitHub CI and upgrade verification use this command.

For the retained reference landing, run
`./platform/tooling/node-ts.sh apps/landing/qa/helpers/configuration-acceptance.ts --all`
to exercise all four waitlist/announcement combinations after real adoption in a disposable
repository inside the checkout. The fixture starts fresh from either a product or adopted
app source, omitting existing adoption and update-delivery state, and explicitly ships English
as its only locale and default. It reuses pinned dependencies without installs or remote
repository operations, and removes the fixture afterward. Select `--components`, `--e2e`, or `--exports`
for a focused run; `--all` is the default. `test:dev-scripts` runs the component and E2E
discovery matrix when this app-owned helper exists; browser execution and production export
smokes require the other stages.
