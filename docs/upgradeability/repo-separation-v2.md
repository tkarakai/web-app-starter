# Separating starter and business app: who works where (draft v2)

**Version:** v2, 2026-09-25 · working draft
**Supersedes:** [repo-separation-v1.md](repo-separation-v1.md), with the decisions from its review
**Builds on:** [brainstorm v2](brainstorm-v2.md) and the [lifeor2-client case study](case-study-lifeor2-client.md)

## Summary

The starter becomes two repositories and two zones:

- **The product repo** (`web-app-starter`, public) holds only what buyers receive. Inside it, anything under a directory named `platform/`, or any file named `platform-*`, is maintained by the starter. Everything else is the app's.
- **The maintainer repo** (private, working name `web-app-starter-maintainer`) holds everything about *developing* the starter: plans, trackers, the dependency log, the security review, release tooling, the upgrade lab, and the maintainer's agent instructions. Buyers never see it.

Because apps never edit the platform zone, an upgrade can take that zone **wholesale** from the new release instead of merging it line by line. Only a small set of seam files (root `package.json`, Convex `schema.ts`) still need a real merge. That is the payoff of the whole separation.

Two facts shape the timing:

- **The product repo is public.** Moving material to a private repo hides it from now on, but it stays in the public history.
- **No release has been published yet.** v1.0.0 was prepared but never tagged on GitHub. This is the cheapest moment the structure will ever have: **restructure first, then publish the first release in its final shape.**

## Your decisions, validated

