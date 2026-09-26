# Code Style Guide

> Detailed guide. See [platform/AGENTS.md](../AGENTS.md) for the quick reference.

## TypeScript

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

## React Components

- Use **function components** exclusively (no class components)
- Use **Radix UI primitives** from `@web-app-starter/design-system` for accessibility
- Shared components go in `platform/packages/design-system/src/`, app-specific in `apps/<app>/src/components/`
- Use package imports for shared code, path aliases for app-internal code

```typescript
// App component: apps/web/src/components/launchpad/item-card.tsx
"use client";

import { Button } from "@web-app-starter/design-system";            // Shared UI
import { cn } from "@web-app-starter/design-system";                 // Utility from shared package
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

## Convex Backend

- **Layout.** `packages/backend/convex/` is one Convex project in two zones. Platform modules
  live in `convex/platform/` (called as `api.platform.<module>` / `internal.platform.<module>`,
  and never edited in an app). App modules, including the sample domain (`projects.ts`,
  `tasks.ts`, `files.ts`, `projectAccess.ts`), live at the `convex/` root and are called as
  `api.<module>`.
- **Seams** at the root: `schema.ts` spreads `platformTables` (from `platform/tables.ts`) and the
  sample's `sampleTables` (from `sampleTables.ts`) before the app's own tables; `http.ts` calls
  `registerPlatformRoutes(http)` before the app's routes; `convex.config.ts` installs the platform's
  Better Auth component; `auth.config.ts` re-exports the platform's auth config.
- App modules import the platform's function builders and helpers from `./platform/*`, for example
  `import { authedQuery } from "./platform/functions"`.
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

## CSS / Styling

- User-visible text in web, landing and landing-static belongs in locale messages,
  including errors, placeholders, accessible labels and metadata. The product name is
  not a message: read `appConfig.identity.productName` (`@web-app-starter/app-config`) and pass it
  to messages that mention it as `{productName}`. Shared components accept translated labels
  through props. Admin remains English-only and reuses existing English catalog
  entries where applicable.
- Business apps may change translated values and add keys; they preserve required
  keys and interpolation parameters and review locale merges during upgrades.
  Language-specific E2E tests may assert literal expected text.

- Use **Tailwind CSS v4** utility classes
- Use `cn()` utility from `@web-app-starter/design-system` for conditional classes
- Follow **mobile-first** responsive design
- Use **CSS variables** for theming (`--foreground`, `--background`, etc.)

```typescript
import { cn } from "@web-app-starter/design-system";

<div className={cn(
  "flex items-center gap-2 p-4",
  isActive && "bg-primary text-primary-foreground",
  className
)}>
```
