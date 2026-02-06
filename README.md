# web-app-starter

[![CI](https://github.com/tkarakai/web-app-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/tkarakai/web-app-starter/actions/workflows/ci.yml)

A production-shaped monorepo starter that wires Bun, Turborepo, Tailwind, shadcn/ui, Convex, and Better Auth into a ready-to-extend foundation. It includes three Next.js apps (landing, web, admin), shared packages for UI, auth, and backend, and a comprehensive testing and CI setup.

## What this starter gives you

- **Monorepo** powered by Bun workspaces + Turborepo for orchestration.
- **Three Next.js apps**: landing page (port 3000), web app (port 3001), admin dashboard (port 3002).
- **Shared packages**: UI component library (`@repo/ui`), authentication (`@repo/auth`), Convex backend (`@repo/backend`).
- Convex for database, file storage, and API functions (queries/mutations/actions).
- Better Auth wired to Convex, including Next.js route handlers and client hooks.
- Tailwind v4 + shadcn/ui styling with a bold, modern interface.
- Sample launch dashboard with realtime updates and file uploads.
- Multi-tier testing: Bun unit tests, Vitest component tests, Convex backend tests, Playwright E2E.
- Local CI checks that mirror GitHub Actions, with offline Docker mode via `act`.

## Stack (latest stable)

- Next.js 16.1.5
- React 19.2.3
- TypeScript 5.9.3
- Bun 1.3.6
- Turborepo 2.5+
- Tailwind CSS 4.1.18
- shadcn/ui components (in `@repo/ui`)
- Convex 1.31.7
- Better Auth 1.4.12

## Quick start

1. Install dependencies:

```bash
bun install
```

2. Start the development environment:

```bash
bun run dev
```

This starts Convex and all three Next.js apps in local anonymous mode. On first run, it creates a `.env.local` file with a deployment name derived from your directory path.

To start only a specific app:

```bash
bun run dev:web       # Convex + web app (port 3001)
bun run dev:admin     # Convex + admin app (port 3002)
bun run dev:landing   # Landing page only (port 3000, no Convex)
```

3. Open the apps:
   - Landing page: `http://localhost:3000`
   - Web app: `http://localhost:3001`
   - Admin dashboard: `http://localhost:3002`

4. When you're done, stop everything:

```bash
bun run dev:stop
```

5. Check status of running services:

```bash
bun run dev:status
```

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

```
├── apps/
│   ├── web/                   # Main web app (@repo/web, port 3001)
│   │   ├── src/
│   │   │   ├── app/           # Next.js App Router pages
│   │   │   │   ├── (auth)/    # Authentication routes (grouped)
│   │   │   │   ├── (dashboard)/ # Dashboard routes (grouped)
│   │   │   │   └── api/auth/  # Auth API route handler
│   │   │   ├── components/    # React components (auth, launchpad, ui)
│   │   │   └── lib/           # Utility functions and helpers
│   │   └── qa/                # Testing artifacts
│   │       ├── tests/         # Unit + component tests, helpers, fixtures
│   │       └── e2e/           # Playwright E2E specs
│   ├── admin/                 # Admin dashboard (@repo/admin, port 3002)
│   │   └── src/
│   └── landing/               # Landing/marketing page (@repo/landing, port 3000)
│       └── src/
├── packages/
│   ├── backend/               # Convex backend (@repo/backend)
│   │   ├── convex/            # Schema, queries, mutations, actions
│   │   │   └── _generated/    # Auto-generated (DO NOT EDIT)
│   │   └── index.ts           # Main export
│   ├── auth/                  # Authentication (@repo/auth)
│   │   └── src/               # client.ts, server.ts, provider.tsx
│   └── ui/                    # Shared UI components (@repo/ui)
│       ├── src/               # Radix UI + shadcn/ui components
│       └── styles/            # globals.css
├── scripts/
│   ├── dev-start.sh           # Start dev environment (Convex + apps)
│   ├── dev-stop.sh            # Stop all services
│   ├── dev-status.sh          # Show running services
│   ├── ci-local.sh            # Native CI checks (bun run ci)
│   └── ci-local-act.sh        # Docker-based CI via act
├── .github/workflows/
│   ├── ci.yml                 # GitHub Actions CI/CD
│   └── security.yml           # CodeQL, dependency audit, secrets scan
├── turbo.json                 # Turborepo task configuration
└── package.json               # Root workspace definition
```

## Shared packages

### `@repo/ui` — UI Component Library

Shared Radix UI + shadcn/ui components used by all apps. Import components:

```typescript
import { Button, Input, Avatar } from "@repo/ui";
```

### `@repo/auth` — Authentication

Better Auth + Convex integration, exported as client/server/provider:

```typescript
import { authClient } from "@repo/auth/client";
import { auth } from "@repo/auth/server";
import { AuthProvider } from "@repo/auth/provider";
```

### `@repo/backend` — Convex Backend

Convex schema, queries, mutations, and actions. Import the API:

```typescript
import { api } from "@repo/backend";
```

## Run against cloud Convex + Better Auth

1. Create a Convex project in the Convex dashboard and grab the deployment URLs:
   - `https://<deployment>.convex.cloud` (API)
   - `https://<deployment>.convex.site` (site proxy)
2. Set your local `.env.local` to the cloud values:

```env
CONVEX_DEPLOYMENT=dev:<your-deployment>
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
NEXT_PUBLIC_SITE_URL=https://your-app-domain.com
```

3. Configure Convex env vars for that deployment:

```bash
bunx convex env set BETTER_AUTH_SECRET $(openssl rand -base64 32)
bunx convex env set SITE_URL https://your-app-domain.com
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

## Sample functionality

- Launch items are stored in Convex and stream into the dashboard in realtime.
- File uploads use Convex storage and show uploaded assets immediately.
- Better Auth sessions are used in both the client UI and server-side checks.

## Tests

Run tests via Turborepo (from the project root):

```bash
bun run test            # Bun unit tests (across all workspaces)
bun run test:unit       # Vitest component tests
bun run test:convex     # Convex backend tests
bun run test:e2e        # Playwright E2E tests
bun run test:all        # All of the above
```

> **WARNING**: Always use `bun run test` (with `run`), never bare `bun test`. Bare `bun test` picks up all test files and fails because some require Vitest's DOM environment.

Run the full CI check before pushing:

```bash
bun run ci              # Full CI: lint, types, tests, build, e2e
bun run ci:quick        # Skip E2E for faster feedback
```

## Conventions

### Coding
- Keep server/client boundaries explicit. Client components include `"use client"`.
- Use Convex for all APIs (queries/mutations/actions). Next.js API routes are only for auth proxying.
- Prefer small, composable components with single responsibilities.
- Import shared packages by name: `@repo/ui`, `@repo/auth/client`, `@repo/backend`.
- UI components live in `@repo/ui`. App-specific components live in `apps/<app>/src/components/`.

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

## Development process (log)

1. Chose latest stable package versions for Next.js, React, Convex, Better Auth, and Tailwind.
2. Hand-scaffolded the Next.js app router structure with Bun scripts.
3. Implemented Tailwind v4 + shadcn/ui primitives and a bespoke UI theme.
4. Wired Convex schema, queries, mutations, and file storage.
5. Integrated Better Auth with Convex and set up the auth route handler.
6. Built the launch dashboard demo with realtime queries and uploads.
7. Added multi-tier testing: Bun, Vitest, convex-test, Playwright.
8. Documented setup steps, conventions, and references.
9. Converted to monorepo with Bun workspaces + Turborepo: extracted `@repo/ui`, `@repo/auth`, `@repo/backend` as shared packages and set up three Next.js apps (landing, web, admin).

## References consulted

- Better Auth Next.js integration: https://better-auth.com/docs/integrations/next
- Better Auth + Convex integration: https://better-auth.com/docs/integrations/convex
- Convex docs: https://docs.convex.dev/home
- Tailwind CSS Next.js install guide: https://tailwindcss.com/docs/installation/framework-guides/nextjs
- shadcn/ui installation: https://ui.shadcn.com/docs/installation/next
- Turborepo docs: https://turbo.build/repo/docs

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
- For management, build admin-only Convex functions that call `authComponent` APIs or Better Auth server APIs.

### Environment differences

- Local env uses `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` pointing to localhost ports. Ports are dynamically assigned per deployment and automatically updated in `.env.local` by `bun run dev`.
- Cloud env uses `https://<deployment>.convex.cloud` (API) and `https://<deployment>.convex.site` (site proxy).
- `NEXT_PUBLIC_SITE_URL` and the Convex `SITE_URL` env var should match your app URL for each environment.

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

- `NEXT_PUBLIC_CONVEX_URL` = where your app sends requests.
- `bun run dev` (local) / `bunx convex deploy` (cloud) = how local code is pushed to that backend.

## Environment conventions

This repo does not enforce a naming scheme, but the following conventions are clear and common:

- Fully local (app + Convex local): `.env.local` (managed automatically by `bun run dev`)
- Hybrid (app local + Convex cloud): `.env.cloud`
- Fully cloud (app + Convex cloud): `.env.production` (or provider env vars)

### Example: fully local

```env
CONVEX_DEPLOYMENT=anonymous:<deployment-name>
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:<cloud-port>
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:<site-port>
NEXT_PUBLIC_SITE_URL=http://localhost:3001
```

Note: `bun run dev` automatically manages these values. Ports are dynamically assigned per deployment.

### Example: hybrid (local app + cloud Convex)

```env
CONVEX_DEPLOYMENT=dev:<deployment>
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
NEXT_PUBLIC_SITE_URL=http://localhost:3001
```

### Example: fully cloud

```env
CONVEX_DEPLOYMENT=prod:<deployment>
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
NEXT_PUBLIC_SITE_URL=https://app.example.com
```

## Notes

- `packages/backend/convex/_generated` contains a stub to keep TypeScript happy before you run Convex dev. Convex will regenerate the file with full types.
- If you upgrade Tailwind or shadcn/ui, revisit `packages/ui/tailwind.config.ts` and `packages/ui/styles/globals.css` to align with new theming defaults.
