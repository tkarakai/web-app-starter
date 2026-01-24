# Project Conventions for AI Agents

This document provides project-specific guidance for AI agents working on this codebase. It covers commands, testing, code patterns, and best practices.

## Quick Reference

```bash
# Start development server (Next.js + Convex)
bun run dev

# Run all tests
bun test                    # Bun tests (fast, utility functions)
bun run test:unit           # Vitest tests (React components)
bun run test:e2e            # Playwright E2E tests (requires browser)

# Type checking and linting
bun run lint                # ESLint
bunx tsc --noEmit           # TypeScript type check

# Build for production
bun run build
```

## Project Overview

This is a **Next.js 16** web application with **Convex** as the backend. It uses:
- **Bun** as the package manager and runtime
- **React 19** with Server Components (App Router)
- **Radix UI** for accessible UI primitives
- **Tailwind CSS v4** for styling
- **TypeScript** with strict mode enabled

## Directory Structure

```
├── src/
│   ├── app/                 # Next.js App Router pages
│   │   ├── (auth)/          # Authentication routes (grouped)
│   │   ├── (dashboard)/     # Dashboard routes (grouped)
│   │   └── api/             # API routes
│   ├── components/
│   │   ├── ui/              # Reusable UI primitives (Button, Input, etc.)
│   │   ├── auth/            # Authentication components
│   │   └── launchpad/       # Feature-specific components
│   └── lib/                 # Utility functions and helpers
├── convex/                  # Convex backend
│   ├── _generated/          # Auto-generated Convex files (DO NOT EDIT)
│   ├── schema.ts            # Database schema definition
│   └── *.ts                 # Server functions (queries, mutations, actions)
├── tests/                   # Test files
│   ├── *.test.ts            # Bun unit tests (utility functions)
│   ├── *.test.tsx           # Vitest component tests
│   ├── helpers/             # Test utilities
│   │   ├── auth-mock.ts     # Authentication mocking helpers
│   │   └── visual-regression.ts  # Playwright screenshot testing
│   └── fixtures/            # Test data
│       └── data.ts          # Pre-defined test fixtures
├── e2e/                     # Playwright E2E test files
│   └── *.spec.ts            # End-to-end test specs
├── .github/
│   └── workflows/
│       └── ci.yml           # GitHub Actions CI/CD workflow
└── scripts/                 # Development scripts
```

## Development Commands

### Starting Development

```bash
# Full development environment (recommended)
bun run dev                  # Starts Next.js + Convex together

# Individual services (for debugging)
bun run dev:next             # Next.js dev server only (port 3000)
bun run dev:convex           # Convex dev server only (port 3210)

# Check service status
bun run dev:status           # Shows running processes

# Stop all services
bun run dev:stop
```

### Testing Commands

```bash
# Bun Tests (fast, for utility functions)
bun test                     # Run all Bun tests
bun test tests/format.test.ts  # Run specific test file

# Vitest Tests (React components with DOM)
bun run test:unit            # Run Vitest once
bun run test:watch           # Watch mode for development
bun run test:coverage        # With coverage report (HTML + JSON output)
bunx vitest run tests/vitest-example.test.tsx  # Specific file

# Convex Tests (backend functions)
npx convex-test              # Run Convex backend tests
bunx vitest run convex/      # Run via Vitest

# Playwright E2E Tests
bun run test:e2e             # Run all E2E tests
bun run test:e2e:ui          # Interactive UI mode
bunx playwright test --list  # List available tests
bunx playwright test e2e/example.spec.ts  # Run specific spec

# Run everything
bun run test:all             # Bun + Vitest + Playwright
```

### Build and Lint

```bash
bun run build                # Production build
bun run lint                 # ESLint check
bun run start                # Start production server
```

## Testing Patterns

### When to Use Each Test Type

| Test Type | Framework | Use For | Location |
|-----------|-----------|---------|----------|
| Unit | Bun | Pure functions, utilities, helpers | `tests/*.test.ts` |
| Component | Vitest | React components, UI interactions | `tests/*.test.tsx` |
| E2E | Playwright | Full user flows, navigation, auth | `e2e/*.spec.ts` |
| Backend | convex-test | Convex functions (queries, mutations) | `convex/*.test.ts` |

### Bun Test Pattern (Utility Functions)

```typescript
import { describe, expect, it } from "bun:test";
import { myFunction } from "../src/lib/myModule";

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
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

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
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

describe("launchItems", () => {
  test("returns items for authenticated user", async () => {
    const t = convexTest(schema);

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

## Test Helpers

### Authentication Mocking (`tests/helpers/auth-mock.ts`)

```typescript
import { createMockUser, mockUseAuth, createMockAuthContext } from "@/tests/helpers/auth-mock";

// Create a mock user
const user = createMockUser({ name: "Test User", email: "test@example.com" });

// Mock the useAuth hook for component testing
const auth = mockUseAuth({ isAuthenticated: true, user });

// Create mock auth context for Convex testing
const authCtx = createMockAuthContext(user);
```

### Test Fixtures (`tests/fixtures/data.ts`)

```typescript
import {
  launchItemFixtures,
  createLaunchItem,
  createManyLaunchItems,
  scenarios,
} from "@/tests/fixtures/data";

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

### Visual Regression (`tests/helpers/visual-regression.ts`)

