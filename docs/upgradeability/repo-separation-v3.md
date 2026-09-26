# Separating starter and business app: who works where (draft v3)

**Version:** v3, 2026-09-25 · working draft
**Supersedes:** [repo-separation-v2.md](repo-separation-v2.md), with the decisions from its review
**Builds on:** [brainstorm v2](brainstorm-v2.md) and the [lifeor2-client case study](case-study-lifeor2-client.md)

## Summary

The starter is split two ways:

- **Two repositories.** The public **product repo** (`web-app-starter`) holds only what buyers receive. The private **maintainer repo** (working name `web-app-starter-maintainer`) holds everything about developing, testing and releasing the platform.
- **Two zones inside the product repo.** Anything under a directory named `platform/`, or any file named `platform-*`, is the **platform**: maintained by us and taken wholesale on upgrade. Everything else is the **app zone**: owned by whoever builds the app.

The same split applies to instructions. **The product repo teaches how to build an app using the platform. The maintainer repo teaches how to develop the platform.** No file in the product repo explains how to change the platform.

## What changed from v2

| Area | v2 | v3 |
| --- | --- | --- |
| Agent instructions | Root `AGENTS.md` as an app template, plus `platform/AGENTS.md` "using the starter" | A clear three-layer model; the app template stays thin, and platform conventions live in the versioned platform zone (see [gap 1](#gaps-found-in-the-model)) |
| Maintainer agents | Maintainer workspace only | Plus a local override file, so tools started inside product worktrees also get maintainer instructions (gap 2) |
| CI | "No maintainer material" check | Dropped. CI is framed as a selling point, with the private-repo limits made explicit |
| Demo app | Moved to the maintainer repo's lab | Stays in the product repo as a reference app; the lab uses tagged copies |
| Migration plan | Agent baseline test as step 2 | Removed from the critical path; a baseline can be taken later from the old commit |
| Storefront app | Listed as a real app to rehearse | Removed from the plan |
| Open questions | Seven | All answered; see [Decisions](#decisions) |

## Decisions

| # | Decision | Status |
| --- | --- | --- |
| 1 | Two repos: public product repo, private maintainer repo | Decided (v2) |
| 2 | Zone name `platform/` and file prefix `platform-*` | Decided (v2) |
| 3 | The buyer, evaluator and app developer are one audience, at two moments (before and after adoption) | Decided (v2) |
| 4 | Convex platform component, after a spike on `auditTrail` | Decided (v2) |
| 5 | Security review, roadmap, trackers and release tooling are maintainer-only | Decided (v2) |
| 6 | Storybook ships as the design system's reference, platform-owned | Decided (v2) |
| 7 | App template ships a proprietary root `LICENSE` that carves out `platform/` | Decided (v2) |
| 8 | Product repo `AGENTS.md` covers only *using* the platform; all platform-development guidance lives in the maintainer repo | **Decided (v3)** |
| 9 | Maintainers build the reference apps (`web`, `demo`, `landing`, `landing-static`) the way buyers do: using the platform's usage guidance and skills | **Decided (v3)** |
| 10 | The product repo's CI is the CI buyers adopt; it's a selling point | **Decided (v3)** |
| 11 | The product repo is public; the licence is enforced legally, not by access control | **Decided (v3)** |
| 12 | Buyer contributions back to the starter: out of scope for now (public PRs are off) | **Decided (v3)** |
| 13 | The first release in the new shape is **v2.0.0** | **Decided (v3)** |
| 14 | Pick a registry-ready package scope now (proposal: `@web-app-starter/*`) | **Decided (v3)**; reserve the npm organisation |
| 15 | No effort goes into porting reference-app changes to adopted apps; release notes cover the platform only | **Decided (v3)** |
| 16 | Keep the starter's staging deployment and run the component data migration there; production isn't set up yet | **Decided (v3)** |
| 17 | The risks listed in v2 are accepted | **Decided (v3)** |

## Glossary

| Term | Meaning |
| --- | --- |
| **Starter** | The product we sell: the public `web-app-starter` repo, as released |
| **Platform** | The part of the starter we keep maintaining after an app adopts it: `platform/` directories and `platform-*` files |
| **App zone** | Everything outside the platform zone; owned by the app |
| **Reference apps** | The app zone of the starter itself: `apps/web`, `apps/demo`, `apps/landing`, `apps/landing-static` and the sample domain. Examples built on the platform, which buyers adopt and then own |
| **Seam** | A file where the app plugs into the platform: `app.config.ts`, root `package.json`, Convex `schema.ts`, `convex.config.ts`, `http.ts` |
| **Maintainer** | Whoever develops and releases the platform |
| **Maintainer repo** | The private repo with everything about developing, testing and releasing the platform |
| **App developer** | Whoever evaluates, adopts and builds on the starter (buyer and evaluator are the same person) |
| **Adopt** | The one-time step that turns a clone of the starter into an app |
| **Upgrade** | Taking a newer platform release into an adopted app |

## The instruction model

### The principle

| Question an agent is answering | Where the answer lives |
| --- | --- |
| "How do I build this product?" | The app's root `AGENTS.md`: app-owned; we supply a starting template |
| "How do I use the platform correctly (at the version installed here)?" | `platform/AGENTS.md`, `platform/docs/`, `platform/agent-skills/`: platform-owned, replaced on every upgrade |
| "How do I upgrade the platform?" | `platform/UPGRADING.md`, linked from both files above |
| "How do I change, test or release the platform itself?" | The maintainer repo only |

### The three layers

| Layer | File(s) | Zone and owner | Content | Changes when |
| --- | --- | --- | --- | --- |
| **1. App guide** | Root `AGENTS.md`, `CLAUDE.md` | App zone. We ship the first version as a template; after adoption the app owns it | What this product is. The app's own conventions and decisions. A short "read first" pointer to layer 2 and to `platform/UPGRADING.md`. Nothing about platform internals | Whenever the app's team wants. Upgrades never touch it |
| **2. Platform usage guide** | `platform/AGENTS.md`, `platform/docs/*`, `platform/agent-skills/*` | Platform zone. Owned by us, read-only in apps | Conventions the platform dictates (structure, imports, testing, i18n, auth usage, Convex patterns), seams and how to use them, best practices, the contracts that must stay green, how to upgrade. Always describes **the installed platform version** | Every platform release. Taken wholesale on upgrade, so it always matches the code next to it |
| **3. Platform development guide** | Maintainer repo: `AGENTS.md`, `docs/*`, `skills/*` | Maintainer repo | How the platform is built and tested internally, release process, roadmap, trackers, dependency log, security review, the upgrade lab. Also: "layers 1 and 2 are deliverables; keep them accurate" | Whenever we want. Never shipped |

### Who reads what

| Who, doing what | Reads | Never reads |
| --- | --- | --- |
| App developer's agent building the product | 1 + 2 | 3 (it doesn't exist in their repo) |
| Maintainer building a reference app (`web`, `demo`, `landing`, `landing-static`) | 1 + 2, **exactly like a buyer** | 3 is available but doesn't apply. If the work needs a platform change, switch to platform work |
| Maintainer changing the platform (`platform/**`, including admin, Storybook, tooling, `platform-*` CI) | 3, then 2 as the deliverable being kept accurate | — |

Building the reference apps with only layers 1 and 2 is **dogfooding the buyer's experience**. If the maintainer's agent struggles to build a reference-app feature from the usage guide, the usage guide has a gap.

### How to decide which layer a document belongs to

Ask: **"Would an app developer need this without ever editing `platform/`?"**

- **Yes → layer 2.** Examples: how auth works and how to debug a failed sign-in, how to add a table next to the platform's, which env vars the platform reads, rate-limit behaviour, deployment.
- **No → layer 3.** Examples: why the audit trail is built the way it is, how to test a change to the component, how to cut a release, what's next on the roadmap.

Some topics split. For example, rate limiting: its behaviour and settings go to layer 2, its internal design to layer 3.

### How instructions get loaded

These mechanics vary by agent tool; verify each during the migration.

- **Claude Code** loads `CLAUDE.md` files, not `AGENTS.md`. The template root `CLAUDE.md` imports both files: `@AGENTS.md` and `@platform/AGENTS.md`.
- **Codex and similar tools** read `AGENTS.md` at the root and in directories they work in. The template root `AGENTS.md` therefore opens with an explicit instruction: "Before any task, read `platform/AGENTS.md`."
- **Skills** ship in `platform/agent-skills/`. The adopt step links them into the tool-specific folders (for example `.claude/skills/platform-*`). The links are named `platform-*`, so they're platform zone too.

## Gaps found in the model

Your model holds. Working through it turned up eight gaps; each has a proposed fix.

**1. The template can't stay current.** If platform conventions lived in the root `AGENTS.md`, they would stop updating the day the app adopts, because the file is app-owned from then on. After a few upgrades, the app's agents would follow conventions for an older platform. **Fix:** the platform's conventions live in layer 2 (`platform/AGENTS.md`), which is replaced on every upgrade. The root template stays thin: product, app conventions, pointers. This is what makes "assuming the last adopted version" true automatically.

**2. Maintainer tools started inside the product repo miss maintainer instructions.** The maintainer workspace (maintainer repo on top, product repo checked out inside) works when an agent starts at the top. But much maintainer work starts *inside* the product repo: worktrees, the no-mistakes pipeline, review commands, cloud agents. Those would see only layers 1 and 2. **Fix:** the maintainer repo ships a setup script that puts a **local, gitignored override file** into each product-repo worktree: `CLAUDE.local.md` for Claude Code, `AGENTS.override.md` for Codex. The file says "you are a platform maintainer; read `<maintainer repo>/AGENTS.md`". The product repo's `.gitignore` lists these names. That's harmless for buyers, who can use the same files for personal notes.

**3. The app's Renovate would edit the platform.** Platform packages' `package.json` files live in `platform/`. An app's Renovate would open PRs against them, and each merged PR would be an unrecorded platform-zone edit. **Fix:**

- The app's Renovate config extends a platform preset with `ignorePaths: ["platform/**"]`.
- Platform packages declare dependency **ranges** (floors, not pins), so the app can raise shared dependencies like React in its own packages.
- Security patches inside those ranges reach the app through lockfile maintenance (the lockfile is app-owned), without touching `platform/`.

**4. Platform tests in every app's CI.** Running the platform's full unit suite on every app PR wastes CI minutes, because the platform code doesn't change between upgrades. **Fix:** the platform suite runs **when `platform/**` changes**. In the starter repo that is most PRs. In an app, it's exactly the upgrade PRs, where it's most useful. Platform **contracts** (auth, authorization, headers, env) run on every PR everywhere, because app changes can break them.

**5. Maintainer-only checks don't belong in shared CI.** Checks such as "adopt, strip the sample, build" or "rehearse the upgrade against lab apps" only make sense for us. **Fix:** they run in the maintainer repo's lab, against each release candidate, not in the product repo's CI.

**6. The demo app is a reference app, not a lab fixture.** It's a standalone demonstration of a heavily customised app. **Fix:** it stays in the product repo's app zone. The lab builds its fixtures from tagged copies of the product repo (for example "demo at v2.0.0, upgraded to the candidate").

**7. Reference apps must model good behaviour.** If a maintainer patches the platform from inside a reference app, the example teaches buyers the wrong habit. **Fix:** reference apps never carry `PLATFORM-PATCH` markers. A needed platform change is made as platform work (layer 3), released, and then used.

**8. Wrong layer, wrong audience.** Architecture documents mix "how it behaves" with "why it's built this way". **Fix:** the layer test above, applied file by file during the migration, splitting where needed.

## The two repositories

| | Product repo `web-app-starter` | Maintainer repo `web-app-starter-maintainer` |
| --- | --- | --- |
| Visibility | Public; licence enforced legally | Private |
| Audience | App developers; maintainers while writing code | Maintainers only |
| Contains | Platform zone, reference apps, root templates, layer 2 docs and skills, `platform/CHANGELOG.md`, adopt and upgrade tooling, the CI buyers adopt | Layer 3 docs and skills, roadmap, trackers, dependency log, security review, upgradeability drafts, release tooling and workflows, upgrade lab, workspace setup, sales and licence source texts |
| Where code changes happen | Here, through PRs | Nowhere; it changes only its own docs and tooling |
| Keeps | Issues, PRs, CI, Vercel and Convex staging, Renovate, lifeor2-client's merge base | — |

### Product repo layout

```text
/                                   seams and templates; after adoption, the app's
├── README.md                       short and stable: what this is, where to start, "bun run adopt"
├── LICENSE                         evaluation licence until adoption; then the app's proprietary licence
├── AGENTS.md  CLAUDE.md            layer 1 template: thin; points to platform/AGENTS.md
├── app.config.ts                   configuration seam: name, ports, cookie prefix, origins, brand, switches
├── package.json  turbo.json  tsconfig.json  eslint.config.mjs  renovate.json
│                                   thin; extend platform/config/ bases
├── apps/
│   ├── web/                        reference app; auth routes re-export from @web-app-starter/auth-ui
│   ├── demo/                       reference app: heavily customised dashboard example
│   ├── landing/  landing-static/   reference marketing sites; removable at adoption
├── packages/
│   └── backend/convex/             the single Convex project
│       ├── convex.config.ts        seam: installs the platform component
│       ├── schema.ts               seam: app tables only (the sample domain lives here)
│       ├── http.ts                 seam: registerPlatformRoutes(http) plus app routes
│       ├── platform/               platform-owned wrappers: public API, auth, HTTP, crons
│       └── <app functions>
├── platform/                       platform zone; taken wholesale on upgrade
│   ├── AGENTS.md                   layer 2: how to build on this platform version
│   ├── README.md  CHANGELOG.md  UPGRADING.md  VERSIONING.md  VERSION
│   ├── LICENSE  COMMERCIAL-LICENSE.md
│   ├── apps/admin/  apps/storybook/
│   ├── packages/                   auth, auth-ui, convex-platform (component), design-system,
│   │                               design-patterns, i18n, edge-rate-limit, ops, paper-roll
│   ├── tooling/                    dev scripts, setup-e2e, local CI, adopt, upgrade, zone check, codemods
│   ├── config/                     base tsconfig, ESLint, Turbo presets; Renovate preset (ignores platform/**)
│   ├── docs/                       layer 2 reference: architecture-as-used, testing, i18n, migrations,
│   │                               deployment, AWS, ops, rate limits, audit trail
│   ├── templates/                  layer 1 templates: README, LICENSE, AGENTS.md, CLAUDE.md
│   └── agent-skills/               usage skills: upgrade, pr-review, dependency updates for apps
├── infra/aws/                      platform-owned scripts and templates; app-owned params/
├── .github/workflows/
│   ├── platform-*.yml              reusable workflows: the CI buyers adopt
│   └── ci-*.yml  cd-*.yml          thin app-owned callers
└── .claude/skills/platform-*       links into platform/agent-skills
```

### Maintainer repo layout

```text
web-app-starter-maintainer/
├── AGENTS.md  CLAUDE.md           layer 3: how to develop, test and release the platform
├── product/                        checkout of web-app-starter (gitignored)
├── setup/                          workspace setup; writes local override files into product worktrees
├── docs/
│   ├── platform-internals/         the "why it's built this way" halves of architecture docs
│   ├── roadmap.md
│   ├── trackers/                   build-once-promote, auth-e2e-and-upgrade, authentication-and-onboarding
│   ├── dependency-log.md  dependency-catchup.md
│   ├── security-review.md
│   ├── upgradeability/             these drafts, case studies, evidence log
│   └── decisions/
├── release/
│   ├── release.ts                  prepare and publish
│   └── notes/
├── lab/
│   ├── fixtures.json               tagged copies of reference apps plus synthetic apps, at pinned versions
│   ├── real-apps.json              opted-in real apps (lifeor2-client)
│   └── rehearse.ts                 upgrade each to a candidate, run checks, score
├── sales/                          TERMS-OF-SALE and licence source texts
├── skills/                         maintainer skills: platform dependency updates, release, lab
└── .github/workflows/
    ├── release.yml                 tags and publishes the product repo
    └── lab.yml                     rehearsals and first-contact tests per release candidate
```

### Where today's files go

| Today | Goes to | Repo |
| --- | --- | --- |
| `AGENTS.md`: trackers, release, "Maintaining this file", platform internals | `AGENTS.md` (layer 3) | Maintainer |
| `AGENTS.md`: conventions, imports, testing rules, commands, warnings | `platform/AGENTS.md` (layer 2) | Product |
| — (new) | Root `AGENTS.md` and `CLAUDE.md` templates (layer 1) | Product |
| `README.md` | `platform/README.md`, plus a short stable root README | Product |
| `LICENSE`, `COMMERCIAL-LICENSE.md` | `platform/`; the root keeps the evaluation `LICENSE` until adoption | Product |
| `TERMS-OF-SALE.md` | `sales/` | Maintainer |
| `CHANGELOG.md`, `VERSIONING.md`, `UPGRADING.md` | `platform/` | Product |
| `docs/roadmap.md`, the `*-plan.md` trackers | `docs/`, `docs/trackers/` | Maintainer |
| `docs/dependency-log.md`, `dependency-catchup.md`, `SECURITY-REVIEW.md` | `docs/` | Maintainer |
| `docs/starter-upgrade-brainstorm.md`, `starter-versioning-strategy.md`, `starter-upgrades.md`, `docs/upgradeability/*` | `docs/upgradeability/` | Maintainer |
| Architecture docs (`audit-trail-*`, `rate-limiting-architecture`, `i18n-architecture`, `authentication-and-onboarding`, `deployment-architecture`, `docs/claude/architecture.md`) | Split by the layer test: behaviour and usage → `platform/docs/`; internals → `docs/platform-internals/` | Both |
| Usage docs (`docs/claude/code-style.md`, `testing.md`, `development.md`, `ci.md`; `convex-migrations.md`; `deployment-runbook.md`; `aws/*`; `ops-cli.md`; `dependency-updates.md` and `dependency-migrations.md` as method) | `platform/docs/` | Product |
| `apps/admin`, `apps/storybook` | `platform/apps/` | Product |
| `apps/demo` | Stays in `apps/`; lab uses tagged copies | Product |
| `packages/starter-sidebar-policy` fixtures, `scripts/starter-upgrade/rehearse.ts` | `lab/` | Maintainer |
| `packages/*` except `backend` | `platform/packages/`, renamed `@web-app-starter/*` | Product |
| `packages/backend` platform functions | `platform/packages/convex-platform` (component), wrappers in `convex/platform/` | Product |
| `packages/backend` sample domain | Stays in the app zone of `convex/` | Product |
| Dev and CI scripts (including the new `setup-e2e.sh`), `resolve-i18n-conflicts.ts`, `codemods/`, upgrade and ownership checks | `platform/tooling/` | Product |
| `scripts/release.*`, `.github/workflows/release-starter.yml` | `release/`, `.github/workflows/release.yml` | Maintainer |
| `.claude/commands/upgrade-starter.md`, `pr-review*.md` | `platform/agent-skills/` | Product |
| `.agents/skills/deps-*` | App variants → `platform/agent-skills/`; maintainer variants → `skills/` | Both |

The existing starter-upgrade machinery (`.starter-version`, the ownership check, the sidebar-policy package demo, the rehearsal) predates these drafts. The ownership check becomes the zone check, the rehearsal becomes the lab, and `.starter-version` becomes the app's `.platform-base.json`. Each piece still needs a keep, port or retire decision during the move.

## The maintainer workspace

```text
~/dev/web-app-starter-maintainer/        ← start maintainer agents here
├── AGENTS.md  CLAUDE.md                  layer 3: loaded first
└── product/                              git clone of web-app-starter (gitignored)
    ├── CLAUDE.local.md / AGENTS.override.md   written by setup/, gitignored: "you are a maintainer; read ../AGENTS.md"
    ├── AGENTS.md  CLAUDE.md              layer 1 (reference-app guide)
    └── platform/AGENTS.md                layer 2 (usage guide: a deliverable)
```

The layer 3 `AGENTS.md` settles any conflict in plain words:

> You maintain the platform. Everything in `product/` is yours to change, including `platform/`. Layers 1 and 2 (`product/AGENTS.md`, `product/platform/AGENTS.md`, `product/platform/docs/`) are **deliverables written for app developers**. Keep them accurate, and update them in the same PR as any change that affects them. They don't limit what you may change. When you work on a reference app, follow layers 1 and 2 only, as a buyer would.

Worktrees for parallel work live under `product/`. The setup script adds the override file to each one (gap 2). A worktree *without* the override file is a clean buyer's view, which is useful for testing the usage guide.

## The zone rule and upgrades

**Rule:** anything under a directory named `platform/`, or any file named `platform-*`, is platform-owned. In an adopted app it's never edited by hand.

| File class | Examples | On upgrade |
| --- | --- | --- |
| **Platform zone** | `platform/**`, `convex/platform/**`, `.github/workflows/platform-*.yml`, `.claude/skills/platform-*` | Taken wholesale from the release |
| **Seams** | `app.config.ts`, root `package.json`, `turbo.json`, `renovate.json`, Convex `schema.ts`, `convex.config.ts`, `http.ts` | Three-way merge; the zone check confirms the required hooks are still present |
| **App zone** | Everything else, including adopted reference apps | Left alone |

**Escape hatch.** If an app must change platform code before we can, it marks the edit `// PLATFORM-PATCH: <reason>` and records it in `.platform-base.json`. The zone check fails CI on unrecorded platform-zone edits. The upgrade shows each recorded patch against the new platform files.

### `bun run platform:upgrade --to vX.Y.Z`

The promise, in outline. It needs its own design document later.

1. **Use the target's tool:** fetch the release and run *its* upgrade tool.
2. **Plan (read-only):** advisories, the breaking-change manifest, new env, migrations, seam conflicts, recorded patches, and removed env vars that app code still reads.
3. **Apply:** a merge commit with the platform zone from the release, the app zone untouched, seams merged three-way, and codemods run.
4. **Verify:** zone check, contracts, the platform suite (because `platform/**` changed), the app's tests, env check, migration status.
5. **Record:** update `.platform-base.json`.

**Topics for the future design:**

- Skipping versions (v2.1 → v2.4): run each release's codemods and migrations in order.
- Seam hook definitions and how the zone check finds them.
- Conflict handling inside seams.
- How agents drive the tool, and its stop conditions.
- Dry runs on a copy.
- Rolling back a failed upgrade.
- Convex data migrations that must run before or after the code deploy.

## Adopting the starter

`bun run adopt`, run once after cloning:

1. Set product name, ports, cookie prefix and origins in `app.config.ts`.
2. Replace the root `README.md`, `LICENSE` (proprietary, carving out `platform/`), `AGENTS.md` and `CLAUDE.md` with `platform/templates/` versions.
3. Optionally remove the sample domain, `demo`, `landing` and `landing-static`.
4. Link platform skills into the agent tool folders.
5. Write `.platform-base.json` (version, commit) and add the `upstream` remote.
6. Run the zone check and a build; print what's the app's and what's the platform's.

## CI: the buyer's CI is ours

The product repo's CI is the CI buyers adopt, and that's a selling point: sharded E2E, security scanning, build-once/promote deploys, and a local mirror via `act`, all maintained by us. Its logic lives in `platform-*.yml` reusable workflows and `.github/actions/`. The app keeps thin `ci-*.yml` and `cd-*.yml` callers.

### Where a private app repo differs

The starter repo is public, so it gets GitHub features for free that a private business-app repo may not have. The table reflects GitHub's plans as we understand them; **verify each row against current GitHub pricing before documenting it for buyers.**

| Feature used today | Public repo | Private repo | Our handling |
| --- | --- | --- | --- |
| Actions minutes (72 jobs, 4-shard E2E) | Free standard runners | Monthly quota by plan; overage is billed | Document typical minutes per PR; make the E2E shard count a setting |
| CodeQL code scanning (`security.yml`) | Free | Needs GitHub Advanced Security / Code Security | Job runs only when available; otherwise it's skipped with a notice |
| `dependency-review-action` | Free | Needs GitHub Advanced Security | Same: conditional |
| Artifact attestations (`actions/attest`, 6 uses) | Free | Needs Enterprise Cloud | Conditional; the deploy still works without them |
| Environment protection rules (`cd-*` use `environment:`) | Free | Required reviewers need a paid plan | Deploys work; the approval gate is documented as plan-dependent |
| Branch protection and rulesets | Free | Paid plan | Document; not required for CI to run |
| Artifact and cache storage | Generous | Smaller quota | Keep retention short; document |
| TruffleHog secret scan | Works | Works | No change |

**The rule:** every workflow works on the cheapest private plan. Features that need a paid plan skip cleanly with a visible notice, rather than failing. A small setting (repository variables, documented in `platform/docs/ci.md`) turns them on when the app's plan has them.

### What CI runs, where

| Check | Every PR in the product repo | Every PR in an app | Maintainer repo lab (per release candidate) |
| --- | --- | --- | --- |
| Build, lint, types, app tests | Yes | Yes | — |
| Platform contracts | Yes | Yes | — |
| Platform unit suite | When `platform/**` changes (most PRs) | When `platform/**` changes (upgrade PRs) | — |
| Zone check | Yes (reference apps must pass as buyers do) | Yes | — |
| Adopt, strip the sample, build | — | — | Yes |
| Upgrade rehearsals (reference apps at older tags, lifeor2-client) | — | — | Yes |
| First-contact agent test | — | — | Yes |

**Dropped:** v2's "no maintainer material" check. As you pointed out, an app can have its own roadmap or security review, and a filename denylist can't tell ours from theirs. Keeping our material out of the product repo is a release-checklist item, not a CI rule.

## The Convex platform component

Unchanged from v2. In short:

- **Component** (`platform/packages/convex-platform`): the platform's tables and logic.
- **Wrapper layer** (`convex/platform/`, platform-owned): Better Auth, identity checks, the public functions `web` and `admin` call (56 references today), HTTP routes and crons.
- **App-owned:** the app's own tables and functions.

Constraints from the Convex docs:

- No `ctx.auth` inside a component.
- Clients can't call component functions directly.
- Environment variables must be declared by the component (16 to declare).
- No `.paginate()` (3 files to rework).
- IDs become strings across the boundary.

**Spike on `auditTrail`** (2–3 days). Exit criteria:

- Declared env works.
- The paginator replaces `.paginate()`.
- The admin app reads through the wrappers.
- `convex-test` passes.
- The data migration runs on a staging copy.

If the spike fails, fall back to platform functions in `convex/platform/` without a component. The zone rule works either way.

**Data migration:** runs once on the starter's **staging** deployment and on lifeor2-client. Production isn't set up yet, so it starts on the new shape.

## Cutting a release

| Step | Where | What happens |
| --- | --- | --- |
| 1. Develop | Product repo | PRs to `main` from the maintainer workspace |
| 2. Prepare | Maintainer repo: `release/release.ts prepare vX.Y.Z` | Draft `platform/CHANGELOG.md` with advisories and severity, plus a **breaking-change manifest** (renamed or removed env, new required env, migrations, removed files, renamed exports, codemods). Bump `platform/VERSION`. Open a release PR on the product repo. |
| 3. Rehearse | Maintainer repo: `lab.yml` | Upgrade lab fixtures and lifeor2-client to the candidate. Run all checks and the data migration on copies. Run the first-contact agent test. Record results in the evidence log. Red blocks the release. |
| 4. Publish | Maintainer repo: `release.yml` | After the release PR merges: tag `vX.Y.Z` on the product repo and publish the GitHub release. Later, publish packages under the reserved scope if we choose to. |
| 5. Announce | GitHub release and security advisories | Security fixes get a GitHub Security Advisory with affected versions |
| 6. Record | Maintainer repo | Release log, evidence log, dependency log |

Release notes cover the **platform only**. Reference-app changes are visible in git history, but we don't describe or port them (decision 15).

## What "registry" meant, and why it's settled

In the brainstorm, "registry" meant **the channel that delivers platform code to apps as versioned packages**: a private npm registry or GitHub Packages, with access tokens per licence. Its main reason to exist was to **gate access** to paying customers. Two decisions remove that need:

- **The source is public, and the licence is enforced legally** (decision 11), so there's nothing to gate.
- **The platform zone arrives through git, taken wholesale** on upgrade, so apps don't need a package registry to get platform code.

What remains is optional: publishing some platform packages (the Convex component, for instance) to **public** npm later, for convenience. That's why the scope is picked now (decision 14): if we ever publish, nothing has to be renamed. **Reserve the npm organisation now** even if we never publish, so nobody else takes the name.

## Migration plan

1. **Create the maintainer repo and workspace.** Move maintainer-only docs, `TERMS-OF-SALE.md`, the security review, release tooling and upgrade fixtures. Write the layer 3 `AGENTS.md` from today's maintainer content. Add the setup script with override files. This changes no product code.
2. **Write layers 1 and 2.** Split today's `AGENTS.md` and docs with the layer test. Add the root templates. Build the reference apps from them from now on.
3. **Add the configuration seam** (`app.config.ts`: name, ports, cookie prefix, origins) and upstream lifeor2-client's improvements (brainstorm v2, exploration 0).
4. **Convex spike** on `auditTrail`; decide between the component and `convex/platform/` alone.
5. **The big move:** the `platform/` zone, the `@web-app-starter/*` scope with a codemod, the adopt and zone-check tooling, auth routes out of `web`, reusable `platform-*.yml` workflows with plan-conditional jobs, and the Renovate preset.
6. **The rest of the component migration**, if the spike passed, including the staging data migration.
7. **Publish v2.0.0** as the first release in the final shape. Mark v1.0.0 in `platform/CHANGELOG.md` as prepared but never published.
8. **Re-baseline lifeor2-client** onto v2.0.0 as the lab's first real-app rehearsal and the next evidence-log row.
9. **Later:** the first-contact agent test harness (the seven tasks from v1), then the detailed `platform:upgrade` design. A "before" baseline for the agent test can be taken at any time by checking out the pre-migration commit. It doesn't need to block the migration.

## Open items

None of the v2 questions remain open. New, smaller items to settle during the work:

1. **Tool mechanics:** confirm how Claude Code and Codex load `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` and `AGENTS.override.md` in nested repos and worktrees.
2. **npm organisation name:** confirm `web-app-starter` is available, or pick the scope's final name.
3. **GitHub plan table:** verify the private-repo rows against current GitHub pricing.
4. **Existing starter-upgrade machinery:** keep, port or retire each piece.
5. **Layer split of architecture docs:** done file by file in migration step 2.
