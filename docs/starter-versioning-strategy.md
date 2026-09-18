# Propagating starter updates to business apps

Status: proposal, 2026-09-18. **Phase 0 is implemented** — see `VERSIONING.md`,
`UPGRADING.md`, `CHANGELOG.md` and `scripts/release.sh`. Phases 1–3 remain a
proposal with no decision taken.

## The problem

Business projects clone this repo and start there. From the first commit they are
disconnected: a security fix, an auth hardening, or a new capability landed here
reaches them only if somebody notices and hand-ports it. As the number of
downstream projects grows, that cost grows linearly and the projects drift apart
in ways that make later porting harder still.

The instinct is to treat this as a binary — freely-forked template (the shadcn
way) versus versioned dependency (the framework way). That framing is what makes
the question feel unanswerable, because both answers are wrong for *parts* of
this repo and right for other parts.

This document argues for a third option: **stratify the repo by change profile
and give each stratum its own propagation mechanism.**

Jargon used below — *seam*, *fork in anger*, *vendoring*, *codemod*, *eject* and
the rest — is defined in the [Glossary](#glossary) at the end.

## What this repo actually is

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

~64,000 lines across 6 apps and 6 packages. For comparison, the SaaS kits that
get away with pure fork-and-merge (supastarter, Makerkit, fullstackhero) ship a
fraction of this and concentrate it in a single app. **The scale is the reason
the standard answer doesn't fit us**, and also the reason a better answer pays
for itself here when it wouldn't for them.

Three structural facts decide what is possible:

**1. The demo domain is thin and already isolated.** Only six files reference
`api.projects` / `api.tasks`, all under `apps/web/src/components/projects/` and
`dashboard-client.tsx`. The `projects` / `tasks` / `uploads` tables are three of
eleven in `schema.ts`. Everything else — `userProfiles`, `adminEmails`,
`appSettings`, `waitlistEntries`, `invitationTokens`, `adminInvitations`,
`announcements`, `auditTrail` — is platform, not example. `auditTrailConstants.ts`
has no references to the demo tables at all.

The thing a business app throws away is small. The thing it wants to keep
receiving is ~90% of the repo. That asymmetry is the whole case for investing in
propagation.

**2. We already ship a Convex Component.** `packages/backend/convex/convex.config.ts`
does `app.use(betterAuth)`, and `betterAuth/` carries its own `schema.ts` and
`_generated/`. Convex Components are the platform's own modularity primitive:
a component owns its tables and function namespace, the isolation is enforced by
Convex rather than by convention, and upgrading a component's version does not
silently rewrite the host app's tables. This is the unlock. The backend is
normally the hardest layer to distribute, and we already have the mechanism in
the building.

**3. The seams that would make this cheap are currently welded shut.** Three
specific defects, each a guaranteed merge conflict on every future upgrade:

- **Branding is a string literal in 29 files** — `apps/admin` sign-in, forgot-password,
  reset-password, onboarding, `layout.tsx`, `admin-sidebar.tsx`, landing footers,
  `packages/backend/convex/auth.ts`, e2e specs, and all 15 locale files. Every
  business app edits all 29 on day one, so all 29 conflict forever.
- **One `schema.ts` holds platform and app tables together** (179 lines, 11 tables).
  A business app adding its own tables edits the same file we edit. Note that the
  file *already* composes via spread (`...rateLimitTables`, `migrationsTable`), so
  the seam is available — it just isn't used for our own tables.
- **i18n is 7,330 lines across 15 locales in a flat shared namespace.** App strings
  and platform strings land in the same JSON objects. Adding a translation key
  downstream conflicts with any upstream key addition, in all 15 files at once.

None of these are hard to fix. All three must be fixed before any propagation
mechanism works, because a mechanism that delivers conflicts isn't propagation.

## How the industry solves it

**Fork + upstream remote** is the near-universal answer among SaaS kits, and it's
universally acknowledged to degrade.

- *supastarter*: `git remote add upstream …` then `git pull upstream main
  --allow-unrelated-histories --rebase`. Their docs state plainly that "with every
  change you make to your application, it will become harder to update your code
  base, because you are essentially rebasing your code on top of the latest
  supastarter code."
- *Makerkit*: same upstream-remote workflow, but leans on a Turborepo layout —
  `packages/features`, `packages/ui` — so downstream work happens in app code
  while core packages stay untouched. Structure is doing the real work, not git.
- *TurboStarter*: closest structural peer to us — Turborepo monorepo, shared
  `auth` / `billing` / `db` / `api` packages. Same upstream-remote workflow, but
  **explicitly advises merge over rebase** ("when prompted the first time, please
  opt for merging instead of rebasing"), which directly contradicts supastarter.
  Names exactly one conflict hotspot, the lockfile, with the right remedy — accept
  either side, never hand-edit, regenerate with `pnpm i` — and prescribes `lint` +
  `typecheck` as the post-merge health check. Notably it gives *no* guidance on
  where downstream should put its own code, which is the gap Makerkit and
  fullstackhero fill.
- *fullstackhero*: most sophisticated of these. Tagged releases merged by tag
  (`git merge v10.1.0`), a changelog with explicit action-required items, and
  architectural rules: create your own `Modules.{YourName}` that upstream never
  touches, don't edit high-traffic shared `BuildingBlocks`, use extension points
  rather than editing shipped modules. Their framing is the right one — *"taking
  upstream fixes is a git workflow, not a package bump"* — precisely because they
  distribute source you own rather than packages.

**"Lifetime updates" as a licensing promise, not a mechanism.** *ShipFast* sells
lifetime updates, but the delivery mechanism is continued access to the repo —
there is no merge tooling, no versioning, no upgrade guide. It is the pure
fork-and-diverge endpoint, and it works for its audience: solo founders shipping
one small app quickly, where the boilerplate is scaffolding you outgrow rather
than a foundation you keep standing on. It is the clearest example of a model we
should *not* copy, because our situation inverts every one of its assumptions.

**The official Next.js SaaS Starter argues our case rather than against it.**
Vercel's starter (Next + Postgres + Stripe + shadcn) is deliberately minimal and
has no update story at all — it is a demonstration of current patterns, not a
maintained platform. That is not an oversight. Vercel's answer to "how do
framework updates reach the thousands of apps scaffolded from our template" is
`@next/codemod` — the *dependency* layer, with codemods for breaking changes.
The template is disposable precisely because everything durable lives in a
versioned package. This is the tiering proposed below, already validated at the
largest scale in this ecosystem: nobody tries to merge upstream into a
`create-next-app` project, and nobody needs to.

**Registry / vendoring** is shadcn's answer, and it has evolved well past
copy-paste. shadcn CLI 3.0 added **namespaced registries**: `components.json` maps
`"@acme": "https://acme.com/r/{name}.json"` with optional auth headers and private
hosting, and the system is deliberately decentralized — any server returning JSON
over HTTP is a registry. So the "shadcn way" now explicitly supports a company
serving its own components privately. Worth noting for the user's own question:
shadcn's answer to *"how do I run this at organization scale"* was to build a
distribution mechanism, not to tell people to keep copy-pasting.

**Diff-based upgrade** is React Native's answer via the Upgrade Helper: generate a
pristine project at version A and version B, diff them, and publish the diff with
per-file commentary and progress tracking. It doesn't merge anything — it tells a
human exactly what changed in the un-mergeable parts. This is the only good answer
for scaffolded code that every project rewrites.

**Codemods** are the framework answer. Angular's `ng update` runs migration
schematics that rewrite code via the TypeScript AST on version bump; Rails'
`app:update` regenerates config and shows you the diff interactively. The lesson:
breaking changes are acceptable if you ship the migration *as code*.

No one does all four. The kits that do only upstream-merge do so because they're
small. We are not small, which is exactly why we should borrow from the framework
end of the spectrum rather than the boilerplate end.

**On merge vs. rebase**, where supastarter and TurboStarter disagree: take
TurboStarter's side. Rebasing replays every downstream commit on top of new
upstream code, so a project with 300 commits of its own can hit the same conflict
300 times, and it rewrites history that downstream teams have already pushed and
branched from. A merge resolves each conflict once and leaves everyone's
checkouts valid. fullstackhero merges by tag for the same reason.

## Proposal: three tiers, three mechanisms

Classify every part of the repo on two axes — how often *we* change it, and how
often a *business app* needs to change it. Those two answers pick the mechanism.

### Tier 1 — Consumed. Versioned dependencies, never edited downstream.

Business apps take these as semver dependencies and never open the files.
Renovate already runs in this repo; downstream it becomes the delivery channel.
Security fixes propagate as a PR that CI validates, with no merge conflict
possible because nobody downstream has touched the code.

Candidates, all already app-agnostic:

- `@repo/edge-rate-limit` (157 lines, zero app coupling — the easiest first win)
- `@repo/auth` (264 lines, pure wiring)
- `@repo/i18n` runtime (config, request, navigation — not the message files)
- Backend platform as **Convex Components**: `auditTrail*`, `securityPolicies`,
  `rateLimits`, `tokenHash`, `passwordStrength`, `parseUserAgent`,
  `adminInvitations`, `waitlist*`, `announcements`, `appSettings`
- CI as **reusable workflows**. GitHub Actions supports
  `uses: org/web-app-starter/.github/workflows/ci-shared.yml@v2` natively. 3,037
  lines of workflow stop being copied entirely — downstream keeps a ten-line
  caller. This is the highest value-per-hour item in the whole proposal.
- `scripts/` (4,016 lines) as a published CLI — `starter dev`, `starter ci`

This tier is where the security argument is won. A CVE fix in rate limiting or
token hashing becomes a version bump that Renovate opens automatically in every
business app, rather than an email asking people to please port a patch.

### Tier 2 — Vendored. Registry pull, downstream owns the files.

The 42 design-system components and `@repo/design-patterns`. Business apps
*must* restyle these; forcing them into a dependency guarantees a fork in anger.
But copy-once-and-forget loses accessibility and behaviour fixes.

Serve them from a private shadcn-compatible registry under a `@starter`
namespace. Downstream runs `shadcn add @starter/sidebar` to take a component and
`starter diff sidebar` to see what changed upstream since they took it. Per
component, per decision, no repo-wide merge. This is the shadcn model applied
where it genuinely fits — and notably it's the model shadcn themselves built for
exactly this organizational situation.

### Tier 3 — Forked. Scaffolded once, never synced.

App shells (`apps/web` dashboard, `apps/admin` pages, landing content), the demo
domain (`projects`/`tasks`/`uploads`), and copy. Every business app rewrites
these. Pretending otherwise produces conflicts in files nobody wants merged.

Propagate by *information*, not by merge:

- A generated diff site, rn-diff-purge style: scaffold a pristine app at v1.4 and
  v1.5, publish the diff with commentary. Downstream reads it and decides.
- **Codemods shipped with breaking releases.** When an auth interface changes,
  ship the transform, don't just document it.
- `UPGRADING.md` with an action-required section per release, in fullstackhero's
  style.

### Tier 0 — The rail everything runs on

- **Semver the repo.** Today every package is `private`, `version: 0.0.0`. Tag
  releases, keep a real CHANGELOG, define an LTS window and a breaking-change
  budget.
- **`starter.config.ts`** in each business app, recording which version of each
  tier it's on — so `starter doctor` can report drift and CI can warn when a
  project falls more than N minors behind on a security-bearing package.
- **`create-business-app` CLI** that scaffolds Tier 3, wires Tier 1 deps, and sets
  the brand config — replacing "clone and start deleting."
- **A canary app in this repo** that consumes the tiers the way a business app
  does, so upstream CI catches downstream breakage before release.
- **An eject path for every Tier 1 package.** Teams that can't eject will fork in
  anger and you lose them permanently. Making ejection legitimate and documented
  keeps far more projects on the rail than forbidding it would.

## Sequencing

The tiers are the destination, not the first move. Ordered by value per unit of
effort:

**Phase 0 — works today, no refactor.** Tag and semver the repo, write
`UPGRADING.md` and a CHANGELOG with action-required sections, document the
`upstream` remote workflow, and tell existing business apps to add the remote now.
This is the supastarter/Makerkit/TurboStarter/fullstackhero baseline. It is not
the end state, but it's strictly better than today and costs days, not weeks. Do
it first — everything after it is an improvement on a working process rather than
a prerequisite.

Borrow the specifics rather than inventing them. Merge by tag, never rebase (see
above). Name `bun.lock` as a known conflict hotspot with "accept either side,
never hand-edit, re-run `bun install`" as the remedy, exactly as TurboStarter
does. Prescribe `bun run ci:quick` as the post-merge health check — we already
have it, which is more than most kits can say. Write the action-required notes for
coding agents as well as humans, since `CLAUDE.md` and `.claude/commands/` mean
downstream agents will be doing a share of the merging.

**Phase 1 — cut the seams.** The three defects above, in this order:

1. Brand config — one `starter.config.ts`, all 29 literals read from it. Unblocks
   scaffolding and removes the single largest permanent conflict surface.
2. Schema composition — split `schema.ts` into `platformTables` and `appTables`,
   using the spread pattern the file already demonstrates. Prerequisite for the
   Convex Component work.
3. i18n namespacing — reserve a `starter.*` key namespace for platform strings,
   leave the rest to the app; split message files along that line.

Also in this phase: mark ownership explicitly. fullstackhero's "don't edit
BuildingBlocks, create your own modules" rule works, and it's cheap to state.
`CLAUDE.md` is the natural place, which also means coding agents downstream
respect the boundary.

**Phase 2 — Tier 1 extraction.** Reusable CI workflows first (biggest win,
lowest risk, no code moves). Then `@repo/edge-rate-limit` to GitHub Packages as a
proof of the publishing pipeline. Then the backend platform as Convex Components,
which is the large one and wants the schema split done first.

**Phase 3 — Tier 2 registry and Tier 3 tooling.** The component registry, the
diff site, the codemod harness, `starter doctor`.

Phases 0 and 1 deliver most of the risk reduction. Phases 2 and 3 are what make
it scale past a handful of business apps, and can wait until there are enough
downstream projects to justify them.

## Honest trade-offs

**This adds maintenance burden here to remove it downstream.** Publishing
packages means release discipline, deprecation policy, and supporting more than
one version at a time. That's a real ongoing cost and it lands on this team. It's
only worth paying if there will be several business apps; for one or two, Phase 0
alone is the right stopping point.

**Versioned dependencies constrain business apps**, and some will find the
constraint wrong for their case. That's what the eject path is for. Treat
ejection as a supported outcome rather than a failure.

**Tier boundaries will be wrong at first** and will move. The brand-config and
schema-split work is valuable regardless of where the boundaries finally land,
which is another reason to do Phase 1 before Phase 2.

**The AI-agent angle is genuinely ours to exploit.** This repo already carries
`CLAUDE.md` and `.claude/commands/`. Upgrade notes written for agents, and
codemods shipped as skills, make Tier 3 propagation far cheaper than the
human-reads-a-diff model the industry currently has. Worth treating as a
first-class part of the design rather than a nice-to-have.

## Recommendation

Adopt the three-tier model as the target architecture. Start with Phase 0 this
quarter — it's cheap, it's strictly better than the status quo, and it buys time.
Commit to Phase 1 next, because the three seam defects are pure debt: they cost us
on every propagation attempt under *any* model, including the one we use today.
Decide on Phase 2 once there are three or more business apps on the rail.

## Glossary

Terms used above that are jargon rather than plain English.

**Seam** — a place in the codebase deliberately designed so two parties can change
things independently without editing the same file. A config value read from one
place is a seam; the same string hardcoded in 29 files is not. "The seams are
welded shut" means the split points exist conceptually but there is no mechanism
to separate along them, so any change forces both parties into the same file.

**Conflict surface** — the set of files that both upstream and downstream are
likely to edit, and therefore the files that will produce merge conflicts. Our
i18n message files are a large conflict surface: 15 files that upstream adds keys
to and every business app also adds keys to.

**Fork in anger** — when a team hits a constraint in a shared dependency they
can't work around and can't get changed fast enough, so they copy the source into
their own repo and stop taking updates entirely. It's usually permanent and
usually invisible until much later. The point of a documented **eject path** is
that teams who need out take a supported exit instead, which keeps them reachable
for the remaining tiers.

**Eject** — a supported way to stop consuming a managed package and take
ownership of its source, without leaving the ecosystem. `create-react-app eject`
is the familiar example.

**Vendoring** — copying a dependency's source code into your own repo so you own
and can edit it, rather than installing it as a package. shadcn/ui is vendoring by
design: `shadcn add button` writes the component into your tree and it's yours.

**Scaffold** — generate a project's starting files once from a template, with no
ongoing link to the template. `create-next-app` scaffolds.

**Upstream remote** — a second git remote in a downstream repo pointing at the
original starter, so `git pull upstream main` can bring its changes in. The
standard mechanism for every kit surveyed above.

**Codemod** — a script that mechanically rewrites source code to migrate it
across a breaking change, usually by parsing to an AST rather than regex. Angular
ships these as migration schematics run by `ng update`; Next.js ships
`@next/codemod`. The principle: if you break an API, ship the migration as code,
not as a paragraph in a changelog.

**Drift** — accumulated divergence between a downstream project and upstream. The
thing that makes each successive merge more expensive than the last.

**Diff site / rn-diff-purge style** — React Native's approach: generate a pristine
project at version A and at version B, diff the two, and publish the result with
per-file commentary. It merges nothing; it just tells a human precisely what
changed in the parts that can't be merged automatically.

**Canary app** — a consumer application kept inside the upstream repo that uses
the published packages the way a real downstream project would, so upstream CI
catches downstream breakage before a release ships.

**Semver / LTS / breaking-change budget** — semantic versioning (major.minor.patch,
where major means "this will break you"); a long-term-support window committing to
patch older majors for some period; and an explicit limit on how often we're
willing to spend a major, since every one costs every downstream team.

**Tier 1 / 2 / 3, Consumed / Vendored / Forked** — our own coinage, not industry
terms. They name how a business app *relates* to each part of the starter: code it
installs and never opens, code it copies and owns, and code it takes once and
rewrites.

## Sources

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