```typescript
import {
  expectPageSnapshot,
  expectResponsiveSnapshot,
  expectElementSnapshot,
  fullVisualTest,
} from "@/tests/helpers/visual-regression";

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
- Use **Radix UI primitives** for accessibility
- Components go in `src/components/` with clear organization
- Use **path aliases**: `@/` for `src/`, `@/convex/` for `convex/`

```typescript
// Component file: src/components/ui/my-component.tsx
"use client";

import { cn } from "@/lib/utils";

interface MyComponentProps {
  className?: string;
  children: React.ReactNode;
}

export function MyComponent({ className, children }: MyComponentProps) {
  return (
    <div className={cn("base-styles", className)}>
      {children}
    </div>
  );
}
```

### Convex Backend

- **Schema** is defined in `convex/schema.ts`
- Use `v` validator for all fields
- Queries are read-only, mutations modify data
- Always validate inputs and handle errors

```typescript
// convex/myModule.ts
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
- Use `cn()` utility from `@/lib/utils` for conditional classes
- Follow **mobile-first** responsive design
- Use **CSS variables** for theming (`--foreground`, `--background`, etc.)

```typescript
import { cn } from "@/lib/utils";

<div className={cn(
  "flex items-center gap-2 p-4",
  isActive && "bg-primary text-primary-foreground",
  className
)}>
```

## Path Aliases

Configure in `tsconfig.json`, resolved by bundler:

| Alias | Path | Usage |
|-------|------|-------|
| `@/*` | `src/*` | `import { Button } from "@/components/ui/button"` |
| `@/convex/*` | `convex/*` | `import { api } from "@/convex/_generated/api"` |

## Common Patterns

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
import { api } from "@/convex/_generated/api";

export function MyComponent() {
  // Queries subscribe to real-time updates
  const items = useQuery(api.items.list);

  // Mutations for creating/updating/deleting
  const createItem = useMutation(api.items.create);

  const handleCreate = async () => {
    await createItem({ title: "New Item" });
  };

  if (items === undefined) return <Loading />;
  return <ItemList items={items} onCreate={handleCreate} />;
}
```

## Important Warnings

### DO NOT

- **Edit `convex/_generated/`** - These files are auto-generated
- **Use `npm` or `yarn`** - This project uses Bun exclusively
- **Skip TypeScript types** - Strict mode catches bugs early
- **Test Server Components with Vitest** - Use Playwright E2E instead
- **Commit `.env.local`** - Contains secrets, use `.env.example` as template
- **Use `var`** - Use `const` or `let` instead

### BE CAREFUL

- **Convex functions** run on the server - no browser APIs available
- **Server Components** cannot use React hooks or browser APIs
- **Client Components** must have `"use client"` directive at top
- **Path aliases** must match both `tsconfig.json` and `vitest.config.ts`
- **Playwright tests** require Chromium browser installed (`npx playwright install chromium`)

## Environment Variables

Required variables (see `.env.example`):

| Variable | Description | Required |
|----------|-------------|----------|
| `CONVEX_DEPLOYMENT` | Convex deployment identifier | Yes |
| `NEXT_PUBLIC_CONVEX_URL` | Convex API URL (usually `http://127.0.0.1:3210`) | Yes |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex site URL (usually `http://127.0.0.1:3211`) | Yes |
| `NEXT_PUBLIC_SITE_URL` | App URL (usually `http://localhost:3000`) | Yes |

For tests:
```bash
# Copy example and fill in values
cp .env.example .env.local
```

## TDD Workflow for AI Agents

### Recommended Approach

1. **Understand the requirement** - Read related files and understand context
2. **Write a failing test first** - Define expected behavior
3. **Implement minimal code** - Make the test pass
4. **Refactor** - Improve code while tests still pass
5. **Run all tests** - Ensure no regressions

### Quick Feedback Loop

```bash
# For utility functions (fastest)
bun test --watch

# For React components
bun run test:watch

# For full integration
bun run test:all
```

### Example TDD Session

```bash
# 1. Create test file
# tests/newFeature.test.ts

# 2. Run in watch mode
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
| **Unit Test** | Create test file, implement function, verify with `bun test` |
| **Component** | Create test, implement component, verify with Vitest |
| **E2E Flow** | Create spec, implement, verify with Playwright |
| **Convex Function** | Define in schema, implement handler, test with convex-test |

### Context Boundaries

- Each file should be self-contained with clear imports
- Use path aliases consistently (`@/` prefix)
- Document public APIs with JSDoc comments
- Keep component files under 200 lines

## Debugging

### Common Issues

**Tests not finding modules:**
```bash
# Check path aliases match tsconfig.json
bunx tsc --noEmit
```

**Vitest configuration errors:**
```bash
bunx vitest --version  # Verify installation
bunx vitest run --reporter=verbose  # Detailed output
```

**Playwright browser not installed:**
```bash
npx playwright install chromium
```

**Convex sync issues:**
```bash
bun run dev:convex  # Restart Convex dev server
```

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Component | kebab-case.tsx | `user-avatar.tsx` |
| Page | kebab-case in folder | `src/app/sign-up/page.tsx` |
| Utility | camelCase.ts | `formatDate.ts` or `format.ts` |
| Test | same-name.test.ts(x) | `format.test.ts`, `button.test.tsx` |
| E2E Test | descriptive.spec.ts | `auth-flow.spec.ts` |
| Convex | camelCase.ts | `launchItems.ts` |

## Verification Checklist

Before committing changes:

- [ ] TypeScript compiles: `bunx tsc --noEmit`
- [ ] Linting passes: `bun run lint`
- [ ] Unit tests pass: `bun test`
- [ ] Component tests pass: `bun run test:unit`
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
