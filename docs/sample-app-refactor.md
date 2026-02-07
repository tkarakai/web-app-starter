# PRD: Sample Content Redesign — Minimal Landing + Projects & Tasks

## 1. Problem Statement

The current starter template ships with a "Launchpad" theme — launch items with statuses like "idea / building / shipping," a busy landing page with four sections, and custom terminology ("launch signals," "release momentum," "signal helpers"). While well-built, it has two issues:

1. **The landing page is too busy.** Four sections (hero + status card, tech pillars grid, "what you get" card, "next steps" card) feel like a marketing site for a framework rather than a blank-canvas starter.
2. **The sample data model is unconventional.** "Launch items" is not an immediately recognizable concept. Developers cloning a starter want a familiar CRUD pattern they can understand in seconds and tear out or reshape without studying custom domain language.

## 2. Goal

Replace the current sample content with:

- **A minimal, hero-only landing page** — one centered section, one tagline, two CTAs.
- **A "Projects & Tasks" data model** — two tables with a 1-to-many relationship. Universally understood, demonstrates relational patterns in Convex, and maps cleanly to the existing dashboard UI structure (tabs, progress, create/edit dialogs).

The visual design language (warm gradient background, Space Grotesk / Fraunces fonts, card styling, color palette) stays the same. This is a content and data model change, not a visual redesign.

## 3. Monorepo Context

The codebase is a **Turborepo monorepo** with this structure:

```
/
├── apps/
│   ├── web/          # Main web app (port 3001) — dashboard lives here
│   ├── landing/      # Landing page (port 3000) — landing page lives here
│   └── admin/        # Admin app (port 3002)
├── packages/
│   ├── ui/           # Shared UI components (@repo/ui)
│   ├── auth/         # Auth utilities (@repo/auth)
│   └── backend/      # Convex backend (@repo/backend)
```

**Import conventions:**
- `@repo/ui` — UI components (`Button`, `Card`, `Dialog`, etc.)
- `@repo/auth/client` — client-side auth (`authClient`)
- `@repo/auth/server` — server-side auth (`isAuthenticated`, `preloadAuthQuery`)
- `@repo/backend` — Convex API (`api`, `Id`, `Doc`)
- `@/*` — local imports within each app (e.g., `@/lib/format`, `@/components/...`)

## 4. Scope

### In Scope

| Area | What Changes |
|------|-------------|
| Landing page | Strip `apps/landing/src/app/page.tsx` to minimal hero-only layout |
| Convex schema | Replace `launchItems` with `projects` + `tasks` (1-to-many) in `packages/backend/convex/schema.ts` |
| Convex functions | Replace `packages/backend/convex/launchItems.ts` with `projects.ts` + `tasks.ts` |
| Dashboard page | Redesign `apps/web/` with collapsible sidebar, project navigation, and task table |
| Components | Replace `apps/web/src/components/launchpad/` with `apps/web/src/components/projects/` (sidebar, task list, etc.) |
| Utility helpers | Replace `apps/web/src/lib/launchpad.ts` with `apps/web/src/lib/projects.ts` |
| Backend tests | Update `packages/backend/convex/launchItems.test.ts` → `projects.test.ts` + `tasks.test.ts` |
| Test fixtures | Update `apps/web/qa/tests/fixtures/data.ts` to use project/task shapes |
| Unit tests | Update `apps/web/qa/tests/launchpad.test.ts` → `projects.test.ts` |
| E2E tests | Update `apps/web/qa/e2e/example.spec.ts` to match new landing page content |
| Layout metadata | Update page titles in `apps/landing/src/app/layout.tsx` and `apps/web/src/app/layout.tsx` |
| Upload panel | Keep as-is (file upload is a separate concern, still useful as a demo) |

### Out of Scope

- Color palette, fonts, or CSS variable changes (keep existing warm palette, Space Grotesk / Fraunces)
- Auth flow changes (sign-in, sign-up pages stay the same)
- File upload functionality changes (upload panel keeps same Convex storage logic, just relabeled and made collapsible)
- Convex auth setup, provider wiring, SSR preloading patterns
- CI/CD pipeline, testing infrastructure
- `CLAUDE.md` updates (will be a separate follow-up)
- Mobile responsive sidebar (overlay mode) — stretch goal, not required for initial implementation

