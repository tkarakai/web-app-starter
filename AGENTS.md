Before any task, read `platform/AGENTS.md`.

# web-app-starter reference apps

This repository is the web-app-starter platform together with its reference apps. The apps show
how to build a product on the platform, and are the starting point you keep, change or delete
when you build your own. This file is the app guide (it starts from
`platform/templates/AGENTS.md`); platform rules live in `platform/AGENTS.md`.

## What this product is

A sample SaaS: users sign up, create projects with tasks and file uploads, and manage their
account security. Admins onboard users and other admins, set security policy and read the audit
trail. Two marketing sites and a component showcase complete it.

## Apps

| App | Path | Port | Purpose |
|---|---|---|---|
| web | `apps/web` | 3001 | The product: auth flows, projects dashboard, account settings |
| admin | `apps/admin` | 3002 | Admin dashboard: onboarding, users, policy, audit trail |
| landing | `apps/landing` | 3000 | Marketing site, static export with locale routes |
| landing-static | `apps/landing-static` | 3004 | Fully static marketing site with client-side i18n |
| storybook | `apps/storybook` | 3003 | Design-system showcase |
| demo | `apps/demo` | — | Standalone UI/dispatch demo ([README](apps/demo/README.md)) |

Each app keeps source in `src/` and tests in `qa/` (`qa/tests/` for unit and component tests,
`qa/e2e/` for Playwright). The backend for all of them is the Convex project in
`packages/backend/convex/`; the sample domain is `projects`, `tasks` and `files`.

## Our conventions

- Build features through the platform skills and `platform/docs/`. Never edit `platform/` for an
  app feature; if a feature needs a platform change, raise it with the platform maintainers.
- Keep sample-domain code (projects, tasks, files) small and conventional: it is copied.

## Upgrading the platform

An app built from this repository takes newer platform releases with `UPGRADING.md`; read
`CHANGELOG.md` for the release you are taking.
