# Design System Showcase (`apps/design`)

Interactive component showcase for the `@repo/ui` package. Runs on port 3003.

```bash
bun run dev:design    # Start at http://localhost:3003
```

## How It Works

The app imports components directly from `@repo/ui` — the same way all other apps do. When you update a component in `packages/ui/src/`, the design app picks up the change via hot reload (dev) or at build time.

The **sidebar navigation** and **overview grid** are auto-generated from a **component registry** file. Individual demo pages are authored by hand since each component needs bespoke interactive examples.

## Key Files

```
apps/design/
  src/
    lib/registry.ts                  # Component registry (drives sidebar + overview)
    components/
      sidebar.tsx                    # Sidebar nav (reads from registry)
      theme-provider.tsx             # Dark/light mode toggle
      component-page.tsx             # Reusable page wrapper (title + description)
      demo-section.tsx               # Reusable section wrapper (heading + demo area)
    app/
      layout.tsx                     # Root layout (sidebar on every page)
      page.tsx                       # Overview grid (auto-generated from registry)
      components/<slug>/page.tsx     # Individual component demo pages
```

## Adding a New Component

When you create a new component in `packages/ui/src/`:

### 1. Add to the registry

Edit `src/lib/registry.ts` and add an entry:

```ts
{
  name: "Switch",
  slug: "switch",
  category: "Form",
  description: "Toggle between on and off states.",
},
```

This automatically adds it to the sidebar nav and overview grid. No other config needed.

### 2. Create the demo page

Create `src/app/components/switch/page.tsx`:

```tsx
"use client";

import { Switch } from "@repo/ui";
import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function SwitchPage() {
  return (
    <ComponentPage
      title="Switch"
      description="Toggle between on and off states."
    >
      <DemoSection title="Default">
        <Switch />
      </DemoSection>
    </ComponentPage>
  );
}
```

That's it. Two files: one registry entry, one page.

## Updating an Existing Component

If you change a component's styling, variants, or behavior in `packages/ui/src/`:

- **No action needed** if the demo page already covers the change. Hot reload picks it up.
- **Update the demo page** if you added new variants, props, or states that should be showcased.

For example, if you add a `destructive` variant to Button, update `src/app/components/button/page.tsx` to include it in the variants section.

## Removing a Component

1. Delete the entry from `src/lib/registry.ts`
2. Delete the `src/app/components/<slug>/` directory

## Dark Mode

The app has a dark/light toggle in the sidebar. This works because `packages/ui/styles/globals.css` defines both `:root` (light) and `.dark` (dark) CSS variable blocks. The toggle adds/removes the `dark` class on `<html>`.

All apps in the monorepo inherit dark mode support via the shared CSS variables.

## Categories

Components are grouped into categories in the sidebar. Available categories:

| Category | For |
|----------|-----|
| Actions | Buttons, clickable controls |
| Display | Visual indicators (Badge, Avatar, Progress, Separator) |
| Form | Input fields and labels |
| Layout | Content containers (Card, Tabs) |
| Overlay | Popups and modals (Dialog, Dropdown Menu, Tooltip) |

To add a new category, add it to the `ComponentCategory` type and `categoryOrder` array in `registry.ts`.