## 5. Landing Page Design

**File:** `apps/landing/src/app/page.tsx`

### Current (4 sections, ~170 lines)

```
┌─────────────────────────────────────────┐
│ Hero (two-column: text + status card)   │
├─────────────────────────────────────────┤
│ Tech Pillars (2×2 grid)                 │
├─────────────────────────────────────────┤
│ "What you get" + "Next steps" (two-col) │
└─────────────────────────────────────────┘
```

### Proposed (1 section, ~50 lines)

```
┌─────────────────────────────────────────┐
│                                         │
│          [Badge: starter tag]           │
│                                         │
│     Your starting line. Build from      │
│              here.                      │
│                                         │
│   One-liner description of what this    │
│   starter gives you.                    │
│                                         │
│   [Get started]   [Sign in]             │
│                                         │
└─────────────────────────────────────────┘
```

**Details:**

- **Background**: Keep the existing warm radial gradient.
- **Content**: Centered vertically and horizontally.
- **Badge**: Small pill at top — e.g., `Next.js + Convex + Better Auth` (factual, not branded).
- **Heading**: `h1`, 2 lines max. Short, neutral, not domain-specific. Example: "Your starting line. Build from here."
- **Subheading**: One sentence. Example: "Auth, database, real-time sync, and file uploads — wired and ready."
- **CTAs**: Two buttons side-by-side:
  - Primary: "Get started" → links to the web app sign-up (`http://localhost:3001/sign-up` in dev)
  - Outline: "Sign in" → links to the web app sign-in (`http://localhost:3001/sign-in` in dev)
- **No** status card, no tech pillar grid, no "what you get" section, no setup instructions.

### Page Title and Metadata

In `apps/landing/src/app/layout.tsx`:

```typescript
export const metadata: Metadata = {
  title: "Web App Starter",
  description: "A Next.js starter with Convex, Better Auth, and Bun.",
};
```

## 6. Data Model

### Current: `launchItems` (single table)

```
launchItems
├── title: string
├── description: string
├── status: "idea" | "building" | "shipping"
├── priority: number (1–4)
├── ownerId: string
└── createdAt: number
```

### Proposed: `projects` + `tasks` (two tables, 1-to-many)

```
projects
├── name: string
├── description: string
├── ownerId: string
└── createdAt: number

tasks
├── title: string
├── description: string
├── status: "todo" | "in_progress" | "done"
├── projectId: Id<"projects">
├── ownerId: string
└── createdAt: number
```

**Why this shape:**

- **Two tables** demonstrate Convex's relational querying (index on `projectId`).
- **No priority field** — simplifies the model. Status is the only axis of filtering, same as the current tab UI.
- **`todo / in_progress / done`** — universally understood, no explanation needed.
- **`projectId` foreign key** — shows a real 1-to-many relationship pattern in Convex, which is more instructive than a single flat table.

### Convex Schema

