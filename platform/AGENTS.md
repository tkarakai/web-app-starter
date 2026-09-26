# Building on the platform

This file is the platform's usage guide for coding agents and developers. It describes the
platform version installed in this repository and is replaced on every platform upgrade, so it
always matches the installed code. Your app's own guide is the root `AGENTS.md`.

Detail lives in [`platform/docs/`](docs/) and in platform skills. Read a topic guide before
working in its area; they are not loaded automatically.

## Stack

A **Bun workspaces + Turborepo** monorepo:

- **Next.js 16** apps on **React 19** (App Router, Server Components), **TypeScript** strict mode
- **Convex** backend (database, file storage, API functions) in `packages/backend`
- **Better Auth** wired to Convex (`@web-app-starter/auth`)
- **Radix UI + shadcn/ui** primitives and **Tailwind CSS v4** (`@web-app-starter/design-system`)
- **Internationalization** via `@web-app-starter/i18n` and next-intl: 15 languages including RTL

## The platform zone

- **`platform/` is platform-owned.** Anything under a directory named `platform/`, and any file
  named `platform-*` (including `.claude/skills/platform-*` and `.agents/skills/platform-*`), is
  replaced wholesale on upgrade. Don't edit it: your change would be lost. Today the zone holds
  this guide, `platform/docs/` and `platform/agent-skills/`; platform code moves into it in a
  later release.
- **Seams** are the files where your app meets the platform. Edit them, and keep the platform's
  entries intact:

  | Seam | Use it to |
  |---|---|
  | `app.config.ts` | Set product name, legal entity, support email, local ports, auth cookie prefix, brand and feature switches (`platform-configure`) |
  | `packages/backend/convex/schema.ts` | Add your tables next to the platform's (`platform-add-table`) |
  | `packages/i18n/messages/*.json` | Add your strings in your own namespaces (`platform-add-strings`) |
  | Root `package.json`, `turbo.json`, `renovate.json` | Add scripts, tasks, env declarations, dependency rules |
  | Each app's `.env.example` | Declare the environment variables your code reads |

- **Everything else is yours**, including the reference apps you keep.

## App configuration

The root `app.config.ts` holds every value an app is expected to change: `identity` (product
name, legal entity, support email), `runtime` (local port per app, Better Auth cookie prefix),
`brand` (icons, design-token overrides, email palette, `lang` and footer) and `features`
(`waitlist`, `invitations`, `announcements`, `environmentBanner`). It is validated on load; a bad
or unknown value stops dev, build and tests with a message naming it. Everything in it is public.

- Never write these values as literals. In TypeScript use `appConfig` (and `localAppOrigin`) from
  `@web-app-starter/app-config`; take cookie names from `@web-app-starter/auth/cookies` (`sessionCookieNames()`,
  `isSessionCookie()`); in shell scripts and CI use `scripts/app-config.ts`
  (`eval "$(./scripts/node-ts.sh scripts/app-config.ts shell)"` gives `APP_CONFIG_*` variables;
  the `setup-bun` action exports them in CI).
- The product name is never in `packages/i18n/messages`: messages that mention it take a
  `{productName}` argument, filled from `appConfig.identity.productName`.
- Per-deployment values (deployed URLs, Convex URLs) and secrets stay environment variables.
- Changing `authCookiePrefix` signs every existing user out.

