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

## Change workflow

Before editing, inspect the current branch and the live GitHub default branch. Create and
switch to a task branch for adoption and app changes, then open a draft PR early. Never
commit or push app work directly to the default branch without explicit owner authorization.
Adoption refuses the default branch unless the owner explicitly authorizes
`--allow-default-branch`; `--yes` alone is not an override.

Follow the existing `PLATFORM_CI_PR_E2E` ready/label policy in
[platform/AGENTS.md](platform/AGENTS.md): run full local CI with E2E before readying a private PR
or adding `run-e2e`, and before merge in every mode. An owner or independent reviewer
decides the merge; opening a PR does not grant standing merge authority.

## Our conventions

- Build features through the platform skills and `platform/docs/`. Never edit `platform/` for an
  app feature; if a feature needs a platform change, raise it with the platform maintainers.
- Keep sample-domain code (projects, tasks, files) small and conventional: it is copied.

## Upgrading the platform

Before diagnosing or changing update delivery, inspect the app-owned `.github/update-delivery.json`
and run `bun run platform:setup-updates --check --json`. Intent and live readiness are separate;
For updater job machines, preserve existing routing or explicitly choose `--workers hosted|local`;
local setup tests both Docker installations before enabling them. Read the worker section in
`platform/docs/setup-updates.md`. Never substitute ordinary CI routing or infer live readiness from a saved choice.
missing credentials do not select fallback. See `platform/docs/setup-updates.md`. Preserve
credentials, caller customisations and auto-merge intent. Obtain explicit owner consent before
switching identities or enabling repository-wide permissions. An existing update branch must
be resumed from its saved report with `--relocate`; do not merge report-only drafts.

An app built from this repository takes newer platform releases with `platform/UPGRADING.md`;
read `platform/CHANGELOG.md` for the release you are taking.
The upgrade verifies the app's final `bun.lock` online before recording its new baseline.
If retained transitive versions fail that audit, follow the scoped repair and resume steps in
`platform/UPGRADING.md`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