**File:** `packages/backend/convex/schema.ts`

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    description: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  tasks: defineTable({
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done")),
    projectId: v.id("projects"),
    ownerId: v.string(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"]),

  uploads: defineTable({
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),
});
```

### Convex Functions

#### `packages/backend/convex/projects.ts`

| Function | Type | Args | Description |
|----------|------|------|-------------|
| `list` | query | — | List all projects owned by authenticated user, ordered by `createdAt` desc |
| `get` | query | `id: Id<"projects">` | Get a single project by ID (with auth check) |
| `create` | mutation | `name, description` | Create a project for the authenticated user |
| `update` | mutation | `id, name?, description?` | Partial update, owner authorization check |
| `remove` | mutation | `id` | Delete a project and all its tasks (cascade) |

#### `packages/backend/convex/tasks.ts`

| Function | Type | Args | Description |
|----------|------|------|-------------|
| `listByProject` | query | `projectId: Id<"projects">` | List all tasks for a project, ordered by `createdAt` desc |
| `create` | mutation | `title, description, status, projectId` | Create a task within a project (validates project ownership) |
| `update` | mutation | `id, title?, description?, status?` | Partial update with owner authorization |
| `remove` | mutation | `id` | Delete a single task |

**Note**: `remove` is a new operation not present in the current codebase. It's added because a tasks app without delete feels incomplete, and it demonstrates Convex's `ctx.db.delete()` pattern.

## 7. Dashboard Redesign

### Current Layout

The current dashboard (`apps/web/src/app/(dashboard)/dashboard/dashboard-client.tsx`) is a full-width page with a header bar (user profile top-right), a two-column content grid (launch items left, stats/uploads right), and no navigation structure.

```
┌─────────────────────────────────────────────────────┐
│ [Header: "Launchpad control" + User avatar/dropdown]│
├──────────────────────────────┬──────────────────────┤
│ Launch Signals               │ Release Momentum     │
│ [Tabs: All|Idea|Bld|Ship]   │ Progress bar         │
│ [List of launch items]       │ Badge stats          │
│                              ├──────────────────────┤
│                              │ Signal Helpers       │
│                              ├──────────────────────┤
│                              │ Upload Panel         │
└──────────────────────────────┴──────────────────────┘
```

### Proposed Layout: Collapsible Sidebar + Main Content Area

The new layout introduces a **left sidebar** with project navigation and user profile, paired with a **main content area** that shows the selected project's details and tasks.

```
┌──────────────────┬──────────────────────────────────────────────┐
│ [◀ Collapse]     │                                              │
│                  │  Project Name                                │
│ PROJECTS    [+]  │  Project description text here               │
│ ┌──────────────┐ │                                              │
│ │▸ Website     │ │  ┌──────────────────────────────────────────┐│
│ │  Mobile App  │ │  │ Tasks                          [+ Task] ││
│ │  API Layer   │ │  │                                         ││
│ └──────────────┘ │  │ ┌─────────────────────────────────────┐ ││
│                  │  │ │ ☐ Design landing page     [To do ▾] │ ││
│                  │  │ │   Build the new landing page         │ ││
│                  │  │ ├─────────────────────────────────────┤ ││
│                  │  │ │ ☐ Set up CI pipeline  [In progress ▾]│ ││
│                  │  │ │   Configure GitHub Actions           │ ││
│                  │  │ ├─────────────────────────────────────┤ ││
│                  │  │ │ ☑ Write auth tests         [Done ▾] │ ││
│                  │  │ │   Unit + integration tests           │ ││
│                  │  │ └─────────────────────────────────────┘ ││
│                  │  └──────────────────────────────────────────┘│
│                  │                                              │
│                  │                                              │
│ ┌──────────────┐ │                                              │
│ │ 👤 User Name │ │                                              │
│ │ user@mail.co │ │                                              │
│ └──────────────┘ │                                              │
└──────────────────┴──────────────────────────────────────────────┘
```

**Collapsed state** (icon-only, ~64px wide):

```
┌────┬────────────────────────────────────────────────┐
│ [▶]│                                                │
│    │  (same main content area)                      │
│ 📁 │                                                │
│    │                                                │
│    │                                                │
│    │                                                │
│    │                                                │
│    │                                                │
│ 👤 │                                                │
└────┴────────────────────────────────────────────────┘
```

### Sidebar Specification

The sidebar is the primary navigation element of the dashboard. It follows the pattern seen in modern apps like Linear, Notion, and Vercel's dashboard.

#### Structure (top to bottom)

1. **Collapse/Expand Toggle** (top)
   - A button at the very top of the sidebar.
   - **Expanded**: Shows a left-pointing chevron icon (`PanelLeftClose` or `ChevronsLeft`) with no text label. Clicking it collapses the sidebar.
   - **Collapsed**: Shows a right-pointing chevron icon (`PanelLeftOpen` or `ChevronsRight`). Clicking it expands the sidebar.
   - The toggle state is stored in React state (no persistence to localStorage needed for a starter template).

2. **Projects Section** (middle, scrollable)
   - **Section header**: "Projects" label, left-aligned.
     - The "Projects" text is clickable — it toggles collapse/expand of the project list below it (accordion behavior). A small chevron icon rotates to indicate open/closed state.
     - Right-aligned: A `+` button (small, ghost variant) that opens the "Create Project" dialog.
   - **Project list**: Indented list of project names, rendered as clickable items.
     - The currently selected project is highlighted with a subtle background (`bg-muted` or `bg-accent/10`).
     - Clicking a project selects it and loads its content in the main area.
     - Each project item shows just the project name (truncated with ellipsis if long).
     - If no projects exist, show "No projects" in `text-muted-foreground` italic text.
     - The list is vertically scrollable if it overflows.
   - **In collapsed mode**: Show a single folder icon (`FolderKanban`) that, when clicked, expands the sidebar.

3. **User Profile** (bottom, pinned)
   - Pinned to the bottom of the sidebar using flexbox (`mt-auto`).
   - **Expanded**: Shows user avatar (initials fallback), display name, and email. Clicking the area opens a dropdown menu with "Sign out" option.
   - **Collapsed**: Shows only the avatar circle. Clicking opens the same dropdown.
   - Uses the existing `Avatar`, `AvatarFallback`, `DropdownMenu` components from `@repo/ui`.

#### Styling

- **Width expanded**: `w-64` (256px)
- **Width collapsed**: `w-16` (64px)
- **Transition**: `transition-all duration-200 ease-in-out` on the width change. Content inside fades or hides based on a `isCollapsed` boolean (no animation on text, just show/hide).
- **Background**: `bg-card/50` with a right border `border-r border-border/60` — subtle, not heavy.
- **Height**: Full viewport height (`h-screen`), with `flex flex-col` layout.
- **The sidebar is a fixed element** on the left. The main content area has a left margin/padding that matches the sidebar width and transitions with it.

#### Responsive Behavior

- **Desktop (lg+)**: Sidebar is visible, starts expanded.
- **Mobile/Tablet (<lg)**: Sidebar is hidden by default. A hamburger button in the top-left of the main content area opens it as an overlay (with a backdrop). This is a stretch goal — for the initial implementation, the sidebar can simply be always visible and collapsible.

### Main Content Area Specification

The main content area fills the remaining viewport width to the right of the sidebar.

#### When No Project is Selected (or no projects exist)

Show a centered empty state:

```
┌──────────────────────────────────────────────┐
│                                              │
│            📁                                │
│     No project selected                      │
│                                              │
│     Create a project to get started.         │
│     [Create project]                         │
│                                              │
└──────────────────────────────────────────────┘
```

#### When a Project is Selected

The main area is a single-column layout with vertical scrolling:

**A. Project Header**

```
┌──────────────────────────────────────────────┐
│ Project Name                    [Edit] [Del] │
│ Project description text here                │
└──────────────────────────────────────────────┘
```

- **Project name**: `h1` or `h2`, `text-2xl font-semibold`.
- **Description**: `text-sm text-muted-foreground`, below the name.
- **Action buttons**: Right-aligned, small icon buttons.
  - **Edit** (Pencil icon): Opens an "Edit Project" dialog to change name/description.
  - **Delete** (Trash icon): Opens a confirmation dialog, then deletes the project and all its tasks (cascade). After deletion, clear the selection (back to empty state).

**B. Task Table / List**

Below the project header, a card containing the task list:

```
┌──────────────────────────────────────────────┐
│ Tasks (3)                        [+ Add task]│
│                                              │
│ [All] [To do] [In progress] [Done]           │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ ☐ Design landing page          To do   ✎🗑│ │
│ │   Build the new landing page             │ │
│ ├──────────────────────────────────────────┤ │
│ │ ◐ Set up CI pipeline       In progress ✎🗑│ │
│ │   Configure GitHub Actions               │ │
│ ├──────────────────────────────────────────┤ │
│ │ ☑ Write auth tests              Done   ✎🗑│ │
│ │   Unit + integration tests               │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ 2 of 3 tasks done                            │
│ [████████████████████░░░░░░░░] 67%           │
└──────────────────────────────────────────────┘
```

- **Header row**: "Tasks" label with count in parentheses, plus an "Add task" button (opens create dialog).
- **Tab filter**: Uses the existing `Tabs` / `TabsList` / `TabsTrigger` components from `@repo/ui`. Tabs: All, To do, In progress, Done.
- **Task rows**: Each task is a row (not a separate card — less visual noise than the current approach). Rows have:
  - **Status icon**: A checkbox-style icon. Unchecked circle for "todo", half-filled for "in_progress", checked for "done". Clicking cycles the status via a mutation (quick toggle, no dialog needed).
  - **Title**: `text-sm font-medium`. Struck-through with `line-through text-muted-foreground` when status is "done".
  - **Description**: `text-xs text-muted-foreground` below the title. Optional — only shown if non-empty.
  - **Status badge**: Small badge showing the current status. Uses the existing `Badge` component with appropriate variant. Clicking opens a small dropdown to change status (alternative to the icon click).
  - **Action buttons**: Edit (pencil) and Delete (trash) icon buttons, visible on hover or always visible on mobile. Ghost variant, small size.
- **Empty state**: When no tasks match the current filter, show "No tasks yet. Add one to get started." in a dashed-border container (same pattern as current empty state).
- **Progress footer**: At the bottom of the tasks card, show a simple text summary ("X of Y tasks done") and a `Progress` bar.

**C. Attachments Section (Optional)**

Below the tasks card, the upload panel appears as a collapsible section:

```
┌──────────────────────────────────────────────┐
│ ▸ Attachments (2)                            │
│   (collapsed by default, click to expand)    │
└──────────────────────────────────────────────┘
```

- Same file upload functionality as current `UploadPanel`.
- Relabeled from "Launch assets" to "Attachments".
- Collapsed by default to keep the main view clean. Click the header to expand.

### Task Create/Edit Dialogs

Use the existing `Dialog` component from `@repo/ui`. Same pattern as the current launch item dialogs, simplified:

**Create Task Dialog:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Title | `Input` | Yes | Placeholder: "What needs to be done?" |
| Description | `Textarea` | No | Placeholder: "Add details..." |
| Status | `select` | Yes | Default: "todo". Options: To do, In progress, Done |

**Edit Task Dialog:**

Same fields, pre-populated with current values.

**Create/Edit Project Dialog:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | `Input` | Yes | Placeholder: "Project name" |
| Description | `Textarea` | No | Placeholder: "What is this project about?" |

**Delete Confirmation Dialog:**

Simple confirmation with a warning message. For projects, mention that all tasks will also be deleted.

### Dashboard Component Breakdown

All dashboard components live in `apps/web/src/`:

| Component | File | Purpose |
|-----------|------|---------|
| `DashboardClient` | `app/(dashboard)/dashboard/dashboard-client.tsx` | Root client component, manages sidebar state, selected project, orchestrates layout |
| `Sidebar` | `components/projects/sidebar.tsx` | Collapsible sidebar with project list and user profile |
| `ProjectHeader` | `components/projects/project-header.tsx` | Project name, description, edit/delete actions |
| `TaskList` | `components/projects/task-list.tsx` | Task table with tabs, filtering, progress bar, add button |
| `TaskRow` | `components/projects/task-row.tsx` | Single task row with status toggle, inline actions |
| `UploadPanel` | `components/projects/upload-panel.tsx` | Moved from `launchpad/`, relabeled, made collapsible |
| `EmptyState` | `components/projects/empty-state.tsx` | Reusable empty state (no project selected / no tasks) |

All components import UI primitives from `@repo/ui` and backend API from `@repo/backend`.

## 8. Utility Helpers

### Current: `apps/web/src/lib/launchpad.ts`

```typescript
launchStatuses: ["idea", "building", "shipping"]
normalizeTitle(value: string): string
toPriorityLabel(priority: number): string
toStatusCopy(status: LaunchStatus): string
```

### Proposed: `apps/web/src/lib/projects.ts`

```typescript
taskStatuses: ["todo", "in_progress", "done"]
type TaskStatus = "todo" | "in_progress" | "done"
normalizeText(value: string): string          // renamed from normalizeTitle
toStatusLabel(status: TaskStatus): string     // "To do" | "In progress" | "Done"
```

- **`toPriorityLabel` removed** — no priority field in the new model.
- **`normalizeTitle` renamed** to `normalizeText` — it's used for both titles and descriptions.

## 9. Files to Create, Modify, and Delete

### Create

| File | Description |
|------|-------------|
| `packages/backend/convex/projects.ts` | Project CRUD functions |
| `packages/backend/convex/tasks.ts` | Task CRUD functions |
| `packages/backend/convex/projects.test.ts` | Backend tests for projects |
| `packages/backend/convex/tasks.test.ts` | Backend tests for tasks |
| `apps/web/src/lib/projects.ts` | Utility helpers for task statuses |
| `apps/web/src/components/projects/sidebar.tsx` | Collapsible sidebar with project list and user profile |
| `apps/web/src/components/projects/project-header.tsx` | Project name, description, edit/delete actions |
| `apps/web/src/components/projects/task-list.tsx` | Task table with tabs, filtering, progress, add button |
| `apps/web/src/components/projects/task-row.tsx` | Single task row with status toggle and inline actions |
| `apps/web/src/components/projects/upload-panel.tsx` | Upload panel (moved + relabeled, collapsible) |
| `apps/web/src/components/projects/empty-state.tsx` | Reusable empty state component |
| `apps/web/qa/tests/projects.test.ts` | Unit tests for utility helpers |

### Modify

| File | Change |
|------|--------|
| `packages/backend/convex/schema.ts` | Replace `launchItems` table with `projects` + `tasks` |
| `apps/landing/src/app/page.tsx` | Strip to minimal hero-only layout |
| `apps/landing/src/app/layout.tsx` | Update `metadata.title` and `metadata.description` |
| `apps/web/src/app/layout.tsx` | Update `metadata.title` and `metadata.description` |
| `apps/web/src/app/(dashboard)/dashboard/dashboard-client.tsx` | Rewrite for sidebar + projects + tasks |
| `apps/web/qa/tests/fixtures/data.ts` | Replace launch item fixtures with project/task fixtures |
| `apps/web/qa/e2e/example.spec.ts` | Update assertions for new landing page content |

### Delete

| File | Reason |
|------|--------|
| `packages/backend/convex/launchItems.ts` | Replaced by `projects.ts` + `tasks.ts` |
| `packages/backend/convex/launchItems.test.ts` | Replaced by `projects.test.ts` + `tasks.test.ts` |
| `apps/web/src/lib/launchpad.ts` | Replaced by `projects.ts` |
| `apps/web/src/components/launchpad/launch-item-card.tsx` | Replaced by `task-row.tsx` + `project-header.tsx` |
| `apps/web/src/components/launchpad/upload-panel.tsx` | Moved to `projects/upload-panel.tsx` |
| `apps/web/qa/tests/launchpad.test.ts` | Replaced by `apps/web/qa/tests/projects.test.ts` |

## 10. Test Updates

### E2E Tests (`apps/web/qa/e2e/example.spec.ts`)

Update all assertions to match new landing page:

| Current Assertion | New Assertion |
|-------------------|---------------|
| `toHaveTitle("Launchpad Starter")` | `toHaveTitle("Web App Starter")` |
| `heading: "A bold baseline..."` | New heading text |
| `getByText("Launchpad starter")` | New badge text |
| `getByRole("link", { name: /Start a workspace/ })` | `getByRole("link", { name: /Get started/ })` |
| `getByRole("link", { name: /View dashboard/ })` | `getByRole("link", { name: /Sign in/ })` |
| Feature pillar assertions (4 headings) | Remove entirely |

### Unit Tests (`apps/web/qa/tests/projects.test.ts`)

```typescript
describe("normalizeText", () => {
  it("trims and normalizes whitespace", () => {
    expect(normalizeText("  My  project  ")).toBe("My project");
  });
});

describe("toStatusLabel", () => {
  it("maps status to display label", () => {
    expect(toStatusLabel("todo")).toBe("To do");
    expect(toStatusLabel("in_progress")).toBe("In progress");
    expect(toStatusLabel("done")).toBe("Done");
  });
});
```

### Convex Backend Tests (`packages/backend/convex/`)

Same patterns as current tests, but for two tables:

- **`projects.test.ts`**: CRUD operations, owner isolation, cascade delete
- **`tasks.test.ts`**: CRUD operations, project relationship, status filtering, owner authorization
- **Indexes tested**: `by_owner`, `by_project`, `by_status`

### Test Fixtures (`apps/web/qa/tests/fixtures/data.ts`)

```typescript
export interface ProjectFixture {
  name: string;
  description: string;
  ownerId: string;
  createdAt: number;
}

export interface TaskFixture {
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done";
  projectId: string; // In tests, this is a placeholder
  ownerId: string;
  createdAt: number;
}
```

Keep the same factory pattern (`createProject()`, `createTask()`, `createManyTasks()`) and scenario structure (`scenarios.empty`, `scenarios.singleUser`, etc.).

## 11. Migration Notes

- **No database migration needed** — this is a starter template. Developers clone it fresh. There is no production data to migrate.
- **Convex `_generated/` files** — will be regenerated automatically when the schema changes and `bunx convex dev` runs.
- **Breaking change for existing clones** — anyone who already cloned and built on the launchpad model will need to adapt. This is expected for a starter template redesign.

## 12. Acceptance Criteria

### Landing Page

- [ ] Landing page renders as a single centered hero section with badge, heading, subheading, and two CTAs
- [ ] No feature grids, status cards, or setup instructions on the landing page

### Data Model & Backend

- [ ] `projects` and `tasks` tables exist in Convex schema with correct indexes
- [ ] Projects CRUD (list, get, create, update, remove) works with owner isolation
- [ ] Tasks CRUD (listByProject, create, update, remove) works with owner + project authorization
- [ ] Cascade delete: removing a project deletes all its tasks

### Dashboard — Sidebar

- [ ] Sidebar renders on the left side of the dashboard, full viewport height
- [ ] Collapse/expand toggle at the top of the sidebar works — sidebar transitions between expanded (256px) and collapsed (64px) states
- [ ] Collapsed sidebar shows only icons (collapse toggle, folder icon, user avatar)
- [ ] "Projects" heading is clickable and collapses/expands the project list (accordion)
- [ ] "+" button in the Projects header opens the "Create Project" dialog
- [ ] Project list shows all user's projects, with the selected one highlighted
- [ ] When no projects exist, sidebar shows "No projects" text
- [ ] Clicking a project in the sidebar selects it and updates the main content area
- [ ] User profile section is pinned to the bottom of the sidebar
- [ ] User profile shows avatar, name, and email when expanded; avatar only when collapsed
- [ ] User profile dropdown includes "Sign out" option that works correctly

### Dashboard — Main Content Area

- [ ] When no project is selected, main area shows a centered empty state with a "Create project" CTA
- [ ] When a project is selected, main area shows: project header (name, description, edit/delete buttons) and task list
- [ ] Edit project dialog allows updating name and description
- [ ] Delete project shows a confirmation dialog and cascades to delete all tasks
- [ ] Task list shows tasks for the selected project with tab filtering (All / To do / In progress / Done)
- [ ] "Add task" button opens a create dialog with title, description, and status fields
- [ ] Task rows show title, description (if present), status badge, and edit/delete actions
- [ ] Clicking the status icon on a task row cycles the status (quick toggle via mutation)
- [ ] Task edit dialog allows updating title, description, and status
- [ ] Task delete removes the task immediately
- [ ] "Done" tasks are visually differentiated (strikethrough, muted color)
- [ ] Progress footer shows "X of Y tasks done" with a progress bar
- [ ] Attachments section (upload panel) is present and collapsible, works unchanged

### Quality

- [ ] All existing test types pass: `bun run test`, `bun run test:unit`, `bun run test:convex`, `bun run test:e2e`
- [ ] `bun run ci:quick` passes (lint, types, tests, build)
- [ ] No references to "launchpad," "launch items," or "launch signals" remain in the codebase (except CLAUDE.md, which is updated separately)
- [ ] Dashboard looks clean and modern — no visual clutter, consistent spacing, proper use of whitespace