Details: [docs/development.md](docs/development.md#app-configuration-appconfigts).

## Commands

```bash
bun run dev                  # Convex + core apps; seeds admin@admin.com and user@user.com
bun run dev:web              # Convex + web            bun run dev:admin      # Convex + admin
bun run dev:landing          # landing                 bun run dev:landing-static
bun run dev:storybook        # storybook               bun run dev:status / dev:stop / dev:nuke-all

bun run ci                   # Full local CI: lint, types, tests, build, E2E
bun run ci:quick             # Same without E2E
bun run lint                 # ESLint, all workspaces
bun run typecheck            # TypeScript, all workspaces
bun run test                 # Bun unit tests      (never bare `bun test`)
bun run test:unit            # Vitest component tests
bun run test:convex          # Convex backend tests
bun run test:e2e             # Playwright E2E (see README "Tests" for browser setup)
bun run build                # Production build via Turborepo
```

Ports are `runtime.ports` in `app.config.ts`. Development servers and seed accounts: [docs/development.md](docs/development.md).

## Conventions

### Imports

| Package | Import |
|---|---|
| `@web-app-starter/design-system` | `import { Button, cn } from "@web-app-starter/design-system"`; styles: `@web-app-starter/design-system/styles/globals.css` |
| `@web-app-starter/auth` | `@web-app-starter/auth/client` (`authClient`), `@web-app-starter/auth/server` (`auth`, `isAuthenticated`, ...), `@web-app-starter/auth/provider` |
| `@repo/backend` | `import { api } from "@repo/backend"` |
| `@web-app-starter/i18n` | Locale config and navigation; translations via `next-intl` (`useTranslations`, `getTranslations`) |
| `@web-app-starter/edge-rate-limit` | Edge rate limiting in `proxy.ts` |

Within an app, `@/` is an alias for its `src/`. It is app-internal only; use `@repo/` names across
packages.

### File naming

| Type | Convention | Example |
|---|---|---|
| Component | kebab-case.tsx | `user-avatar.tsx` |
| Page | `page.tsx` in a kebab-case folder | `apps/web/src/app/[locale]/(dashboard)/dashboard/settings/page.tsx` |
| Utility | camelCase.ts | `formatDate.ts` or `format.ts` |
| Test | same name + `.test.ts(x)` | `format.test.ts`, `button.test.tsx` |
| E2E test | descriptive `.spec.ts` | `auth-flow.spec.ts` |
| Convex module | camelCase.ts | `launchItems.ts` |

### Code

- Strict TypeScript: explicit types, no `any`, `const`/`let` only (never `var`).
- Server Components by default; a Client Component starts with `"use client"`. Server
  Components cannot use hooks or browser APIs; Convex functions run on the server and have no
  browser APIs either.
- User-visible text in web, landing and landing-static comes from locale messages, including
  errors, placeholders, accessible labels and metadata. Admin is English-only.
- No `console.log` debugging left behind; handle errors explicitly.

## Rules

**Do not:**

- Run bare `bun test`. It picks up Vitest DOM tests and fails; use `bun run test`.
- Edit `packages/backend/convex/_generated/`; Convex generates it.
- Use `npm` or `yarn`; Bun is the package manager.
- Add Python or other scripting languages. Scripts are TypeScript run on Node through
  `scripts/node-ts.sh` (Node 22.6+); shell wrappers are fine.
- Use `turbo dev`; `bun run dev` manages ports, Convex and `.env.local`.
- Test Server Components with Vitest; use Playwright E2E.
- Commit `.env.local`; `.env.example` is the template.
- Rewrite published history: no reset, rebase, force-push or moved refs on shared branches.
- Edit anything under `platform/`.

**Be careful:**

- `convexTest()` in this monorepo needs the module glob: `convexTest(schema, import.meta.glob("./**/*.*s"))`.
- A protected web page must live under `src/app/[locale]/(dashboard)/dashboard/` to get the proxy,
  layout and client guards ([docs/architecture.md](docs/architecture.md)).
- Schema changes that remove, rename or narrow need a widen/migrate/narrow sequence
  ([docs/convex-migrations.md](docs/convex-migrations.md)).

## Environment variables

`web` and `admin` read their configuration **unprefixed, at request time**, so one build can be
promoted between environments. A `NEXT_PUBLIC_*` read would be inlined at build time and pin the
artifact to one environment.

| Variable | Description | Apps |
|---|---|---|
| `CONVEX_DEPLOYMENT` | Convex deployment identifier | all |
| `CONVEX_URL` | Convex API URL | web, admin |
| `CONVEX_SITE_URL` | Convex HTTP actions URL | web, admin |
| `LANDING_URL` | Marketing site URL, for cross-app links | web |

`landing` and `landing-static` are static exports (`output: "export"`) with no server, so they
**must** inline their configuration at build time:

| Variable | Description | Apps |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | This app's public URL | landing, landing-static |
| `NEXT_PUBLIC_WEB_APP_URL` | Web app URL, for cross-app links | landing, landing-static |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex HTTP actions URL | landing |

Build-identity variables keep the `NEXT_PUBLIC_` prefix everywhere, because they describe the
build: `NEXT_PUBLIC_GIT_SHA`, `NEXT_PUBLIC_GIT_BRANCH`, `NEXT_PUBLIC_DEPLOY_TIMESTAMP`,
`NEXT_PUBLIC_BUILD_ID`, `NEXT_PUBLIC_APP_NAME`. The dev environment banner lists every
`NEXT_PUBLIC_*` variable present, including legacy names still set on Vercel projects; web and
admin don't read those.

`SITE_URL` belongs to Convex: a comma-separated list of trusted origins, set with
`convex env set`. `web` and `admin` derive their own origin from the request `Host` header.

**Adding a runtime variable** takes three places: the app's `.env.example`, the hosting project,
and `turbo.json`: `passThroughEnv` if read at request time (web, admin), `env` if inlined at build
time (landing, landing-static). A runtime variable in `env` makes the build hash
environment-specific and silently breaks artifact reuse
([docs/deployment-architecture.md](docs/deployment-architecture.md#artifacts-are-content-addressed)).
`bun run dev` manages `.env.local` for local development.

## Topic guides

| When you are... | Read |
|---|---|
| Writing or changing tests (unit, component, E2E, backend) | [docs/testing.md](docs/testing.md) |
| Working on CI, GitHub Actions, act or offline mode | [docs/ci.md](docs/ci.md) |
| Writing components, Convex functions or styles | [docs/code-style.md](docs/code-style.md) |
| Working on auth, route protection, rate limiting or React patterns | [docs/architecture.md](docs/architecture.md), [docs/authentication-and-onboarding.md](docs/authentication-and-onboarding.md), [docs/rate-limiting-architecture.md](docs/rate-limiting-architecture.md) |
| Setting up or debugging the dev environment | [docs/development.md](docs/development.md) |
| Working on i18n, locales, translations or RTL | [docs/i18n-architecture.md](docs/i18n-architecture.md) |
| Recording or reading audit events | [docs/audit-trail-architecture.md](docs/audit-trail-architecture.md), [docs/audit-trail-event-inventory.md](docs/audit-trail-event-inventory.md) |
| Changing schemas or running migrations | [docs/convex-migrations.md](docs/convex-migrations.md) |
| Deploying, promoting, rolling back, or adding env vars | [docs/deployment-architecture.md](docs/deployment-architecture.md), [docs/deployment-runbook.md](docs/deployment-runbook.md), [docs/ops-cli.md](docs/ops-cli.md) |
| Hosting on AWS instead of Vercel (`infra/aws`) | [docs/aws/deployment-architecture-aws.md](docs/aws/deployment-architecture-aws.md); Convex stays on Convex Cloud |
| Updating dependencies, Renovate, or the Node/Bun baseline | [docs/dependency-updates.md](docs/dependency-updates.md), [docs/dependency-migrations.md](docs/dependency-migrations.md) |
| Taking a newer platform release | `UPGRADING.md` and `CHANGELOG.md` at the repository root |

## Skills

Platform skills live in [`agent-skills/`](agent-skills/) and are linked into `.claude/skills/` and
`.agents/skills/`, so Claude Code and Codex list them. Use the matching skill when a task fits:

| Skill | Use it to |
|---|---|
| `platform-configure` | Set name, ports, cookie prefix, brand and feature switches in `app.config.ts` |
| `platform-add-table` | Add an app table: schema, indexes, functions, tests |
| `platform-add-page` | Add a protected page with a nav entry, strings and tests |
| `platform-add-strings` | Add translated strings in an app namespace to every locale |
| `platform-deps` | Update the app's dependencies (Renovate queue, majors, lockfile) |
| `platform-pr-review` | Review a pull request and comment |
| `platform-pr-respond` | Address review comments on a pull request |

## Verification

Before pushing, run `bun run ci` (or `bun run ci:quick` to skip E2E). Keep `lint`, `typecheck` and
the test suites green.
