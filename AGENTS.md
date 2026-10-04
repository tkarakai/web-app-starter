Before any task, read `platform/AGENTS.md`.

# web-app-starter reference apps

This repository is the web-app-starter platform together with its reference apps. The apps show
how to build a product on the platform, and are the starting point you keep, change or delete
when you build your own. This file is the app guide (it starts from
`platform/templates/AGENTS.md`); platform rules live in `platform/AGENTS.md`.

## What this product is

A sample SaaS: users sign up, create projects with tasks and file uploads, and manage their
account security. Admins onboard users and other admins, set security policy and read the audit
trail. A marketing site and a component showcase complete it.

## Apps

| App | Path | Purpose |
|---|---|---|
| web | `apps/web` | The product: auth flows, projects dashboard, account settings |
| admin | `platform/apps/admin` | Admin dashboard: onboarding, users, policy, audit trail |
| landing | `apps/landing` | Marketing site, static export with locale routes |
| storybook | `platform/apps/storybook` | Design-system showcase |
| demo | `apps/demo` | Standalone UI/dispatch demo ([README](apps/demo/README.md)) |

Each app keeps source in `src/` and tests in `qa/` (`qa/tests/` for unit and component tests,
`qa/e2e/` for Playwright). Web, admin and landing use the Convex project in
`packages/backend/convex/`; the sample domain is `projects`, `tasks` and `files`.
Landing is a static export with browser-side announcements and onboarding: it hosts the
waitlist form and links to web for authentication. Web checks onboarding on each sign-up
request and accepts waitlist submissions inline using the same form as landing. Their name, ports,
auth cookie prefix, brand and feature switches are set in `app.config.ts`.

## Our conventions

- Build features through the platform skills and `platform/docs/`. Never edit `platform/` for an
  app feature; if a feature needs a platform change, raise it with the platform maintainers.
- Keep sample-domain code (projects, tasks, files) small and conventional: it is copied.

## Upgrading the platform

Before diagnosing or changing update delivery, inspect the app-owned `.github/update-delivery.json`
and run `bun run platform:setup-updates --check --json`. Intent and live readiness are separate;
missing credentials do not select fallback. See `platform/docs/setup-updates.md`. Preserve
credentials, caller customisations and auto-merge intent. Obtain explicit owner consent before
switching identities or enabling repository-wide permissions. An existing update branch must
be resumed from its saved report with `--relocate`; do not merge report-only drafts.

An app built from this repository takes newer platform releases with `platform/UPGRADING.md`;
read `platform/CHANGELOG.md` for the release you are taking.
