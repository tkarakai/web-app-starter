# Delivering starter updates to business apps

Status, 2026-09-24: **Phase 0 tooling is implemented** (`VERSIONING.md`, `UPGRADING.md`,
`CHANGELOG.md`, `scripts/release.sh`), and one versioned package is upgraded end
to end in the demo app. The first starter release tag has not been published.
Localization remediation is separate maintenance, tracked in
[PR #144](https://github.com/tkarakai/web-app-starter/pull/144), and is not an
upgrade-readiness milestone.
Shared locale files and application-reviewed merges are the intended contract;
namespace/file separation is not required. Broader package extraction remains a proposal.

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

Business projects clone this repo and then diverge. Before the
[current upgrade process](#current-support), a security fix, auth hardening, or
new feature reached them only if somebody noticed and copied it over by hand.
Merge-by-tag now supports reviewed updates, but each application still has to
reconcile starter changes with its customizations. As the number of business
projects grows, so does that maintenance work.

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

**3. Shared source needs reviewed merges; UI localization is a separate concern.**

- **UI names belong in translations.** The previous 29-file inventory combined
  locale values, hardcoded UI, test expectations and a backend authenticator
  issuer. It did not establish 29 component edits or inevitable merge conflicts.
  Hardcoded user-visible strings are localization defects. Fix them through i18n,
  preserving the ability to choose an application name per locale.
- **One `schema.ts` holds both platform and app tables.** A
  business app adding tables edits the same file we edit. The file already combines
  table groups with object spread (`...rateLimitTables`, `migrationsTable`), so
  splitting it is straightforward; we just don't do it for our own tables yet.
- **The 15 locale files are intentionally shared and customizable.** Business
  apps change values, add keys and resolve overlapping changes during upgrades.
  Required starter keys and interpolation parameters must remain available.
  Separate additions can merge cleanly; a shared file does not guarantee a
  conflict. The existing resolver assists application teams with actual conflicts.

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

Candidates to investigate; being in a shared package does not prove independence
from application data, configuration or generated types:

- `@repo/edge-rate-limit` (157 lines, no app dependencies; the easiest first step)
- `@repo/auth` (review authentication behavior and host configuration contracts)
- `@repo/i18n` runtime (its current request loader imports the shared message
  files directly, so a package boundary would need an application message input)
- Backend platform code as **Convex Components**: `auditTrail*`, `securityPolicies`,
  `rateLimits`, `tokenHash`, `passwordStrength`, `parseUserAgent`,
  `adminInvitations`, `waitlist*`, `announcements`, `appSettings`
- CI as **reusable workflows**. GitHub Actions supports
  `uses: org/web-app-starter/.github/workflows/ci-shared.yml@v2`. The 3,037 lines of
  workflow would no longer be copied; a business app keeps a ten-line caller. This
  requires a downstream rehearsal: the current workflow uses relative composite
  actions and repository-specific scripts from the checked-out application.
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

#### Application-owned starting code: reviewed by the application team

App shells (`apps/web` dashboard, `apps/admin` pages, landing content), the example
domain (`projects` / `tasks` / `uploads`), and text may be customized by business
apps. Today those applications review starter tag merges, including shared locale
JSON. Owning translated values does not mean giving up future required keys or
avoiding locale merges.

Additional tools proposed to assist those reviews:

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

The earlier product-name/config and mandatory locale-split tasks are withdrawn.
Localized names, application-owned translations and reviewed JSON merges are the
normal contract, not preparation work for upgrading. The milestones below are
proposed from the implementation audit; they do not authorize publishing releases
or choosing package boundaries.

**Phase 0: release groundwork exists; first publication is pending.** Policy,
changelog, release script, upgrade instructions and an agent command exist. No
starter `v*` tags were returned by `git ls-remote --tags origin 'v*'` during this
audit. The historical tag-merge narrative is not a repeatable CI test; the current
automated rehearsal covers only the sidebar package.

**Phase 1: prove a controlled business-app upgrade using the current source model.**

1. **Establish a truthful baseline and release identity.** Record the exact
   starter commit an app came from, and the verified release tag/commit when one
   exists. Handle pre-release clones and apps without shared history explicitly;
   never assign `v1.0.0` just because it appears in an example. Disambiguate starter
   release tags from an application's own tags.
2. **Make the merge-by-tag rehearsal repeatable.** Use isolated repositories with
   fixed starting commits, an application-specific schema/function, customized UI,
   translated values and additional keys, app tests, and deployment configuration.
   Exercise a patch, an additive change, and a breaking change with required
   actions. Verify both the starter fix and the business behavior after each
   upgrade. Include ambiguous merges and incomplete actions that must prevent a
   successful result. Retain source revisions and check output in CI.
3. **Make the upgrade result reviewable.** Produce an upgrade PR with baseline and
   target commits, affected areas, reviewed conflicts, required actions and checks.
   Distinguish source adoption from deployment/migration readiness. The sidebar
   tool's `pending`/`verified` evidence is useful precedent, but does not currently
   apply to whole-repository merges.
4. **Prove the release path.** Rehearse version/changelog preparation, validation
   of the exact release commit, immutable publication from main, and downstream
   discovery. Audit `scripts/release.sh` against that path before cutting the first
   release. Publishing is a separate maintainer action.

**Phase 2: extract only boundaries justified by the rehearsal.** A schema-file
split may reduce edit overlap, but it does not by itself isolate a Convex
component or migrate data. Reusable workflows already have `workflow_call`; their
relative actions and repository assumptions still need a downstream test. Compare
these candidates with retaining reviewed source merges before selecting an order.

For each candidate package, define its public exports, dependencies, version
policy, supported starting versions and required upgrade tests before adding it to
the upgrade commands. Decide registry access and publishing separately from the
local package test. Use Convex Components or reusable workflows only where they
really separate the code, not just rename a directory.

**Phase 3: editable-copy registry and tooling for app-owned code.** The component
registry, the published diff, the codemod tooling and `starter doctor`.

Package publishing and editable-copy tooling are optional later approaches, not
prerequisites for supporting the first business-app source upgrade.

### Implementation audit: unresolved readiness gaps

| Finding | Evidence and required follow-up |
|---|---|
| Baseline examples claim a release that is not published | `UPGRADING.md` and the unreleased changelog previously instructed every app to record `v1.0.0`. A shared ancestor proves ancestry, not adoption of a later release. Define bootstrap evidence before stamping a version. |
| The general upgrade command is a prompt, not an enforced workflow | `.claude/commands/upgrade-starter.md` delegates to the guide. `scripts/starter-upgrade/model.ts` deliberately hardcodes the sidebar package and its three payload files. Do not describe it as a general business-app upgrader. |
| Locale delete/edit disagreement is silently resolved | Reproduced in a temporary Git repo: business deletes `common.label`, starter edits it, Git merge fails, but resolver `--check` exits 0 and says every file resolves cleanly. Fix and test delete/edit cases in both directions before trusting automatic resolution. |
| Locale coverage needs release-aware evidence | The catalog test checks other locales against the app's current `en.json`. It cannot detect a required starter key removed from all catalogs, including English. Validate against the target release's required contract as well; app-specific extra keys remain allowed. |
| Conflict advice overstates what can be inferred | Schema changes can include incompatible field/index edits, and generated code must be regenerated. Typechecking does not establish data preservation. Review release actions and app behavior instead of using blanket "keep both" rules. |
| Release script checks are narrower than release readiness | `scripts/release.sh` checks Git state and changelog structure, then creates a new release commit and tag. It does not run CI or verify that new commit's CI result. No release-script behavior tests were found in `scripts/tests`. Test the intended publication sequence, including failures. |
| Version policy needs one clarification | `VERSIONING.md` ties major versions to manual work after a merge. Distinguish starter-required migrations/API changes from ordinary application conflict resolution, which can occur for any release. Do not promise conflict-free patches for customized apps. |

These findings concern readiness of the existing merge process. They do not
justify moving localized values into config, separating locale namespaces, or
assuming every shared file needs packaging.

### Representative business-app scenarios

Use these to define acceptance criteria before selecting a refactor. They are
proposed scenarios, not claims that the current tooling already handles them.

| Application customization | Starter update to exercise | What must survive or be proved |
|---|---|---|
| Replaces projects/tasks with orders, customer roles and its own navigation | Auth/session security fix that touches both backend and UI | The fix is exercised through the app's actual auth flow; routes, authorization rules and domain behavior still work. Deleted example features do not silently return. |
| Changes translated values and adds domain messages in all supported locales | Adds a required UI key, changes an ICU parameter, or removes a key the app still uses | Preserve app wording and extra keys; flag semantic/delete-edit disagreements; check the target release contract and real rendering. Ordinary JSON merges are expected. |
| Adds fields/indexes and stores production business data alongside platform data | Changes a platform schema or requires a backfill | App definitions and representative stored records survive; migration ordering, reruns and deployment compatibility are tested separately from source merging. |
| Customizes CI, environment variables and deployment targets | Updates build/runtime requirements or the release pipeline | Keep app-specific deployment targets and secrets references while adopting necessary build/security changes. CI success is evidence for the adopted app commit, not permission to deploy. |
| Skips several releases or partially adopted an earlier fix | Adopts a later release with cumulative required actions | Resolve exact baseline/target commits, determine applicable intermediate actions, reject an incomplete upgrade, and retain evidence of completed checks. |

The first acceptance target is a reviewed source upgrade that preserves these
customizations and demonstrably adopts a starter fix. Conflict count, moving files,
or installing a package is not the acceptance target. A schema split, extension
point or package should be proposed only for a specific difficulty found here.

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

**The group boundaries may change.** Use measured upgrade failures and application
customization needs to choose them; a source-file split alone proves no upgrade
guarantee.

**Coding agents make app-owned updates cheaper.** This repo already has
`AGENTS.md` and `.claude/commands/`. Upgrade notes written for agents, and
codemods shipped as agent commands, make it much cheaper to apply changes to code
each app owns than a person reading a diff. Treat this as part of the design.

### Recommendation

Start with a repeatable customized-business-app merge rehearsal and truthful
baseline tracking. Repair failures it exposes in resolution, required actions,
verification and release preparation. Evaluate schema splits and package boundaries
from that evidence. Localization maintenance is outside this roadmap.

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