| # | Decision | Verdict | Notes |
| --- | --- | --- | --- |
| 1 | The buyer or evaluator *is* the app developer | **Agreed** | Same person at two moments. Before adopting, they read the repo as a product ("what is this, what's the licence?"). After adopting, the root is theirs. Only three root files care about the moment: README, LICENSE and AGENTS.md. An **adopt step** flips them (see [Adopting the starter](#adopting-the-starter)). |
| 2 | "Maintainer" means the starter's maintainer | **Agreed** | Defined in the glossary below, so no document has to guess. |
| 3 | Name the zone `platform/`, not `starter/` | **Agreed, recommended** | "Starter" describes where the code came from, and implies you start from it once and move on. "Platform" describes the lasting relationship you decided on: fixes, improvements and features keep arriving. It's not an assumption about how the developer thinks; it's a statement of who maintains that code, which is true even if an app never upgrades. Collision check: the word appears in this repo only incidentally (user-agent parsing, a few tests). |
| 4 | Take the proper Convex component route | **Agreed, with a spike first** | Doable. The repo already runs one local component (`betterAuth`). There are real constraints, listed in [The Convex platform component](#the-convex-platform-component). Spike one slice before committing the rest. |
| 5 | `SECURITY-REVIEW.md` is maintainer-only | **Agreed** | It is already in the public history. If it lists unfixed findings, fix them first. Moving the file doesn't unpublish it. |
| 6 | Hide maintainer material with a separate private repo (option 3) | **Agreed** | It also gives release tooling and the upgrade lab a natural home, so neither pollutes what buyers clone. |
| 7 | Maintainer instructions live in the private repo | **Agreed** | Needs a workspace layout so agents load them. See [The maintainer workspace](#the-maintainer-workspace). |
| 8 | Ship Storybook as the design system's reference | **Agreed** | It becomes `platform/apps/storybook`, platform-owned. Apps run it; they don't edit it. |
| 9 | The app template ships a default proprietary `LICENSE` | **Agreed, one wording point** | The default must carve out the platform: "Proprietary, all rights reserved, **except** `platform/`, which is licensed under `platform/LICENSE`". Otherwise the app's licence claims code it doesn't own. Worth a lawyer's read before publishing. |

## Glossary

| Term | Meaning |
| --- | --- |
| **Starter** | The product you sell: the public `web-app-starter` repo, as released |
| **Platform** | The part of the starter that the starter keeps maintaining after an app adopts it. Marked by `platform/` directories and `platform-*` files |
| **App zone** | Everything outside the platform zone. The app's code, owned by the app from adoption |
| **Reference app** | What sits in the app zone of the starter itself: `apps/web`, `landing`, `landing-static`, the sample domain. An example to adopt, not code the starter keeps updating in apps |
| **Seam** | A file or setting where the app plugs into the platform: `app.config.ts`, Convex `schema.ts`, `convex.config.ts`, `http.ts`, root `package.json` |
| **Maintainer** | Whoever develops and releases the starter |
| **Maintainer repo** | The private repo holding everything about developing the starter |
| **App developer** | Whoever evaluates, adopts and builds on the starter |
| **Adopt** | The one-time step that turns a clone of the starter into an app |
| **Upgrade** | Taking a newer starter release into an adopted app |

## The two repositories

| | Product repo `web-app-starter` | Maintainer repo `web-app-starter-maintainer` |
| --- | --- | --- |
| Visibility | Public (source-available under the evaluation licence) | Private |
| Audience | App developers, and the maintainer while writing code | Maintainer only |
| Contains | Platform zone, reference app, root templates, platform docs, `CHANGELOG`, upgrade and adopt tooling, CI | Maintainer agent instructions, roadmap, trackers, dependency log, security review, upgradeability drafts, release tooling and workflow, upgrade lab (fixture apps and rehearsals), evidence log, sales and legal source texts |
| Never contains | Anything about how the starter is planned, prioritised, audited or released | Product code (it points at the product repo instead) |
| Where code changes happen | Here, through PRs | Nowhere; it changes only its own docs and tooling |
| Existing things kept | Issues, PRs, CI, Vercel and Convex deployments, Renovate, lifeor2-client's merge base | — |

**Why keep the current repo as the product repo** (instead of renaming it into the maintainer repo and starting a fresh public one): its CI, deployments, Renovate dashboard, open PRs (#148–#150) and lifeor2-client's merge base all stay intact. The cost is that old maintainer material stays in public history. Decision 5 covers the only file where that matters.

### Product repo layout

```text
/                                   seams and templates; after adoption, the app's
├── README.md                       short and stable: what this is, "start with platform/README.md", "run bun run adopt"
├── LICENSE                         evaluation licence until adoption; then the app's proprietary licence
├── AGENTS.md  CLAUDE.md            app-developer guide, true both before and after adoption
├── app.config.ts                   configuration seam: name, ports, cookie prefix, origins, brand, feature switches
├── package.json  turbo.json  tsconfig.json  eslint.config.mjs  renovate.json
│                                   thin; extend platform/config/ bases
├── apps/
│   ├── web/                        reference app; auth routes re-export from @platform/auth-ui
│   ├── landing/  landing-static/   reference marketing sites, removable at adoption
├── packages/
│   └── backend/convex/             the single Convex project
│       ├── convex.config.ts        seam: app.use(platform, { … })
│       ├── schema.ts               seam: app tables only (the sample domain lives here)
│       ├── http.ts                 seam: registerPlatformRoutes(http) plus app routes
│       ├── platform/               platform-owned wrappers: public API, auth, HTTP, crons
│       └── <app functions>
├── platform/                       platform-owned; taken wholesale on upgrade
│   ├── README.md  AGENTS.md  CHANGELOG.md  UPGRADING.md  VERSIONING.md  VERSION
│   ├── LICENSE  COMMERCIAL-LICENSE.md
│   ├── apps/admin/  apps/storybook/
│   ├── packages/                   auth, auth-ui, convex-platform (the component), design-system,
│   │                               design-patterns, i18n, edge-rate-limit, ops, paper-roll
│   ├── tooling/                    dev scripts, local CI, adopt, upgrade, zone check, codemods
│   ├── config/                     base tsconfig, ESLint, Turbo and Renovate presets
│   ├── docs/                       architecture, testing, i18n, migrations, deployment, AWS, ops
│   ├── templates/                  post-adoption README, LICENSE, AGENTS.md
│   └── agent-skills/               upgrade, pr-review, dependency skills (app variants)
├── infra/aws/                      platform-owned scripts and templates; app-owned params/
├── .github/workflows/
│   ├── platform-*.yml              reusable workflows (GitHub requires this folder)
│   └── ci-*.yml  cd-*.yml          thin app callers
└── .claude/skills/platform-*       links into platform/agent-skills (Claude requires this folder)
```

Package names follow the zone: platform packages become `@platform/*` (for example `@platform/auth`), so every import shows its owner. App packages keep `@repo/*`. The rename is a codemod shipped with the release. If the consumed-code channel later becomes a registry, the scope will have to match a registry organisation. That's a second rename, so decide the scope together with brainstorm exploration E if possible.

### Maintainer repo layout

```text
web-app-starter-maintainer/
├── AGENTS.md  CLAUDE.md           the maintainer's agent instructions (today's AGENTS.md, maintainer parts)
├── product/                        checkout of web-app-starter (gitignored here; see workspace below)
├── docs/
│   ├── roadmap.md
│   ├── trackers/                   build-once-promote, auth-e2e-and-upgrade, authentication-and-onboarding plans
│   ├── dependency-log.md  dependency-catchup.md
│   ├── security-review.md
│   ├── upgradeability/             these drafts, the case studies, the evidence log
│   └── decisions/                  records of decisions like the ones above
├── release/
│   ├── release.ts                  prepare and publish (today's scripts/release.*)
│   └── notes/                      release note drafts before they land in platform/CHANGELOG.md
├── lab/                            the upgrade lab
│   ├── fixtures/                   synthetic apps (today's apps/demo, sidebar-policy fixtures) at pinned releases
│   ├── real-apps.json              opt-in real apps to rehearse against (lifeor2-client, the storefront app)
│   └── rehearse.ts                 trial-upgrade every fixture and real app to a release candidate, score it
├── sales/                          TERMS-OF-SALE and licence source texts
├── skills/                         maintainer variants: deps-update, deps-major (write to docs/dependency-log.md)
└── .github/workflows/
    ├── release.yml                 checks out the product repo and publishes a release
    └── lab.yml                     runs rehearsals on every release candidate
```

### Where today's files go

| Today | Goes to | Repo |
| --- | --- | --- |
| `AGENTS.md` (maintainer parts: trackers, release, "Maintaining this file") | `AGENTS.md` | Maintainer |
| `AGENTS.md` (how the codebase works) | `platform/AGENTS.md`, plus the root app guide | Product |
| `README.md` | `platform/README.md`, plus a short stable root README | Product |
| `LICENSE`, `COMMERCIAL-LICENSE.md` | `platform/`; the root keeps the evaluation `LICENSE` until adoption | Product |
| `TERMS-OF-SALE.md` | `sales/` | Maintainer |
| `CHANGELOG.md`, `VERSIONING.md`, `UPGRADING.md` | `platform/` | Product |
| `docs/roadmap.md`, `docs/claude/*-plan.md`, `docs/authentication-and-onboarding-plan.md` | `docs/`, `docs/trackers/` | Maintainer |
| `docs/dependency-log.md`, `dependency-catchup.md`, `SECURITY-REVIEW.md` | `docs/` | Maintainer |
| `docs/starter-upgrade-brainstorm.md`, `starter-versioning-strategy.md`, `starter-upgrades.md`, `docs/upgradeability/*` | `docs/upgradeability/` | Maintainer |
| Other `docs/*` and `docs/claude/*` (architecture, testing, i18n, deployment, AWS, ops, rate limiting, audit trail, migrations, dependency method) | `platform/docs/` | Product |
| `apps/admin`, `apps/storybook` | `platform/apps/` | Product |
| `apps/demo`, `packages/starter-sidebar-policy` fixtures, `scripts/starter-upgrade/rehearse.ts` | `lab/` | Maintainer |
| `packages/*` except `backend` | `platform/packages/` | Product |
| `packages/backend` platform functions | `platform/packages/convex-platform` (component), with wrappers in `convex/platform/` | Product |
| `packages/backend` sample domain (projects, tasks, uploads) | Stays in the app zone of `convex/` | Product |
| Dev and CI scripts, `resolve-i18n-conflicts.ts`, `codemods/`, upgrade and ownership checks | `platform/tooling/` | Product |
| `scripts/release.*`, `.github/workflows/release-starter.yml` | `release/`, `.github/workflows/release.yml` | Maintainer |
| `.claude/commands/upgrade-starter.md`, `pr-review*.md` | `platform/agent-skills/` | Product |
| `.agents/skills/deps-*` | App variants in `platform/agent-skills/`; maintainer variants in `skills/` | Both |
| `.lavish/`, local artefacts | Neither (gitignore) | — |

The existing starter-upgrade machinery (`.starter-version`, the ownership check, the sidebar-policy package demo, the rehearsal) predates these drafts. Its useful parts map onto the above: the ownership check becomes the zone check, the rehearsal becomes the lab, and `.starter-version` becomes the app's base record. Each piece needs a keep, port or retire decision during the move.

## The maintainer workspace

The maintainer writes code in the product repo but takes instructions from the maintainer repo. Agents only load instructions from the directory they start in and its parents (plus nested files they read), so the layout decides what they see:

```text
~/dev/web-app-starter-maintainer/        ← start agents here
├── AGENTS.md                             maintainer instructions: loaded first
└── product/                              git clone of web-app-starter (gitignored)
    ├── AGENTS.md                         app-developer guide: loaded when working inside
    └── platform/AGENTS.md
```

The product repo's own `AGENTS.md` says "the platform zone is not yours". That is true for an app developer and wrong for the maintainer. The maintainer repo's `AGENTS.md` resolves the conflict explicitly:

> You maintain the starter. Everything under `product/` is yours, including the platform zone. `product/AGENTS.md` and `product/platform/AGENTS.md` are **deliverables written for app developers**: keep them accurate, but they don't limit what you may change. When a convention changes, update them in the same PR.

Worktrees for parallel agents are created inside `product/` as usual. A worktree started directly in `product/` sees only the app-developer view, which is useful: that's how you test the buyer's experience.

## The zone rule, and the upgrade it enables

**Rule:** anything under a directory named `platform/`, or any file named `platform-*`, is platform-owned. In an adopted app it is never edited by hand.

| File class | Examples | On upgrade |
| --- | --- | --- |
| **Platform zone** | `platform/**`, `convex/platform/**`, `.github/workflows/platform-*.yml`, `.claude/skills/platform-*` | Taken wholesale from the release. No merge. |
| **Seams** | `app.config.ts`, root `package.json`, `turbo.json`, Convex `schema.ts`, `convex.config.ts`, `http.ts` | Three-way merge against the base. The zone check verifies the required hooks are still present. |
| **App zone** | Everything else, including the reference app the app adopted | Left alone. Reference-app changes in the release are listed as optional suggestions with a diff. |

**The escape hatch.** If an app really must change platform code before the starter can, it edits the file, marks the edit `// PLATFORM-PATCH: <reason>`, and records it in `.platform-base.json`. The upgrade shows every recorded patch against the new platform files: dropped if upstream now covers it, re-applied or reviewed otherwise. The zone check fails CI on any platform-zone change that isn't recorded. The lifeor2-client cookie-prefix edit would have been a recorded patch and an upstream request, not a silent conflict.

**Upgrading, step by step** (app side, `bun run platform:upgrade --to vX.Y.Z`):

1. **Use the target's tool.** The command fetches the release and runs *that release's* upgrade tool. This is the handoff's "upgrade the upgrader first", made automatic.
2. **Plan (read-only):** release advisories, breaking-change data, new required env, migrations, seam conflicts, recorded patches, and env vars removed in this release that app code still reads.
3. **Apply:** a merge commit with the platform zone from the release, the app zone from the app, and the seams merged three-way; codemods from the release run.
4. **Verify:** zone check, platform contracts, the app's own tests and contracts, env check, migration status.
5. **Record:** update `.platform-base.json` (version, commit, patches, changes taken early).

The merge commit keeps git ancestry, so the next upgrade has an exact base.

## Adopting the starter

`bun run adopt` is the first-contact step (brainstorm v2, topic 17). Run once, right after cloning:

1. Ask for, or accept flags for, product name, ports and cookie prefix; write `app.config.ts`.
2. Replace the root `README.md`, `LICENSE` (proprietary, with the platform carve-out) and `AGENTS.md` with `platform/templates/` versions.
3. Optionally remove the sample domain, `landing` and `landing-static`.
4. Write `.platform-base.json` with the release version and commit, and add the `upstream` remote.
5. Run the zone check and the build, and print what's yours and what isn't.

Before adoption, the root describes the starter for an evaluator. After adoption, it describes the product. The root `README.md` and `AGENTS.md` are kept short and stable in the product repo so they rarely change, because every change to them is a conflict for apps that haven't adopted their own yet.

## The Convex platform component

**What the docs confirm** ([authoring](https://docs.convex.dev/components/authoring), [understanding](https://docs.convex.dev/components/understanding)):

| Capability | In a component | Consequence here |
| --- | --- | --- |
| Own tables and schema | Yes, isolated; the app can't mutate them directly | The goal: platform data versioned apart from app data |
| `ctx.auth` | **Not available** | The app-side wrapper reads identity and passes the user ID as an argument |
| Called by clients | **No**: component functions are internal to the app | Every function `web` and `admin` call (56 distinct `api.*` references today) needs a public wrapper in `convex/platform/` |
| Environment variables | Only if declared in the component's `convex.config.ts` and provided by the app | 16 variables to declare: `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`, rate-limit settings, and others. Verify this works on Convex 1.45 in the spike |
| `.paginate()` | **Not supported**; use `convex-helpers` paginator | 3 files to rework: `auditTrail.ts`, `adminInvitations.ts`, `waitlist.ts` |
| IDs across the boundary | Become strings | App tables that point at platform rows store strings |
| HTTP routes | Yes, but no `ctx.auth` or app env | Auth-dependent routes (sessions, auth) stay in the wrapper layer |
| Scheduler, file storage | Yes, the component's own | Fine |
| Other components inside | Yes | Rate limiter and migrations can be nested |
| Testing | `convex-test` with component registration | Backend tests need rework |
| Distribution | Local folder now, npm package later | Leaves exploration E's channel question open |

**The shape:**

- **`platform/packages/convex-platform`** (the component): tables `userProfiles`, `adminEmails`, `appSettings`, `waitlistEntries`, `invitationTokens`, `adminInvitations`, `announcements`, `auditTrail` and rate-limit state, plus their logic.
- **`convex/platform/`** (the wrapper layer, platform-owned but in the app's Convex tree): the Better Auth instance (`betterAuth` is already its own component, and `createAuth` needs the app context), public queries and mutations that check identity and call the component, HTTP route registration, and crons.
- **App-owned:** `schema.ts` with only the app's tables (the sample domain), app functions, `convex.config.ts` installing the component and passing its env.

**Data migration.** Every existing deployment moves its platform rows into the component's tables once: the starter's own staging and production, lifeor2-client, and the storefront app. That's a one-off migration action (copy, verify counts, then drop the old tables from `schema.ts`), shipped and documented with the release.

**Spike first (2–3 days):** move `auditTrail` alone. It is self-contained, the admin app reads it, it paginates, and it has tests. Exit criteria: declared env works, the paginator replaces `.paginate()`, the admin app reads through wrappers, the tests pass under `convex-test`, and the data migration runs on a copy of staging. If any criterion fails, fall back to the v1 option: platform functions in `convex/platform/` without a component. The zone rule works either way.

**Order after the spike:** `appSettings` and `announcements` → `waitlist` and invitations → `userProfiles` and sessions (closest to auth) last.

## Cutting a release

| Step | Where | What happens |
| --- | --- | --- |
| 1. Develop | Product repo | PRs to `main`, run from the maintainer workspace. CI runs the zone check, contracts, and an "adopted" build (adopt, remove the sample, build, test). |
| 2. Prepare | Maintainer repo: `release/release.ts prepare vX.Y.Z` | Collects changes since the last tag. Drafts `platform/CHANGELOG.md` with advisories and severity, and a **breaking-change manifest as data**: renamed or removed env, new required env, migrations, removed files, renamed exports, codemods. Bumps `platform/VERSION`. Opens a release PR on the product repo. |
| 3. Rehearse | Maintainer repo: `lab.yml` | Upgrades every lab fixture and every opted-in real app from its current base to the candidate. Runs zone check, contracts, app tests, and the data migration on copies. Records results in the evidence log. Red results block the release. |
| 4. Publish | Maintainer repo: `release.yml` | After the release PR merges, it tags the product repo `vX.Y.Z` on that commit, publishes the GitHub release with notes, and later publishes packages or the component to the chosen channel. |
| 5. Announce | GitHub release and advisories, plus the buyer channel | Security fixes get a GitHub Security Advisory with affected versions. |
| 6. Record | Maintainer repo | Release log, evidence log, dependency log. |

The product repo never contains release credentials or release scripts. The maintainer repo's workflow uses a token scoped to tagging and publishing releases on the product repo.

**Cadence.** Brainstorm v2 found 47 commits and a breaking change in 9 days. Once released, aim for small, frequent minors and patches, so every upgrade is small.

## CI and checks

| Check | Product repo | Maintainer repo |
| --- | --- | --- |
| Build, lint, types, unit and E2E tests | Yes | — |
| Zone check (no unrecorded platform-zone edits) | Yes, as an app would run it | — |
| "Adopted" build: adopt, remove the sample and landing, build, test | Yes | — |
| Platform contracts (auth, authorization, headers, env) | Yes, and shipped to apps | — |
| **No maintainer material** (denylist: roadmap, trackers, release scripts, security review) | Yes, fails if any reappears | — |
| Upgrade rehearsals against fixtures and real apps | — | Yes, per release candidate |
| Agent first-contact test (the seven tasks from v1) | — | Yes, per release candidate |

## Migration plan

1. **Create the maintainer repo.** Move maintainer-only docs, `TERMS-OF-SALE.md`, the security review, release tooling, `apps/demo` and the upgrade fixtures. Split `AGENTS.md`. Set up the workspace. This is hours of work and changes no product code.
2. **Run the agent first-contact test** on today's layout, for a baseline.
3. **Add the configuration seam** (`app.config.ts`: name, ports, cookie prefix, origins), and upstream lifeor2-client's improvements (brainstorm v2, exploration 0).
4. **Convex spike** on `auditTrail`, then decide: component, or `convex/platform/` without a component.
5. **The big move:** the `platform/` zone, `@platform/*` package names, root templates, the adopt and upgrade tooling, zone check, and the auth routes moved out of `web`. One PR series; re-run the agent test.
6. **The rest of the component migration**, if the spike passed.
7. **Publish v1.0.0** (or call it v2.0.0 if you prefer to mark the break from the unpublished v1 preparation) as the first release in the final shape.
8. **Re-baseline lifeor2-client and the storefront app** onto it, as the first lab rehearsals and the next evidence-log rows.

## Still unclear

1. **Who can see the product repo, and how do buyers get upgrades?** It's public today, so anyone can fetch releases. Is that the model (source-available, licence enforced legally), or should releases move behind access control later? This decides the registry question too.
2. **Do buyers contribute back?** With a public product repo, buyers could open issues and PRs. The licence and a contribution policy should say whether that's welcome (brainstorm v2, topic 16).
3. **Version number for the first release in the new shape:** v1.0.0 (nothing was published) or v2.0.0 (the prepared v1.0.0 is referenced in docs and the storefront app's notes)?
4. **Package scope:** `@platform/*` now, or pick a registry-ready scope once, to avoid renaming twice?
5. **Reference-app improvements:** how much effort goes into describing them for apps that already adopted (suggestions with diffs, or recipes like brainstorm v2's feature-delivery model)?
6. **The storefront app's status:** which starter commit it is on, and whether it can join the lab as a real app.
7. **Existing staging and production deployments of the starter itself:** the component data migration must run there too. Are they worth keeping, or can they be reset before the first release?

## Risks

| Risk | Mitigation |
| --- | --- |
| The big move breaks lifeor2-client and the storefront app badly | They are the lab's first rehearsals; a shipped codemod renames imports; git detects the moves as renames |
| Convex component constraints are worse than documented | Spike with exit criteria; the zone rule works without the component |
| The maintainer's agents get confused by the product repo's app-developer `AGENTS.md` | Workspace layout plus the explicit override in the maintainer repo; test it like the buyer test |
| Maintainer material creeps back into the product repo | CI denylist check |
| Two repos drift (docs in one describe code in the other) | Maintainer docs link to product paths by release tag; the release checklist reviews them |
