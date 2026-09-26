# Repo separation: starter platform and business apps

**Status:** authoritative design, 2026-09-25. Replaces the repo-separation drafts v1–v4 (recoverable from git history, commit `ce04f4f`).
**Background:** [brainstorm v2](brainstorm-v2.md) (the wider upgradeability thinking) and the [lifeor2-client case study](case-study-lifeor2-client.md) (evidence from the first real app).
**Implementation:** [repo-separation-implementation-plan.md](repo-separation-implementation-plan.md).

## 1. Summary

The starter is split two ways:

- **Two repositories.**
  - The public **product repo** (`web-app-starter`) holds only what buyers receive.
  - The private **maintainer repo** (`web-app-starter-maintainer`) holds everything about developing, testing and releasing the platform.
- **Two zones inside the product repo.**
  - Anything under a directory named `platform/`, or any file named `platform-*`, is the **platform**. We maintain it, and apps take it wholesale on upgrade.
  - Everything else is the **app zone**, owned by whoever builds the app.

Instructions follow the same split:

- **The product repo teaches how to build an app on the platform.**
- **The maintainer repo teaches how to develop the platform.**

Step-by-step procedures for building on the platform ship as [Agent Skills](https://agentskills.io) inside the platform zone. Buyers receive platform releases through a shipped GitHub Actions workflow. Each weekday it checks for a new release, runs the upgrade, and opens a pull request labelled by severity.

## 2. Why

**The goal.** A paying developer should keep getting value from the starter after day one: security and auth fixes, dependency and runtime upgrades, new platform capabilities, CI and infrastructure improvements, and new features. That has to cost less than doing the work themselves. The promise covers fixes, improvements and new features, with no time limit.

**What makes upgrades expensive.** Every piece of starter code in an app is in one of three states:

| State | Who changes it | Upgrade cost |
| --- | --- | --- |
| Consumed (taken as a unit, never edited by the app) | Starter only | Near zero |
| Owned (copied once, then the app's) | App only | Zero; the starter can only advise |
| Shared and edited (both sides change it) | Both | All of the pain |

The design moves as much as possible into the first two states. The platform zone is "consumed", the app zone is "owned", and the shared state shrinks to a few **seam** files built for the purpose.

**Evidence.** lifeor2-client, built by an agent told only to "build the app based on the web-app-starter", shows what happens without this structure. A trial merge of 9 days of starter changes produced **28 conflicted files and two silent runtime breaks**:

- The product code itself merged cleanly.
- The conflicts came from missing seams: hard-coded ports and cookie names (9 files), a hand-ported starter fix (8), starter docs edited in place (4), dependencies (4) and hard-coded branding (2).
- The silent breaks were renamed environment variables still read by app code, and a security fix that would be silently undone by "take the starter's version" during conflict resolution.

The [case study](case-study-lifeor2-client.md) has the full analysis.

## 3. Decisions

| # | Decision | Why |
| --- | --- | --- |
| 1 | Two repos: a public product repo and a private maintainer repo | Buyers should never see how the starter is planned, audited or released. Release tooling and upgrade tests also need a home that doesn't ship |
| 2 | Keep the current `web-app-starter` repo as the product repo | Keeps its CI, deployments, Renovate, issue and PR history, and lifeor2-client's merge base. Cost: old maintainer material stays in public history |
| 3 | Zone rule: `platform/` directories and `platform-*` files | "Platform" names the lasting relationship: fixes and features keep arriving. "Starter" implies you start from it once and move on. A single rule is easy for agents to hold and for CI to check. The `platform-*` form exists because some tools pin locations (Convex, GitHub workflows, agent skills) |
| 4 | Buyer, evaluator and app developer are one audience, at two moments | Before adoption they read the repo as a product; after, the root is theirs. The adopt step flips the few files that care |
| 5 | The web dashboard and sample domain are reference code, owned by the app after adoption | Apps replace their UI; the starter shouldn't keep pushing changes into it |
| 6 | The admin app is platform-owned and consumed as-is (themed and switched, not edited) | It's the most likely part to be used unchanged, and it isn't localized for that reason |
| 7 | Headless design only for security-sensitive auth flows | Auth routes carry security fixes that must keep reaching apps, whatever the UI looks like. Everything else is reference UI |
| 8 | Product repo instructions cover only *using* the platform | App developers build apps; they don't develop the platform |
| 9 | Maintainers build the reference apps using only the product repo's guidance and skills | This dogfoods the buyer's experience. Gaps show up in our own work first |
| 10 | Agent Skills deliver the platform's procedures | Loaded on demand, portable across agent tools, versioned with the platform |
| 11 | Package scope `@web-app-starter/*`; npm organisation claimed; **nothing is published** | `@repo` and `@platform` belong to others (`@platform/auth` exists), so a scope we own removes dependency-confusion risk. Publishing isn't needed: the platform arrives through git |
| 12 | Updates reach apps through a shipped `platform-update` workflow, plus an advisory check in regular CI | Covers the whole platform (packages, admin, tooling, CI, docs, skills) through one channel |
| 13 | The product repo's CI is the CI buyers adopt | A selling point. It must work on GitHub Free private repos |
| 14 | The product repo is public; the licence is enforced legally | No access-control infrastructure to run |
| 15 | Convex platform component, after a spike on `auditTrail` | Isolates platform tables and schema from app data. The spike tests the documented constraints before committing |
| 16 | Storybook ships as the design system's reference, platform-owned | Buyers use it; they don't edit it |
| 17 | The app template ships a proprietary root `LICENSE` that carves out `platform/` | The app's licence must not claim platform code it doesn't own. Needs a lawyer's read before publishing |
| 18 | Security review, roadmap, trackers, dependency log and release tooling are maintainer-only | Buyers don't need them. They're already in public history, so fix any unresolved findings rather than rely on moving the file |
| 19 | First release in the new shape: **v2.0.0** | v1.0.0 was prepared but never published. The new shape is a breaking change |
| 20 | Release notes cover the platform only; no effort goes into porting reference-app changes to adopted apps | Reference code is the app's once adopted |
| 21 | Keep the starter's staging deployment and migrate its data; production isn't set up yet | Staging holds useful state; production starts on the new shape |
| 22 | Unattended agent upgrades stop on: an advisory above medium, a platform-table migration touching rows, a new secret, or a red contract suite | These are the cases where a wrong call is expensive or irreversible |
| 23 | Buyer contributions back to the starter are out of scope for now | Public PRs are off |
| 24 | The earlier starter-upgrade machinery (`.starter-version`, ownership check, sidebar-policy demo, rehearsal scripts) is out of scope | It must not constrain this design; it's replaced as the new pieces land |
| 25 | Accepted risks: see §20 | |

## 4. Glossary

| Term | Meaning |
| --- | --- |
| **Starter** | The product we sell: the public `web-app-starter` repo, as released |
| **Platform** | What we keep maintaining after an app adopts the starter: `platform/` directories and `platform-*` files |
| **App zone** | Everything outside the platform zone; owned by the app |
| **Reference apps** | The starter's own app zone: `apps/web`, `apps/demo`, `apps/landing`, `apps/landing-static` and the sample domain |
| **Seam** | A file where the app plugs into the platform: `app.config.ts`, root `package.json`, `turbo.json`, `renovate.json`, Convex `schema.ts`, `convex.config.ts`, `http.ts` |
| **Skill** | An [Agent Skills](https://agentskills.io) folder: `SKILL.md` (name, description, instructions) plus optional scripts and references |
| **Contract** | A presentation-free test of platform behaviour that must stay green in every app (auth, authorization, headers, env) |
| **Maintainer** | Whoever develops and releases the platform |
| **App developer** | Whoever evaluates, adopts and builds on the starter |
| **Adopt** | The one-time step that turns a clone into an app |
| **Upgrade** | Taking a newer platform release into an adopted app |

## 5. The two repositories

| | Product repo `web-app-starter` | Maintainer repo `web-app-starter-maintainer` |
| --- | --- | --- |
| Visibility | Public; licence enforced legally | Private |
| Audience | App developers; maintainers while writing code | Maintainers only |
| Contains | Platform zone, reference apps, root templates, platform usage docs and skills, `platform/CHANGELOG.md`, adopt, upgrade and update tooling, the CI buyers adopt | Platform development docs and skills, roadmap, trackers, dependency log, security review, upgradeability docs (including this one), release tooling and workflows, the upgrade lab, workspace setup, sales and licence texts |
| Where code changes happen | Here, through PRs | Nowhere; it changes only its own docs and tooling |

### Product repo layout

```text
/                                   seams and templates; after adoption, the app's
├── README.md                       short and stable: what this is, where to start, "run bun run adopt"
├── LICENSE                         evaluation licence until adoption; then proprietary, carving out platform/
├── AGENTS.md  CLAUDE.md            layer 1: app guide template
├── .platform-base.json             after adoption: installed version, base commit, recorded patches
├── app.config.ts                   configuration seam
├── package.json  turbo.json  tsconfig.json  eslint.config.mjs  renovate.json    thin; extend platform/config/
├── apps/
│   ├── web/  demo/                 reference apps (web's auth routes re-export from @web-app-starter/auth-ui)
│   └── landing/  landing-static/   reference marketing sites; removable at adoption
├── packages/backend/convex/        the single Convex project
│   ├── convex.config.ts  schema.ts  http.ts     seams
│   ├── platform/                   platform-owned wrappers: public API, auth, HTTP routes, crons
│   └── <app functions>             includes the sample domain
├── platform/                       platform zone; taken wholesale on upgrade
│   ├── AGENTS.md                   layer 2: how to build on this platform version
│   ├── README.md  CHANGELOG.md  UPGRADING.md  VERSIONING.md  VERSION  LICENSE  COMMERCIAL-LICENSE.md
│   ├── apps/admin/  apps/storybook/
│   ├── packages/                   @web-app-starter/*: auth, auth-ui, convex-platform, design-system,
│   │                               design-patterns, i18n, edge-rate-limit, ops, paper-roll
│   ├── agent-skills/               platform skills
│   ├── tooling/                    dev scripts, setup-e2e, local CI, adopt, upgrade, update check, zone check, codemods
│   ├── config/                     tsconfig, ESLint, Turbo bases; Renovate preset (ignores platform/**)
│   ├── docs/                       layer 2 reference
│   └── templates/                  layer 1 templates (README, LICENSE, AGENTS.md, CLAUDE.md, update-platform.yml)
├── infra/aws/                      platform-owned scripts and templates; app-owned params/
├── .github/
│   ├── actions/                    platform-owned composite actions
│   └── workflows/
│       ├── platform-*.yml          reusable workflows (CI, CD, security, update)
│       ├── ci-*.yml  cd-*.yml      thin app-owned callers
│       └── update-platform.yml     app-owned caller: the update schedule
├── .claude/skills/platform-*       links to platform/agent-skills (Claude Code)
└── .agents/skills/platform-*       links to platform/agent-skills (Codex)
```

### Maintainer repo layout

```text
web-app-starter-maintainer/
├── AGENTS.md  CLAUDE.md           layer 3: how to develop, test and release the platform
├── product/                        clone of web-app-starter (gitignored)
├── setup/                          per-machine and per-worktree setup
├── skills/                         starter-release, starter-lab, starter-deps (installed at user level)
├── docs/
│   ├── platform-internals/         the "why it's built this way" halves of architecture docs
│   ├── roadmap.md  trackers/  dependency-log.md  dependency-catchup.md  security-review.md
│   ├── upgradeability/             this document, the brainstorms, case studies, evidence log
│   └── decisions/
├── release/                        release.ts, notes/
├── lab/                            fixtures.json, real-apps.json, rehearse.ts, skill and first-contact tests
├── sales/                          TERMS-OF-SALE and licence source texts
└── .github/workflows/              release.yml, lab.yml
```

### Where today's files go

| Today | Goes to | Repo |
| --- | --- | --- |
| `AGENTS.md`: trackers, release, internals, "Maintaining this file" | `AGENTS.md` (layer 3) | Maintainer |
| `AGENTS.md`: conventions, imports, testing rules, commands, warnings | `platform/AGENTS.md` (layer 2) | Product |
| — (new) | Root `AGENTS.md`, `CLAUDE.md` templates (layer 1) | Product |
| `README.md` | `platform/README.md`, plus a short root README | Product |
| `LICENSE`, `COMMERCIAL-LICENSE.md` | `platform/`; the root keeps the evaluation licence until adoption | Product |
| `TERMS-OF-SALE.md` | `sales/` | Maintainer |
| `CHANGELOG.md`, `VERSIONING.md`, `UPGRADING.md` | `platform/` | Product |
| `docs/roadmap.md`, `*-plan.md` trackers, `dependency-log.md`, `dependency-catchup.md`, `SECURITY-REVIEW.md` | `docs/` | Maintainer |
| `docs/starter-upgrade-brainstorm.md`, `starter-versioning-strategy.md`, `starter-upgrades.md`, `docs/upgradeability/*` | `docs/upgradeability/` | Maintainer |
| Architecture docs (audit trail, rate limiting, i18n, auth and onboarding, deployment architecture, `docs/claude/architecture.md`) | Split by the layer test (§7): behaviour → `platform/docs/`; internals → `docs/platform-internals/` | Both |
| Usage docs (code style, testing, development, CI, Convex migrations, deployment runbook, AWS, ops CLI, dependency method) | `platform/docs/` | Product |
| `.claude/commands/*.md`, `.agents/skills/deps-*` | App-facing versions → `platform/agent-skills/`; maintainer versions → `skills/` | Both |
| `apps/admin`, `apps/storybook` | `platform/apps/` | Product |
| `apps/demo`, `apps/web`, `apps/landing*` | Stay in `apps/` (reference apps) | Product |
| `packages/*` except `backend` | `platform/packages/`, renamed `@web-app-starter/*` | Product |
| `packages/backend` platform functions | Convex component plus `convex/platform/` wrappers | Product |
| `packages/backend` sample domain | App zone of `convex/` | Product |
| Dev and CI scripts | `platform/tooling/` | Product |
| `scripts/release.*`, `release-starter.yml` | `release/`, `.github/workflows/release.yml` | Maintainer |

## 6. The zone rule, seams and the escape hatch

**Rule:** anything under a directory named `platform/`, or any file named `platform-*`, is platform-owned. In an adopted app it's never edited by hand.

| File class | Examples | On upgrade |
| --- | --- | --- |
| Platform zone | `platform/**`, `convex/platform/**`, `.github/workflows/platform-*.yml`, `.claude/skills/platform-*`, `.agents/skills/platform-*` | Taken wholesale from the release. No merge |
| Seams | `app.config.ts`, root `package.json`, `turbo.json`, `renovate.json`, `schema.ts`, `convex.config.ts`, `http.ts` | Three-way merge; the zone check confirms the platform's required hooks are still present |
| App zone | Everything else, including adopted reference apps | Left alone |

**Why wholesale works:** apps never edit the platform zone, so there's nothing to merge. That's the payoff of the whole design. Only seams still need a real merge, and they're few, small and built for it.

**The escape hatch.** Sometimes an app has to change platform code before we can. It then:

1. marks the edit `// PLATFORM-PATCH: <reason>`;
2. records it in `.platform-base.json`.

The `platform-patch` skill does both and drafts a request to us. The **zone check** fails CI on any platform-zone edit that isn't recorded. On upgrade, each recorded patch is shown against the new platform files: it's dropped if the release now covers it, and reviewed otherwise.

lifeor2-client's cookie-prefix change would have been a recorded patch and a request, not a silent conflict. **Reference apps never carry patches:** a needed platform change is made as platform work and released, so the examples teach the right habit.

### The configuration seam

`app.config.ts` holds every value an app is likely to change. Starter code reads these values; it never contains them as literals. In lifeor2-client, missing values of exactly this kind caused 9 conflicted files and a silent break.

| Group | Values |
| --- | --- |
| Identity | Product name, legal entity, support email, URLs |
| Runtime | Ports, auth cookie prefix, origins |
| Brand | Logos, design-token overrides, email palette and footer |
| Switches | Optional platform features (waitlist, invitations, announcements, environment banner) |

Optional platform features are **switched off, not deleted**. Their code keeps receiving fixes and never conflicts.

### Localization

- **Each message namespace has one owner.** Platform namespaces (auth, errors, password strength, timezones) live in platform files. App namespaces live in app files. They're merged at load time.
- **App overrides of platform strings** live in a small app-owned file. Validation flags overrides of keys that no longer exist.
- **The product name leaves the message files** and is passed in as an argument from `app.config.ts`.
- **The app chooses which locales it ships.** The platform keeps translating its own strings into all 15.

## 7. The instruction model

### The principle

| Question an agent is answering | Where the answer lives |
| --- | --- |
| "How do I build this product?" | Root `AGENTS.md`: app-owned; we ship a starting template |
| "What does the platform require, at the version installed here?" | `platform/AGENTS.md` and `platform/docs/`: platform-owned, replaced on upgrade |
| "How do I do this platform task, step by step?" | A platform skill in `platform/agent-skills/`, loaded when the task matches |
| "How do I upgrade the platform?" | The `platform-upgrade` skill and `platform/UPGRADING.md` |
| "How do I change, test or release the platform itself?" | The maintainer repo only |

### Three layers

| Layer | Files | Owner | Content | Changes when |
| --- | --- | --- | --- | --- |
| **1. App guide** | Root `AGENTS.md`, `CLAUDE.md` | App (we ship the first version) | What the product is, the app's own conventions, and a "read first" pointer to layer 2 | Whenever the app wants. Upgrades never touch it |
| **2. Platform usage** | `platform/AGENTS.md`, `platform/docs/`, `platform/agent-skills/` | Platform zone | Rules the platform dictates, seams, best practices, contracts, and procedures as skills | Every release; replaced on upgrade, so it always matches the installed code |
| **3. Platform development** | Maintainer repo `AGENTS.md`, `docs/`, `skills/` | Maintainer repo | Internals, platform testing, release, roadmap, logs, the lab. Also that layers 1 and 2 are deliverables to keep accurate | Whenever we want; never shipped |

**Why platform rules can't live in the root template:** the root file is app-owned after adoption and stops receiving updates. The platform's rules change with each release, so they live in layer 2.

**The layer test** decides where any document goes: "Would an app developer need this without ever editing `platform/`?" If yes, it's layer 2; if no, layer 3. Architecture docs are split file by file on this test. Rate limiting is an example: its behaviour and settings go to layer 2, its internal design to layer 3.

### Who reads what

| Who, doing what | Reads |
| --- | --- |
| App developer's agent building the product | Layers 1 and 2; platform skills on demand |
| Maintainer building a reference app | Layers 1 and 2, exactly like a buyer. If the agent struggles, layer 2 has a gap |
| Maintainer changing the platform | Layer 3 first, then layer 2 as the deliverable to keep accurate |

### How agent tools load instructions (verified)

Sources: [Claude Code memory](https://code.claude.com/docs/en/memory), [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

| Behaviour | Claude Code | Codex |
| --- | --- | --- |
| Files read | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`. Reads `AGENTS.md` only when no `CLAUDE.md` or `CLAUDE.local.md` exists at or above the launch directory | `AGENTS.override.md`, else `AGENTS.md`: one file per directory |
| Directories | Launch directory and all parents at launch; subdirectories when it reads files there | Repo root down to the launch directory; **nothing below it** |
| Imports | `@path`, up to four levels deep. Paths outside the project need one-time approval | None documented |
| Local, uncommitted file | `CLAUDE.local.md`, read after `CLAUDE.md`; exists only in the worktree where it was created | `AGENTS.override.md` **replaces** `AGENTS.md` in its directory |
| Size | Guidance: under 200 lines per file | 32 KiB combined by default |

**Consequences:**

1. The template root `CLAUDE.md` contains `@AGENTS.md` and `@platform/AGENTS.md`, so Claude Code loads both at launch.
2. The template root `AGENTS.md` opens with "Before any task, read `platform/AGENTS.md`". Codex doesn't load files below its launch directory.
3. Layers 1 and 2 together stay well under 32 KiB. Detail goes into `platform/docs/` and skills.

### Maintainer instructions

The maintainer writes code in the product repo but takes instructions from the maintainer repo.

```text
~/dev/web-app-starter-maintainer/          ← start here for platform work
├── AGENTS.md  CLAUDE.md                    layer 3
├── setup/
└── product/                                clone of web-app-starter (gitignored)
    ├── CLAUDE.local.md                     written by setup/, gitignored
    ├── AGENTS.override.md                  written by setup/, gitignored
    ├── AGENTS.md  CLAUDE.md                layer 1
    └── platform/AGENTS.md                  layer 2
```

- **Started at the maintainer repo root:** layer 3 loads first. Layers 1 and 2 load as the agent works in `product/`.
- **Started inside a product worktree** (worktrees, the no-mistakes pipeline, review commands):
  - `CLAUDE.local.md` imports the maintainer `AGENTS.md`; Claude Code asks for approval once.
  - `AGENTS.override.md` replaces `AGENTS.md` for Codex. It carries the maintainer pointer **and** "then read `AGENTS.md` in this directory".
  - `CLAUDE.local.md` exists only in the worktree where it was created, so the setup script writes both files into each new worktree.
- **A worktree without the override files** is a clean buyer's view. Use it to test layers 1 and 2.
- **Layer 3 says, in plain words:**

  > You maintain the platform. Everything in `product/` is yours to change, including `platform/`. Layers 1 and 2 are deliverables written for app developers. Keep them accurate, and update them in the same PR as any change that affects them. When you work on a reference app, follow layers 1 and 2 only, as a buyer would.

The product repo's `.gitignore` lists `CLAUDE.local.md` and `AGENTS.override.md`. Those are generic names buyers can use too.

## 8. Agent Skills

Skills keep `platform/AGENTS.md` short. Agents load only each skill's name and description at startup, and the full instructions when a task matches. Skills live in the platform zone, so every upgrade replaces them with the version for the installed platform. The format is an open standard supported by Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI and many others.

### Initial catalogue

| Skill | Does |
| --- | --- |
| `platform-configure` | Set name, ports, cookie prefix, origins and brand in `app.config.ts` |
| `platform-add-table` | Add app tables next to the platform component: schema seam, indexes, tests |
| `platform-add-page` | Add a page and nav entry in an app that owns its shell, with auth guard and i18n |
| `platform-add-strings` | Add messages in the app's namespace and the locales it ships |
| `platform-feature-<name>` | Wire an optional platform feature into the app's UI (one per feature; see §15) |
| `platform-upgrade` | Run `platform:upgrade`, read the plan, resolve seams, run checks, finish an update PR |
| `platform-patch` | Make, mark and record a platform patch, and draft the request to us |
| `platform-deps` | Update the app's dependencies without touching `platform/**` |
| `platform-pr-review`, `platform-pr-respond` | Review workflows (today's `.claude/commands/pr-review*.md`) |

### Discovery (verified)

Sources: [Claude Code skills](https://code.claude.com/docs/en/skills), [Codex skills](https://learn.chatgpt.com/docs/build-skills).

| Tool | Project skill folder | Scan range | Symlinks |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/<name>/SKILL.md` | Launch directory and parents up to the repo root; nested folders when it works there | Supported |
| Codex | `.agents/skills/<name>/SKILL.md` | Launch directory up to the repo root | Supported |

Skills are stored once, in `platform/agent-skills/<name>/`. The adopt step links them as `platform-<name>` into both `.claude/skills/` and `.agents/skills/`.

**Maintainer skills** (`starter-release`, `starter-lab`, `starter-deps`) can't be repo-level, because both tools stop scanning at the product repo's root. The maintainer setup links them at user level (`~/.claude/skills/`, `~/.agents/skills/`) on maintainer machines.

**Skills are tested** in the lab. Each skill's task runs on a freshly adopted app, and the lab checks three things: the agent used the skill, stayed out of `platform/`, and left the build and contracts green.

## 9. Adopting the starter

`bun run adopt`, run once after cloning:

1. Set name, ports, cookie prefix and origins in `app.config.ts`.
2. Replace the root `README.md`, `LICENSE`, `AGENTS.md` and `CLAUDE.md` with templates, and add the `update-platform.yml` caller.
3. Optionally remove the sample domain, `demo`, `landing` and `landing-static`. Cheap, clean removal matters: in lifeor2-client nothing unused was deleted, so it keeps absorbing upstream churn it doesn't use.
4. Link platform skills into `.claude/skills/` and `.agents/skills/`.
5. Write `.platform-base.json` (version, commit) and add the `upstream` remote.
6. Offer update setup (the GitHub App; see §12).
7. Run the zone check and a build, and print what belongs to the app and what belongs to the platform.

Before adoption, the root describes the starter for an evaluator; after it, the root describes the product. The product repo keeps its root `README.md` and `AGENTS.md` short and stable, so they rarely change.

## 10. Contracts

Contracts are black-box tests of platform behaviour. They exercise HTTP and Convex function calls, not UI, so they survive an app replacing its screens. They run in every app's CI, on every PR.

- **Auth:** sign-in, session expiry, clear-session, banned user, admin blocked from the web app, MFA enforcement, and session and cookie isolation.
- **Endpoint authorization** for every platform function (closed, unmerged PR #150 is the starting point).
- **Security headers, rate limits, origin checks.**
- **Required environment variables** present and valid.
- **Advisory check:** the installed platform version isn't affected by a known advisory at `high` or above.

**The app's own contracts** run with the same weight. lifeor2-client already has a session-isolation test. The trial merge showed why contracts come first: the two worst outcomes merged cleanly, and only tests would catch them.

## 11. Upgrading

`bun run platform:upgrade --to vX.Y.Z` (outline; it gets its own design document):

1. Run the **target release's** tool, so the upgrader is always current.
2. Plan, read-only:
   - advisories and the breaking-change manifest;
   - new env, migrations, seam conflicts and recorded patches;
   - env vars removed in the release that app code still reads (the lifeor2 silent break).
3. Apply: platform zone from the release, app zone untouched, seams merged three-way, codemods run. Never merge the lockfile; regenerate it.
4. Verify: zone check, contracts, platform suite, the app's tests, env, migration status.
5. Record: update `.platform-base.json`.

The same tool runs locally, through the `platform-upgrade` skill, and inside the update workflow.

**Topics for its design document:** skipping versions (run each release's codemods and migrations in order), seam hook definitions, conflicts inside seams, agent stop conditions (decision 22), dry runs, rollback, and migration ordering relative to the code deploy.

**Taking one fix early.** If an app needs an unreleased platform change, it cherry-picks the upstream commit (never re-implements it) and records it in `.platform-base.json`. The next upgrade resolves those files in the release's favour. In lifeor2-client a hand-ported fix caused 8 conflicts. Frequent small releases make this rare.

## 12. Update delivery

### Why a workflow, not npm

Delivery has four jobs: learn a release exists, learn whether it's urgent, apply it, prove it works. Publishing platform packages to npm would give automatic Renovate or Dependabot PRs and security alerts. But it would split the platform into two channels (npm for packages, git for the admin app, tooling, CI, wrappers, docs and skills) that could drift out of step, and it would add a publishing pipeline. The workflow does all four jobs through git, for the whole platform. The advisory check covers the alert.

### What GitHub Actions allows (researched and verified)

| Question | Answer | Source |
| --- | --- | --- |
| Scheduled workflows in private repos? | Allowed on every plan; they use the plan's included minutes | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Included minutes (private repos) | Free 2,000/month; Pro 3,000; Team 3,000; Enterprise Cloud 50,000. Linux 2-core overage costs $0.006/min. Public repos are free | Same |
| Shortest schedule, reliability | Every 5 minutes, default branch only; delays at busy times, especially the top of the hour | [Events: schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) |
| Auto-disabled when inactive? | Only public repos, after 60 days. Private repos keep running | Same |
| Can a workflow open a PR with `GITHUB_TOKEN`? | Yes, if "Allow GitHub Actions to create and approve pull requests" is on (off by default for personal repos) | [Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository) |
| Does CI then run on it? | **Not automatically.** Such PRs start runs "in an approval-required state". GitHub recommends an App or personal token | [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token) |
| Can `GITHUB_TOKEN` push workflow-file changes? | **No, confirmed by experiment:** "refusing to allow a GitHub App to create or update workflow … without `workflows` permission". Our releases change `platform-*.yml`, so this matters | Experiment (§19) |

**Conclusion:** a daily scheduled workflow is allowed and cheap. To open a PR that CI tests, and that can include workflow changes, it needs a **GitHub App token**.

### The workflow

| File | Zone | Role |
| --- | --- | --- |
| `.github/workflows/platform-update.yml` | Platform | Reusable workflow: check, upgrade, open the PR or issue |
| `.github/workflows/update-platform.yml` | App (from the template) | Caller: schedule, manual trigger, policy. App-owned so the app picks its schedule |
| `platform/tooling/update-check.ts` | Platform | Compares installed and released versions; reads advisories |

Caller template:

```yaml
name: Update platform
on:
  schedule:
    - cron: "23 5 * * 1-5"      # weekdays 05:23 UTC; avoids the busy top of the hour
  workflow_dispatch:
    inputs:
      version: { description: "Target version (default: newest allowed)", required: false }
jobs:
  update:
    uses: ./.github/workflows/platform-update.yml
    with:
      policy: minor               # patch | minor | major: how far to auto-propose
      auto-merge: false           # true: merge clean patch updates when CI is green
    secrets: inherit
```

**`platform-update.yml` jobs:**

1. **`check`**: about 1 minute, read-only token.
   - Read the installed version from `.platform-base.json`.
   - List the public repo's releases and choose the newest target allowed by `policy`. A new major always becomes an issue, because it needs a person.
   - Read the release's `advisories.json` to get the severity for the installed version.
   - Stop if a PR for this target (branch `platform-update/vX.Y.Z`) is already open.
2. **`upgrade`**: a few minutes, only when there's a target.
   - Mint an App token (`actions/create-github-app-token`) and check out with it.
   - `bun install`, then fetch the target tag.
   - Run the target's `platform:upgrade --non-interactive --report`, then regenerate the lockfile.
   - Push `platform-update/vX.Y.Z` and open the PR with the report as its body.
   - Title example: `Platform v2.1.0 → v2.1.3 (security: high)`.
   - Labels: `platform-update`, `severity:<level>`, plus `breaking`, `migration` and `new-env` when they apply.
3. **Outcomes:**

   | Upgrade result | Action |
   | --- | --- |
   | Clean | Ready PR. With `auto-merge: true`, a clean patch with no migration or new env merges when CI passes |
   | Needs judgment (seam conflicts, patches to review, migrations) | Draft PR with a checklist; a person or an agent using `platform-upgrade` finishes it |
   | Tool failure | Issue with the log and the manual command |
   | New major | Issue linking notes and breaking changes |

4. **CI runs on the PR** like any other, because the App token opened it. The platform suite runs because `platform/**` changed.

**Advisory check in regular CI:** every run compares the installed version with the latest `advisories.json`. Severity `high` and above fails; lower warns. It reaches buyers even when the update workflow is off.

**Each release publishes**, as GitHub release assets:

- `advisories.json`: ID, severity, affected range, fixed version, summary.
- `breaking-changes.json`: the manifest the upgrade tool reads.

### Buyer setup

One time, through `bun run platform:setup-updates` or the `platform-configure` skill:

1. **Create a GitHub App** in the buyer's account or organisation, installed on the app's repo only. Permissions: Contents, Pull requests, Workflows and Issues, all write. The helper uses GitHub's [app-manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) (verified):
   - It starts a short-lived local server and opens GitHub's "new app" page with a manifest that presets the permissions through `default_permissions`.
   - The buyer confirms in the browser.
   - GitHub redirects back with a code, which the helper exchanges through `POST /app-manifests/{code}/conversions` for the App ID and private key. This must happen within one hour.
   - The helper asks the buyer to install the App, then stores the ID (repository variable) and the key (secret) with `gh`.
2. Keep or edit the schedule and policy in `update-platform.yml`.

**Without an App:** the workflow falls back to `GITHUB_TOKEN`. PRs open, but CI waits for "Approve and run". Releases that change workflow files become an issue with the manual command.

### Cost and frequency

| Item | Billed minutes |
| --- | --- |
| Weekday check | About 1 per run, about 22 a month: roughly 1% of GitHub Free's 2,000 |
| Upgrade job | A few, only when a release exists |
| CI on the update PR | The app's normal CI. The starter's own CI measured **about 62 billed minutes** for a PR touching everything (CI Web 25, Admin 7, Shared 7, Landing 6, Landing Static 6, Storybook 5, Security 5, release check 1). Path filters make typical PRs cheaper |

**Daily on weekdays is the choice.** Hourly would cost about 720 minutes a month, for releases that don't come hourly. Weekly is too slow for security fixes, and the advisory check covers the gaps between checks.

### Renovate: considered, not primary

A custom regex manager can track `.platform-base.json` against our releases, and `postUpgradeTasks` could run the upgrade tool. It's not the primary route:

- `postUpgradeTasks` works only on self-hosted Renovate with `allowedCommands`, not on the hosted Mend app.
- Upgrades would run inside Renovate's environment, which is harder to debug.
- The workflow already opens the PR.

It may be added later just to show platform updates in the Dependency Dashboard.

## 13. CI: the buyer's CI is ours

The product repo's CI is the CI buyers adopt. That's a selling point: sharded E2E, security scanning, build-once/promote deploys, and a local mirror through `act`, all maintained by us. The logic lives in `platform-*.yml` reusable workflows and `.github/actions/`. The app keeps thin callers.

**Rule:** every workflow runs on GitHub Free for a private repo. Paid features skip with a visible notice, and repository variables turn them on (documented in `platform/docs/ci.md`). Actions stay pinned to full commit SHAs, because some accounts, including the maintainer's, refuse unpinned actions.

### Private-repo differences (verified)

| Feature we use | Public repo | Private repo | Handling |
| --- | --- | --- | --- |
| Actions minutes | Free | 2,000 (Free) / 3,000 (Pro, Team) / 50,000 (Enterprise Cloud) a month | Path filters; E2E shard count as a setting; document the budget |
| Artifact storage | Free | 500 MB / 1 GB / 2 GB / 50 GB | Short retention |
| CodeQL code scanning | Free | Needs a GitHub Code Security licence | Skip with a notice unless enabled |
| `dependency-review-action` | Free | Needs GitHub Code Security or Advanced Security | Same |
| GitHub Environments (12 deploy jobs use `staging` or `production`) | Free | Free can't configure them in private repos, and their rules and secrets are ignored; Pro and Team can. A job naming a missing environment runs and auto-creates it | Deploy jobs rely only on repository-level secrets (true today), so they work on every plan |
| Required reviewers, wait timers, custom protection rules | Free | Enterprise only. **Pro refused both** in our experiment | Production approval is a paid-plan extra, not a dependency |
| Deployment branch rules; protected branches | Free | Pro and Team | Needed for auto-merge with required checks; document |
| Artifact attestations (6 uses) | Free | **Not available for user-owned private repos on any plan** (confirmed on Pro); organisation-owned need Enterprise Cloud | Skip with a notice unless public or enabled; a failed attest never fails a deploy |
| TruffleHog secret scan | Works | Works | — |

### What runs where

| Check | Product repo PRs | App PRs | Maintainer lab (per release candidate) |
| --- | --- | --- | --- |
| Build, lint, types, app tests | Yes | Yes | — |
| Contracts and advisory check | Yes | Yes | — |
| Platform unit suite | When `platform/**` changes (most PRs) | When `platform/**` changes (update PRs) | — |
| Zone check | Yes; reference apps must pass as buyers do | Yes | — |
| Adopt, strip the sample, build | — | — | Yes |
| Upgrade rehearsals | — | — | Yes |
| Skill and first-contact tests | — | — | Yes |

A "no maintainer material" check was considered and dropped. An app can have its own roadmap or security review, and a filename check can't tell those from ours. Keeping our material out is a release-checklist item.

## 14. Dependencies

- **Platform packages declare ranges (floors), not pins.** The app can raise shared dependencies such as React.
- **The app owns its lockfile and Renovate.** Its config extends a platform preset with `ignorePaths: ["platform/**"]`, so Renovate never edits the platform zone.
- **Patch-level security fixes** inside the declared ranges reach the app through lockfile maintenance.
- **Platform dependency upgrades arrive with platform releases.** Each release states its minimums, and the upgrade raises them in the app where needed. It never lowers anything.

## 15. New features in apps that own their UI

A new platform feature (API keys, notifications, teams) can't arrive as a merge into screens the app owns. Each feature ships in four parts:

| Part | Delivered as |
| --- | --- |
| Backend, tables, logic hooks, its message namespace | Platform zone; arrives with the release |
| Default UI | An add-on the app pulls into its own tree on demand; the app's code from then on |
| Wiring (route, nav entry, settings tab, permissions) | A `platform-feature-<name>` skill, because only the app knows where its nav lives |
| On/off | A switch in `app.config.ts`, **off by default for existing apps**; the feature's contracts turn on with it |

Cross-cutting features that change who owns every row (teams, organisations) aren't add-ons. They're migrations with a guide. The design gets piloted with one real feature before being generalised.

## 16. The Convex platform component

| Part | Location | Owner |
| --- | --- | --- |
| Component: platform tables (`userProfiles`, `adminEmails`, `appSettings`, `waitlistEntries`, `invitationTokens`, `adminInvitations`, `announcements`, `auditTrail`, rate-limit state) and their logic | `platform/packages/convex-platform` | Platform |
| Wrappers: Better Auth instance, identity checks, public functions for `web` and `admin` (56 references today), HTTP routes, crons | `convex/platform/` | Platform |
| App tables and functions, including the sample domain | Rest of `convex/` | App |

**Constraints from the Convex docs** ([authoring](https://docs.convex.dev/components/authoring), [understanding](https://docs.convex.dev/components/understanding)):

- No `ctx.auth` inside a component: wrappers pass the user ID.
- Clients can't call component functions: the wrappers expose them.
- Environment variables must be declared by the component: 16 to declare.
- `.paginate()` doesn't work: 3 files move to the `convex-helpers` paginator.
- IDs become strings across the boundary.
- A component can nest other components and has its own scheduler and file storage.
- `convex-test` supports components.

**The spike** migrates `auditTrail` first (2–3 days). Exit criteria:

- declared env works;
- the paginator replaces `.paginate()`;
- the admin app reads through the wrappers;
- `convex-test` passes;
- the data migration runs on a staging copy.

If any criterion fails, platform functions go to `convex/platform/` without a component. The zone rule works either way.

**Order after a successful spike:** `appSettings` and `announcements` → waitlist and invitations → `userProfiles` and sessions.

**Data:** a one-off migration copies the rows, verifies counts, then drops the old tables. It runs on the starter's staging and on lifeor2-client; production starts on the new shape.

**Data and deploy discipline for every release:**

- Platform schema changes follow expand/contract, so code and data can deploy independently.
- Migrations are idempotent, with a status check.
- Each release declares its required env, and a check fails before deploy if any is missing.

## 17. Cutting a release

| Step | Where | What happens |
| --- | --- | --- |
| 1. Develop | Product repo | PRs to `main` from the maintainer workspace |
| 2. Prepare | Maintainer repo, `release.ts prepare vX.Y.Z` | Changelog with advisories and severity; `advisories.json`; `breaking-changes.json` (renamed or removed env, new env, migrations, removed files, renamed exports, codemods); bump `platform/VERSION`; open a release PR on the product repo |
| 3. Rehearse | Maintainer repo, `lab.yml` | Upgrade the lab fixtures (reference apps at older tags, synthetic apps) and lifeor2-client **through the same `platform-update` workflow buyers use**. Run skill and first-contact tests. Record results in the evidence log. Red blocks the release |
| 4. Publish | Maintainer repo, `release.yml` | Tag `vX.Y.Z` on the product repo and publish the GitHub release with both JSON assets. Release credentials live only in the maintainer repo |
| 5. Announce | GitHub release and Security Advisory | Buyers' workflows pick it up on their next run; the advisory check flags affected versions |
| 6. Record | Maintainer repo | Release, evidence and dependency logs |

**Cadence:** small, frequent minors and patches. In the 9 days after lifeor2-client forked, the starter moved 47 commits, including a breaking change. Smaller releases mean smaller upgrades.

## 18. Evidence program

Each real app built on the starter is studied the same way:

1. Record its fork point.
2. Classify its diff.
3. Trial-merge the current starter.
4. Scan for silent breaks.
5. Record lessons with a confidence level.

Results go into the evidence log in the maintainer repo, and the totals across apps decide which seam to build next. lifeor2-client is the first entry. Synthetic lab apps complement real ones, because they can be re-run on every release.

## 19. Verification results

Experiments ran on 2026-09-25 on the private repo `tkarakai/web-app-starter-store` (owner on GitHub Pro), on a temporary branch. Runs, branch and environments were deleted afterwards, and Actions were switched off again.

| Question | Result | How we know |
| --- | --- | --- |
| A job naming a GitHub Environment in a private repo | Runs; a missing environment is auto-created. On Free, environments can't be configured in private repos, and their rules and secrets are ignored. On Pro, required reviewers and wait timers are refused ("ensure the billing plan supports the required reviewers protection rule") | Experiment on Pro, plus GitHub docs source (`manage-environments.md`) |
| Artifact attestations in private repos | "Feature not available for user-owned private repositories", on Pro. Organisation-owned private repos need Enterprise Cloud | Experiment, plus GitHub plan docs |
| Can the update App's permissions be preset? | Yes, through the manifest's `default_permissions`; confirmed in the browser; code exchanged within one hour | GitHub docs |
| Can `GITHUB_TOKEN` push workflow-file changes? | No: rejected without the `workflows` permission | Experiment |
| Does the maintainer's account allow unpinned actions? | No: unpinned actions were refused. Our workflows pin SHAs; keep it that way | Experiment |
| npm scopes | `@web-app-starter` is ours (organisation created 2026-09-25). `@repo` and `@platform` belong to others | `npm access list packages` |

## 20. Out of scope, parked and accepted risks

**Out of scope:**

- Buyer contributions back to the starter.
- Publishing to npm.
- Porting reference-app changes to adopted apps.
- The earlier starter-upgrade machinery.

**Parked** (revisit only if the lab shows failures they would have prevented):

- A semantic three-way merge engine: an agent with git, the plan and the contracts covers it.
- A full ownership manifest with enforcement: the zone rule and zone check cover it.
- A dependency resolver: published floors and a report cover it.
- A hand-kept divergence ledger: switches and recorded patches cover it.

**Accepted risks:**

| Risk | Mitigation |
| --- | --- |
| The big move breaks lifeor2-client badly | It's the lab's first rehearsal; a shipped codemod renames imports; git detects moves as renames |
| Convex component constraints are worse than documented | The spike with exit criteria; the zone rule works without the component |
| Maintainer agents get confused by the product repo's app-developer instructions | The workspace layout, override files and explicit wording in layer 3; tested like the buyer view |
| The two repos drift (maintainer docs describe product code that has changed) | Maintainer docs link to product paths by release tag; the release checklist reviews them |
| Old maintainer material stays in the public repo's history | Accepted; unresolved security findings are fixed rather than hidden |
