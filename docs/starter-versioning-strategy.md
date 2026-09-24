# Delivering starter updates to business apps

Status, 2026-09-23: **Phase 0 is implemented** (`VERSIONING.md`, `UPGRADING.md`,
`CHANGELOG.md`, `scripts/release.sh`), and one versioned package is upgraded end
to end in the demo app. Phases 1–3 below are a proposal; no decision has been taken.

The first part of this document describes what works today. The second part,
[Long-term plan](#long-term-plan), explains the problem, what other starters do,
and the proposed direction.

## Current support

Most business apps receive starter changes by merging a reviewed git release tag.
[`VERSIONING.md`](../VERSIONING.md), [`CHANGELOG.md`](../CHANGELOG.md) and
[`UPGRADING.md`](../UPGRADING.md) define that process.

One package-based example is implemented: `@repo/starter-sidebar-policy`.
The standalone demo consumes a versioned local package artifact. Its additional
upgrade test starts with a historical package, reproduces a regression, upgrades
and verifies the app without replacing its custom UI or business behavior.
See [the executable contract](starter-upgrades.md).

This is not registry publishing or repository-wide ownership isolation. No
backend, schema, locale or operations migration is implied by the example.

## Separate three responsibilities

1. **Starter maintainers release an update.** They define versions, affected areas,
   urgency, required actions and verification, then retain rehearsal evidence.
2. **Application teams adopt it in an upgrade PR.** They preserve application-owned
   code, carry out required actions and verify their own behavior.
3. **Operations deploys the resulting application commit.** Operations can present
   available releases, applications behind them, urgency and readiness. It must
   not rewrite source or run hidden migrations during deployment.

[UPGRADING.md](../UPGRADING.md#three-separate-responsibilities) explains the owner,
inputs, outputs, boundaries and an end-to-end example for each responsibility.
The operations implementation is separate and unchanged by this work.

## Choose ownership by how code is maintained

| Category | Intended update mechanism | Present status |
|---|---|---|
| Consumed starter package | Change a versioned dependency; use public exports rather than edit its files | Demonstrated and checked for the sidebar policy only, using immutable local artifacts |
| Application-owned | Application team owns its source; starter notes or reviewed transformations can help adopt API changes | Demo business rules, UI, branding, configuration and tests |
| Generated | Recreate with the owning build/code-generation tool | Explicit fixed demo output list; not a way to hide source |
| Intentionally vendored starter code | Copy selected components with recorded origin, then compare and review later updates | Unsupported pending an explicit registry/copy contract; no current demo path claims this category |

A copy with historical starter/shadcn origins is not automatically supported
vendoring. The demo's editable visual components are application-owned. A managed
package cannot be made editable by silently relabeling it; that would discard its
update guarantees. [Transition preconditions](starter-upgrades.md#copying-a-package-into-editable-code)
explain what a future supported copy process must record and test.

## Existing areas that still mix ownership

- `packages/backend/convex/schema.ts` contains both shared tables and the example
  `projects`, `tasks` and `uploads` tables. It is not a replaceable package boundary
  for applications adding their own domain data.
- `packages/i18n/messages/` combines shared and business/example content. Updating
  shared text must preserve application keys and translations.
- `packages/design-system` and `packages/design-patterns` contain components that
  applications may need to customize. They are candidates for an editable-copy
  contract, not proof that such a contract already exists.
- Branding and infrastructure configuration still require application-specific
  merge review outside the demo's isolated policy upgrade.

`scripts/starter-upgrade/ownership.json` identifies these legacy mixed areas. The
checker verifies the new package and demo; it deliberately does not certify the
rest based on directory names alone. Other workspace packages remain outside the
implemented upgrade contract too.

## Long-term plan

### The problem

Business projects clone this repo and start there. From the first commit they are
disconnected: a security fix, an auth hardening, or a new feature added here
reaches them only if somebody notices and copies it over by hand. As the number of
business projects grows, that cost grows with it, and the projects drift further
from the starter, which makes each later copy harder.

The usual framing is a choice between two options: a template you copy and own
(the shadcn approach) or a versioned dependency you install (the framework
approach). Both are wrong for *some* parts of this repo and right for others. This
plan proposes a third option: **group the code by how it changes, and give each
group its own update method.**

### What this repo contains

Measured on `main` at `4b8c546`:

| Area | Files | Lines |
|------|-------|-------|
| `apps/admin` | 127 | 16,790 |
| `packages/backend` | 70 | 17,697 |
| `apps/web` | 98 | 11,949 |
| `apps/storybook` | 80 | 7,894 |
| `packages/design-system` | 58 | 6,928 |
| `scripts/` | 13 | 4,016 |
| `.github/` | 16 | 3,037 |
| `apps/demo`, `landing`, `landing-static` | 82 | 4,585 |
| `packages/auth`, `i18n`, `edge-rate-limit`, `design-patterns` | 38 | 848 |

That is about 64,000 lines across 6 apps and 6 packages. The SaaS starters that
rely only on "fork and merge" (supastarter, Makerkit, fullstackhero) are much
smaller and mostly a single app. **Our size is why their approach is not enough
for us**, and also why a better approach is worth the effort here.

Three facts decide what is possible:

**1. The example domain is small and already separate.** Only six files use
`api.projects` / `api.tasks`, all under `apps/web/src/components/projects/` and
`dashboard-client.tsx`. The `projects`, `tasks` and `uploads` tables are three of
eleven in `schema.ts`. The rest (`userProfiles`, `adminEmails`, `appSettings`,
`waitlistEntries`, `invitationTokens`, `adminInvitations`, `announcements`,
`auditTrail`) is shared platform code. So a business app throws away very little
and wants to keep receiving about 90% of the repo.

**2. We already use a Convex Component.** `packages/backend/convex/convex.config.ts`
calls `app.use(betterAuth)`, and `betterAuth/` has its own `schema.ts` and
`_generated/`. A Convex Component owns its tables and functions, Convex enforces
that separation, and upgrading a component does not rewrite the host app's tables.
The backend is normally the hardest part to distribute, and the mechanism for it is
already in use.

**3. Three shared files make every upgrade conflict.** Each of these is edited by
both the starter and every business app, so each one causes merge conflicts on
every upgrade:

- **The product name is typed out in 29 files**: `apps/admin` sign-in,
  forgot-password, reset-password, onboarding, `layout.tsx`, `admin-sidebar.tsx`,
  landing footers, `packages/backend/convex/auth.ts`, e2e specs, and all 15 locale
  files. Every business app changes all 29 on day one.
- **One `schema.ts` holds both platform and app tables** (179 lines, 11 tables). A
  business app adding tables edits the same file we edit. The file already combines
  table groups with object spread (`...rateLimitTables`, `migrationsTable`), so
  splitting it is straightforward; we just don't do it for our own tables yet.
- **i18n is 7,330 lines across 15 locales with no separation.** App text and
  platform text are in the same JSON objects, so a key added by the app conflicts
  with a key added by the starter, in all 15 files at once.

None of these are hard to fix. They should be fixed before any other update
method, because an update method that still produces these conflicts does not
solve the problem.

### How other starters handle updates

**Adding the starter as a git remote and merging it** is what almost every SaaS
starter recommends, and all of them say it gets harder over time.

- *supastarter*: `git remote add upstream …` then `git pull upstream main
  --allow-unrelated-histories --rebase`. Their docs say that "with every change you
  make to your application, it will become harder to update your code base."
- *Makerkit*: the same git workflow, plus a Turborepo layout (`packages/features`,
  `packages/ui`) so app work happens in app code and the core packages stay
  untouched. The folder structure does most of the work, not git.
- *TurboStarter*: the closest match to us (Turborepo, shared `auth` / `billing` /
  `db` / `api` packages). It **recommends merge over rebase**, unlike supastarter.
  It names the lockfile as the one known conflict, with the right fix (take either
  side, never edit it by hand, reinstall), and runs `lint` + `typecheck` after the
  merge. It does not say where business code should live.
- *fullstackhero*: the most complete. Releases are merged by tag
  (`git merge v10.1.0`), the changelog lists required actions, and there are clear
  rules: put your code in your own `Modules.{YourName}`, don't edit the shared
  `BuildingBlocks`, and use extension points instead of editing shipped modules.
  Their summary fits us: *"taking upstream fixes is a git workflow, not a package
  bump"*, because they ship source you own rather than packages.

**"Lifetime updates" as a license term.** *ShipFast* sells lifetime updates, but
that only means continued access to the repo: no merge tooling, no versions, no
upgrade guide. It suits solo founders building one small app, where the starter is
a starting point you leave behind. Our situation is the opposite on every point.

**The official Next.js SaaS Starter** (Next + Postgres + Stripe + shadcn) has no
update process at all. It shows current patterns and is meant to be thrown away.
Vercel delivers framework updates through versioned packages and `@next/codemod`
instead. Everything that must stay up to date lives in a package, so nobody needs
to merge the template. That is the same split proposed below.

**Copying components from a registry** is shadcn's approach. shadcn CLI 3.0 added
**namespaced registries**: `components.json` maps `"@acme": "https://acme.com/r/{name}.json"`,
with optional auth headers and private hosting. Any server that returns the right
JSON is a registry, so a company can serve its own components privately.

**Publishing a diff between versions** is React Native's approach (the Upgrade
Helper): generate a clean project at version A and version B, diff them, and
publish the diff with notes per file. It merges nothing; it shows a person exactly
what changed in files that every project rewrites.

**Codemods** are the framework approach. Angular's `ng update` runs migrations that
rewrite code through the TypeScript AST; Rails' `app:update` regenerates config and
shows the diff. Breaking changes are acceptable when the migration ships as code.

No starter does all four. The ones that only merge are small. We are not, so we
should borrow from the framework approaches as well.

**Merge or rebase?** Merge. Rebasing replays every business-app commit on top of
the new starter code, so an app with 300 commits of its own can hit the same
conflict many times, and it rewrites history that the team has already pushed. A
merge resolves each conflict once and keeps everyone's checkouts valid.

### Proposal: match the update method to the kind of code

Ask two questions of each part of the repo: how often do *we* change it, and how
often does a *business app* need to change it? The answers pick the update method.
These are the same ownership categories used in
[Choose ownership by how code is maintained](#choose-ownership-by-how-code-is-maintained).

#### Consumed starter packages: versioned dependencies, never edited by the app

Business apps install these as versioned dependencies and never edit the files.
Renovate already runs in this repo; in a business app it opens the upgrade PRs.
A security fix arrives as a PR that CI checks, and it cannot conflict because the
app never changed the code.

Candidates, all already independent of any app:

- `@repo/edge-rate-limit` (157 lines, no app dependencies; the easiest first step)
- `@repo/auth` (264 lines, configuration only)
- `@repo/i18n` runtime (config, request, navigation; not the message files)
- Backend platform code as **Convex Components**: `auditTrail*`, `securityPolicies`,
  `rateLimits`, `tokenHash`, `passwordStrength`, `parseUserAgent`,
  `adminInvitations`, `waitlist*`, `announcements`, `appSettings`
- CI as **reusable workflows**. GitHub Actions supports
  `uses: org/web-app-starter/.github/workflows/ci-shared.yml@v2`. The 3,037 lines of
  workflow would no longer be copied; a business app keeps a ten-line caller. This
  gives the most value for the least work.
- `scripts/` (4,016 lines) as a published CLI: `starter dev`, `starter ci`

This group matters most for security: a fix in rate limiting or token hashing
becomes a version bump that Renovate proposes in every business app.

`@repo/starter-sidebar-policy` is the first package handled this way; see
[Current support](#current-support).

#### Editable copies: copied from a registry, then owned by the app

The 42 design-system components and `@repo/design-patterns`. Business apps
*must* restyle these. If they were locked in a dependency, teams would copy the
source anyway and stop taking updates. But copying once and never updating loses
accessibility and behavior fixes.

Serve them from a private shadcn-compatible registry under a `@starter` namespace.
A business app runs `shadcn add @starter/sidebar` to take a component and
`starter diff sidebar` to see what changed since. The decision is made per
component, with no repo-wide merge. This category is not supported yet; see
[Design editable component copying](#design-editable-component-copying).

#### Application-owned starting code: copied once, never synced

App shells (`apps/web` dashboard, `apps/admin` pages, landing content), the example
domain (`projects` / `tasks` / `uploads`), and text. Every business app rewrites
these, so merging them only creates conflicts nobody wants.

Share changes as information instead of merges:

- A published diff between versions, as React Native does: create a clean app at
  v1.4 and v1.5 and publish the diff with notes. The team reads it and decides.
- **Codemods shipped with breaking releases.** When an auth interface changes,
  ship the code that updates callers, not just a description.
- `UPGRADING.md` and a changelog with an **Action required** section per release,
  as fullstackhero does.

#### Shared release process for all three

- **Version the repo.** Tag releases, keep a real changelog, define how long an
  older major gets security fixes and how many majors we allow per year. Done in
  Phase 0; see `VERSIONING.md`.
- **A per-app record of starter versions**, so a `starter doctor` command can
  report how far behind an app is and CI can warn when a security-relevant package
  falls too far behind. The demo's `starter-upgrade.json` and lock file are a first
  version of this for one package.
- **A `create-business-app` CLI** that creates the app-owned code, adds the
  package dependencies and sets the product name, instead of "clone and start
  deleting."
- **An app in this repo that uses the starter the way a business app does**, so
  starter CI catches business-app breakage before a release. `apps/demo` now does
  this for the sidebar policy package, in addition to being the demo app.
- **A supported way to stop using a package** ("eject") for every consumed
  package. Teams that cannot leave a package will copy its source and stop taking
  any updates. A documented exit keeps them on the other update methods.

### Order of work

These groups are the goal, not the first step. In order of value for effort:

**Phase 0: works today, no refactor. Done.** Version and tag the repo, write
`UPGRADING.md` and a changelog with **Action required** sections, document the git
remote workflow, and ask existing business apps to add the remote. This matches
supastarter, Makerkit, TurboStarter and fullstackhero, costs days rather than
weeks, and is better than no process.

We copied their specifics rather than inventing new ones: merge by tag, never
rebase; treat `bun.lock` as a known conflict (take either side, never edit it by
hand, run `bun install`); run `bun run ci:quick` after the merge. The
**Action required** notes are written for coding agents as well as people, because
`CLAUDE.md` and `.claude/commands/` mean agents do some of the merging.

**Phase 1: separate the shared files.** The three problems above, in this order:

1. **Product name in one place.** One `starter.config.ts`; all 29 files read the
   name from it. This removes the largest source of conflicts.
2. **Split the schema.** Divide `schema.ts` into `platformTables` and `appTables`
   using the spread pattern the file already uses. Needed before the Convex
   Component work.
3. **Separate i18n keys.** Reserve a `starter.*` key prefix for platform text,
   leave the rest to the app, and split the message files along that line.

Each change needs a customized app and regression tests that prove the app's data
and edits survive. The current schema and locale structure cannot prove that yet.

Also in this phase: write down who owns what. fullstackhero's rule ("don't edit the
shared modules, create your own") is cheap to state. `AGENTS.md` is the natural
place, so coding agents in business apps follow it too.
[`docs/starter-upgrades.md`](starter-upgrades.md) now does this for the demo.

**Phase 2: publish consumed packages.** Reusable CI workflows first (largest gain,
lowest risk, no code moves). Then `@repo/edge-rate-limit` to GitHub Packages to
prove the publishing process. Then the backend platform as Convex Components,
which is the biggest piece and needs the schema split first.

For each candidate package, define its public exports, dependencies, version
policy, supported starting versions and required upgrade tests before adding it to
the upgrade commands. Decide registry access and publishing separately from the
local package test. Use Convex Components or reusable workflows only where they
really separate the code, not just rename a directory.

**Phase 3: editable-copy registry and tooling for app-owned code.** The component
registry, the published diff, the codemod tooling and `starter doctor`.

Phases 0 and 1 remove most of the risk. Phases 2 and 3 are needed once there are
more than a handful of business apps.

#### Design editable component copying

Before any component is supported as an editable copy, specify: the registry/copy
format, license and dependency contents, the origin version and hash, where the
editable copy goes, the commands that compare it with newer versions, and who is
responsible for security updates. Moving a component from a consumed package to an
editable copy must be a reviewed change that removes the package dependency for
that component, updates the ownership records and invalidates the old package
verification results. Do not label anything as a supported editable copy before
this works end to end.

#### Operations view of upgrade status

Once the upgrade commands are stable, operations may read their output to show
available releases, urgency, each app's version and whether it is ready to
upgrade. Operations deploys the approved app commit through the existing staging
and production process; it never combines source changes with deployment.
Operator commands and approvals are outside this work.

### How to measure progress

For each additional package or copy process, require: a real customized app that
uses it, an unchangeable historical starting version, a reproduced failure, a
successful upgrade, proof that required actions ran, and tests that reject writes
to files the upgrade must not touch. Passing a typecheck or resolving merge
conflicts is not enough.

The demo meets these checks for the sidebar policy. Run:

```bash
bun run check:starter-ownership
bun run test:starter-upgrade
bun run test:starter-rehearsal
```

### Trade-offs

**This moves work from business apps to this team.** Publishing packages means
release discipline, a deprecation policy, and supporting more than one version at
a time. That cost is only worth it if there are several business apps; for one or
two, Phase 0 alone is the right place to stop.

**Versioned dependencies limit business apps**, and some will find the limit wrong
for their case. That is what the supported exit is for. Leaving a package is an
accepted outcome, not a failure.

**The group boundaries will be wrong at first** and will change. The product-name
and schema work is useful wherever the boundaries end up, which is another reason
to do Phase 1 before Phase 2.

**Coding agents make app-owned updates cheaper.** This repo already has
`AGENTS.md` and `.claude/commands/`. Upgrade notes written for agents, and
codemods shipped as agent commands, make it much cheaper to apply changes to code
each app owns than a person reading a diff. Treat this as part of the design.

### Recommendation

Adopt the three groups as the target. Phase 0 is done. Do Phase 1 next: the three
shared files cause conflicts under *every* update method, including the one we use
today. Decide on Phase 2 once three or more business apps use the starter.

### Glossary

**Consumed starter package**: code a business app installs as a versioned
dependency and never edits. Updates arrive as version bumps.

**Editable copy** (also called *vendored* code): starter code copied into a
business app, which then owns and edits it. shadcn/ui works this way:
`shadcn add button` writes the component into your repo.

**Application-owned code**: code a business app writes or rewrites itself. The
starter only sends information about changes (notes, diffs, codemods).

**Git remote workflow**: adding the starter as a second git remote (`upstream`) in
a business app so its release tags can be fetched and merged.

**Codemod**: a script that rewrites source code to follow a breaking change,
usually by parsing it rather than with text search. Angular runs these in
`ng update`; Next.js ships `@next/codemod`.

**Drift**: the growing difference between a business app and the starter, which
makes each later merge harder.

**Eject**: a supported way to stop using a consumed package and take its source
into your app. `create-react-app eject` is the familiar example.

**Semver**: `major.minor.patch` version numbers, where a new major means "this may
break your app". See `VERSIONING.md` for the security-fix window and the limit on
majors per year.

### Sources

- [supastarter — Update the codebase](https://supastarter.dev/docs/nextjs/codebase/update)
- [Makerkit — Updating your Next.js Supabase Turbo Starter Kit](https://makerkit.dev/docs/next-supabase-turbo/installation/updating-codebase)
- [fullstackhero — Upgrading: taking upstream fixes into your own code](https://fullstackhero.net/docs/guides/upgrading/)
- [shadcn/ui — Namespaced registries](https://ui.shadcn.com/docs/registry/namespace) and [CLI 3.0 changelog](https://ui.shadcn.com/docs/changelog/2025-08-cli-3-mcp)
- [React Native Upgrade Helper](https://react-native-community.github.io/upgrade-helper/)
- [Convex — Components](https://docs.convex.dev/components) and [Authoring components](https://docs.convex.dev/components/authoring)
- [Angular — Schematics and `ng update`](https://angular.dev/tools/cli/schematics)
- [Rails — Upgrading Ruby on Rails](https://guides.rubyonrails.org/upgrading_ruby_on_rails.html)
- [GitHub Actions — Reusing workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- [TurboStarter — Updating codebase](https://www.turbostarter.dev/docs/web/installation/update)
- [ShipFast](https://shipfa.st/)
- [Vercel — Next.js SaaS Starter template](https://vercel.com/templates/next.js/next-js-saas-starter)
