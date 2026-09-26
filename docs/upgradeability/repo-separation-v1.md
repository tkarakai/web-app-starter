# Separating starter and business app: who works where (draft v1)

**Version:** v1, 2026-09-25 · working draft
**Builds on:** [brainstorm v2](brainstorm-v2.md) (topics 1, 7, 15–17) and the [lifeor2-client case study](case-study-lifeor2-client.md)

## The question

Two developers work in trees with the same shape, because one was cloned from the other:

- The **starter maintainer** builds the starter itself.
- The **app developer** cloned it and builds a business product.

Each of them, and each agent they run, must know which directories are theirs and which instructions apply. Ideally the app developer never sees material that only matters for developing the starter.

## Short answer

Splitting by app ("admin is the starter's, every other app is the business's") is the right first cut, **but it covers only about a third of the problem.** Of lifeor2-client's 28 upgrade conflicts, 9 were under `apps/`. The other 19 were in root docs, `packages/auth`, dev scripts, CI workflows and the lockfile. Three of the 9 were in the admin app, which the business app edited only because the starter lacked config options (ports, cookie name).

Recommendation, in three moves:

1. **One zone rule for the whole tree:** anything under a directory named `starter/`, or any file named `starter-*`, belongs to the starter. Everything else belongs to whoever owns the repository. The rule is the same in both repos and easy to grep.
2. **The root belongs to the business app.** The starter ships root files (README, AGENTS.md, package.json) as templates written *for the app developer*, and keeps its own copies inside `starter/`.
3. **Keep maintainer-only material out of what buyers receive.** Start with a clearly marked `maintainer/` folder, then make distribution a build step that drops it.

## Three audiences, not two

| Audience | Works on | Needs to read | Should never have to read |
| --- | --- | --- | --- |
| **Starter maintainer** | Everything in the starter repo | Roadmap, trackers, release process, dependency log, upgrade fixtures, drafts like this one | Nothing is off limits |
| **App developer** (and their agents) | Their product: apps, product backend, config, brand, their own docs | How to use the starter: seams, architecture, testing, deployment, how to upgrade | Starter roadmap, release mechanics, "start at step 9" trackers, sales terms |
| **Buyer or evaluator** | Nothing yet | What the starter is, licence, price | Internal plans |

The current repo is written almost entirely for the first audience. That's why lifeor2-client's agent had to prefix the inherited `CLAUDE.md` with "conventions below are inherited … upstream trackers are historical".

## Is "admin = starter, other apps = business" enough?

For `apps/`, mostly yes, with three adjustments:

| App | Proposed owner | Adjustment needed |
| --- | --- | --- |
| `admin` | Starter (consumed) | Needs config options so apps never edit it: ports, cookie prefix, brand |
| `web` | Business | It contains starter-owned behaviour: sign-in, sign-up, reset, verify, invitations, `clear-session`, auth parts of `proxy.ts`. Move that into a starter package (for example `@repo/auth-ui` plus route handlers) so `web` only re-exports them. Then `web` is really the app's. |
| `landing`, `landing-static` | Business | Optional; must be removable in one step |
| `storybook` | Starter | It is the design system's catalogue. Ship it as starter-owned reference, or keep it maintainer-only (decision below) |
| `demo` | Maintainer only | It exists to test starter upgrades; buyers get nothing from it |

Outside `apps/`, the split says nothing, and that's where most of the confusion and conflicts are: `packages/`, `scripts/`, `.github/`, `docs/`, root files, and agent skills. The sections below cover each.

## Proposed layout

```text
/                                  app-owned root (starter ships these as templates)
├── README.md                      "<Your product>", from starter/templates/
├── AGENTS.md                      app agent guide; points at starter/AGENTS.md
├── CLAUDE.md                      @AGENTS.md
├── LICENSE                        the app's own licence
├── app.config.ts                  the configuration seam: name, ports, cookie prefix, brand, feature switches
├── package.json                   workspaces: apps/*, packages/*, starter/apps/*, starter/packages/*
├── apps/
│   ├── web/                       app-owned; auth routes re-export from @repo/auth-ui
│   ├── landing/                   app-owned, optional
│   └── landing-static/            app-owned, optional
├── packages/
│   └── backend/convex/            the one Convex project (Convex requires a single convex/ tree)
│       ├── starter/               starter-owned: platform functions and tables (api.starter.*)
│       ├── schema.ts              composes ...starterTables with the app's tables
│       └── <app files>            app-owned
├── starter/                       starter-owned; replaced on upgrade; never edited in an app
│   ├── AGENTS.md                  "using the starter from an app": seams, rules, how to request changes
│   ├── README.md  CHANGELOG.md  UPGRADING.md  VERSIONING.md  VERSION
│   ├── LICENSE  COMMERCIAL-LICENSE.md
│   ├── apps/admin/  apps/storybook/
│   ├── packages/                  auth, auth-ui, design-system, design-patterns, i18n, edge-rate-limit, ops, paper-roll
│   ├── tooling/                   dev scripts, local CI, upgrade tool, i18n conflict resolver
│   ├── config/                    base tsconfig, ESLint, Turbo and Renovate presets the root extends
│   ├── docs/                      architecture, testing, i18n, migrations, deployment, AWS
│   ├── templates/                 the root files for a new app
│   └── agent-skills/              upgrade-starter, pr-review, dependency skills (app variants)
├── .github/workflows/
│   ├── starter-*.yml              starter-owned reusable workflows (GitHub requires this folder)
│   └── ci-*.yml, cd-*.yml         thin app-owned callers
├── .claude/skills/starter-*       symlinks into starter/agent-skills (Claude requires this folder)
└── maintainer/                    starter repo only; never distributed (see "Hiding maintainer material")
```

Three places can't be moved into a top-level `starter/` folder, because tools require a fixed location: the Convex project, GitHub workflows and agent skill folders. That's why the zone rule is "a directory named `starter/` **or** a file named `starter-*`, wherever it sits", not "the top-level `starter/` folder". An agent can hold one rule, and a CI check can enforce it.

### The Convex backend

Convex has one `convex/` tree per deployment, so platform and product backend code have to live together. Two options:

- **Now: a `starter/` folder inside `convex/`.** Platform functions move to `convex/starter/*`. Their API paths become `api.starter.*`, and `schema.ts` spreads `starterTables` beside the app's tables. It's cheap, and lifeor2-client's `...lifeorTables` spread shows apps already use this pattern. The cost: renaming function paths is a breaking change for existing apps.
- **Later bet: Convex components.** The platform becomes a component installed from `convex.config.ts`, with its own versioned schema. It's the cleanest option, but the Better Auth adapter makes it a real project (brainstorm v2, topic 10).

## Root files: who they're really for

| File | Written for today | What confuses whom | Proposal |
| --- | --- | --- | --- |
| `README.md` | Buyer and maintainer: "What this starter gives you", a CI badge for a `ci-gate.yml` workflow that doesn't exist | In a buyer's repo it describes the starter, not their product. lifeor2-client had to rename it to `README.starter.md` | Move to `starter/README.md`; ship a product README template at the root |
| `AGENTS.md` | Maintainer: "active work tracker, start at step 9", "phases 1–4 done, start at phase 5", release cutting, "Maintaining this file" | App agents are handed the starter's to-do list and release duties | Split three ways: maintainer rules → `maintainer/AGENTS.md`; how to use the starter → `starter/AGENTS.md`; the app's own guide → root template |
| `CLAUDE.md` | Just `@AGENTS.md` | Nothing | Keep; app-owned |
| `TERMS-OF-SALE.md` | Your customers, as a sales contract | Meaningless inside a buyer's product repo; suggests their repo is bound by your checkout terms | Remove from the repo; it belongs on the sales site |
| `LICENSE` (evaluation licence) | Evaluators | At the root of a buyer's repo it reads as **the app's** licence: "non-production use only". That's wrong for their product | Move to `starter/LICENSE`, which keeps the notice the licence requires; the app gets its own root `LICENSE` |
| `COMMERCIAL-LICENSE.md` | Buyers | Belongs to the starter's code, not the app | `starter/COMMERCIAL-LICENSE.md` |
| `CHANGELOG.md`, `VERSIONING.md`, `UPGRADING.md` | App developers taking upgrades | At the root they look like the app's own changelog and policy, and edits to them conflict | `starter/`: they arrive unedited with each release |
| `renovate.json` | Starter's own dependency policy | Conflicted in lifeor2-client | App-owned; extends a preset in `starter/config/` |
| `turbo.json`, `tsconfig*.json`, `eslint.config.mjs`, `lighthouserc.json`, `.actrc`, `.node-version` | Both | Conflicts whenever both sides tune them | App-owned root files that extend `starter/config/` bases |
| `.eslintrc.cjs` next to `eslint.config.mjs` | Unclear | Two ESLint configs at the root | Check whether the legacy one is still used; delete if not |
| `ops.config.example.json` | The app's operator | Fine | App-owned |

## `docs/`: three piles

| Pile | Files | Where they go |
| --- | --- | --- |
| **Maintainer only** | `roadmap.md`; `claude/auth-e2e-and-upgrade-plan.md`; `claude/build-once-promote-plan.md`; `authentication-and-onboarding-plan.md`; `dependency-log.md`; `dependency-catchup.md`; `starter-upgrade-brainstorm.md`; `starter-versioning-strategy.md`; `starter-upgrades.md` (demo-fixture mechanics); `upgradeability/*` | `maintainer/docs/` |
| **Starter reference for app developers** | `claude/architecture.md`, `code-style.md`, `testing.md`, `development.md`, `ci.md`; `i18n-architecture.md`; `convex-migrations.md`; `deployment-architecture.md`, `deployment-runbook.md`; `aws/*`; `rate-limiting-architecture.md`; `audit-trail-*.md`; `authentication-and-onboarding.md`; `ops-cli.md`; `dependency-updates.md` and `dependency-migrations.md` (as method, not the starter's log) | `starter/docs/`. Also drop the `claude/` folder name: these are for any reader. |
| **Decide** | `SECURITY-REVIEW.md` | A review of the starter. Buyers may value it as assurance, but it may also list findings you don't want to distribute |
| **App-owned** | Empty at first | The app's `docs/`: PRD, product decisions (lifeor2-client put its PRD here) |

## Scripts, CI and agent skills

| Item | Owner | Why |
| --- | --- | --- |
| Dev scripts (`dev-start.sh`, `dev-stop*.sh`, `dev-status.sh`, `dev-nuke-*.sh`, `dev-processes.ts`, `ensure-*.sh`, `copy-shared-assets.sh`, `node-ts.sh`) | Starter → `starter/tooling/` | Consumed tooling. Five lifeor2 conflicts came from editing them; they need config inputs (ports) instead |
| `ci-local*.sh`, `check-env-leak.sh`, `check-runtime-baseline.ts`, `renovate-status.ts`, `staging-log.ts`, `infra-setup-staging.sh` | Starter → `starter/tooling/` | Tools both sides run |
| `starter-upgrade/` (upgrade and ownership check), `resolve-i18n-conflicts.ts`, `codemods/` | Starter → `starter/tooling/` | App developers need these to upgrade |
| `release.sh`, `release.ts`, upgrade rehearsal fixtures | Maintainer only | Cutting starter releases |
| `.github/workflows/release-starter.yml` | Maintainer only | Publishes starter tags |
| `ci-*.yml`, `cd-*.yml` | Split: logic in `starter-*.yml` reusable workflows; app keeps thin callers | lifeor2 conflicted in `ci-web.yml`, `ci-admin.yml` and `ci-shared.yml` |
| `renovate.yml`, `security.yml`, `.github/actions/*` | Starter | Consumed infrastructure |
| `upgrade-starter` command | Starter, app-facing | Only makes sense in an app |
| `pr-review`, `pr-review-respond` | Starter, generic | Useful to both |
| `deps-update`, `deps-major` skills | Needs two variants | Today they write to the starter's `docs/dependency-log.md` and track the starter's Renovate dashboard. An app needs the same method pointed at its own log |
| `infra/aws/` | Starter (templates and scripts); app owns `params/` | The app sets its own parameters |

## Hiding maintainer material from app developers

| Option | How it works | Pros | Cons |
| --- | --- | --- | --- |
| **1. Convention only** | Maintainer material in `maintainer/`, with its own `AGENTS.md`; root instructions say "not yours in an app repo" | Hours of work; no new process | Buyers still receive it; agents may still read it |
| **2. Distribution build** | The maintainer repo is private. A release step exports a distribution repo: it drops `maintainer/` and anything listed in an exclude file, and swaps the root files for `starter/templates/`. One commit per release. Buyers merge the distribution repo | Buyers never see maintainer material. One commit per release makes the merge base obvious and merges smaller. CI tests the exported tree, which is exactly what buyers get. | Two histories to keep in step. Export tooling to maintain. Buyer contributions arrive against the distribution and must be carried back. lifeor2-client re-baselines once. |
| **3. Separate maintainer repo** | Plans, drafts, roadmap and logs live in a private repo; the starter repo holds only shippable content | Simple; no export step | Tooling that needs the code (demo, release workflow, fixtures) doesn't fit well; plans link across repos |

**Recommendation:** option 1 now, option 2 as the target. Option 1 costs hours, removes the ambiguity for agents immediately, and is the exact folder that option 2 later drops. Git's `export-ignore` attribute only affects `git archive`, not clones, so it can't hide files from buyers who merge. Option 2 needs a real export commit.

### Where the maintainer's own instructions live

The trap: if the root belongs to the app, the root `AGENTS.md` says "`starter/` is not yours". That's wrong for the maintainer, who owns everything.

- **Option 1 (now):** the root `AGENTS.md` opens with one line: "If a `maintainer/` directory exists, you are in the starter's own repository: read `maintainer/AGENTS.md` first; it replaces the ownership rules below." In a buyer's repo the folder doesn't exist, so the line does nothing.
- **Option 2 (later):** the export swaps the root `AGENTS.md` for the app template, so the line disappears too.

**The zone map is fixed. Which role you have depends on which repo you're in.** The maintainer also keeps `apps/web` and `landing` as the reference app. After cloning, those same folders are the business's.

## Instructions for each role

Sketches; wording to be refined.

**Root `AGENTS.md` (app template):**

> This is **<Product>**, built on web-app-starter. You work on the product.
>
> - **Yours:** everything *except* directories named `starter/` and files named `starter-*`.
> - **Not yours:** starter-owned code arrives with starter upgrades. Don't edit it.
> - **Need to change starter behaviour?** First look for a seam in `starter/AGENTS.md` (`app.config.ts`, schema and route registration, brand, messages). If none exists, make the smallest edit, mark it `// STARTER-PATCH: <reason>` and list it in `starter-patches.md`. The next upgrade uses that list.
> - **Upgrading the starter:** `starter/UPGRADING.md`.
> - Product conventions: <the app's own rules>.

**`starter/AGENTS.md` (shipped, read-only in apps):** the seams, the architecture pointers into `starter/docs/`, the contracts that must stay green, and how to report a needed change upstream.

**`maintainer/AGENTS.md`:** everything in today's `AGENTS.md` that is about building and releasing the starter, the trackers and the roadmap. It also says to keep `starter/AGENTS.md` and `starter/templates/` in step when conventions change.

**Enforcement:** a CI check in apps lists changes to the starter zone since the base commit that aren't in `starter-patches.md`, and fails. The lifeor2 cookie-prefix edit would have been flagged and recorded instead of silently conflicting.

## Testing it: can an app agent stay out of starter work?

Take a distribution-shaped clone (option 1: delete `maintainer/`) and run a headless agent (`claude -p`, logging every file read and edit) on app tasks that each tempt it into starter territory:

| # | Task | Tempts it to |
| --- | --- | --- |
| 1 | Rename the product and change the primary colour | Edit locale files, tokens, `auth.ts` |
| 2 | Add a billing page with a nav entry | Edit the sample sidebar and shell |
| 3 | Run on port 4000 beside another local project | Edit dev scripts, Playwright and CI (the lifeor2 case) |
| 4 | Signing out logs me out of my other local app | Edit `packages/auth` and `clear-session` (the lifeor2 case) |
| 5 | Update dependencies | Use the starter's dependency log and policy |
| 6 | We need starter fix #N before the next release | Hand-port it (the lifeor2 case) |
| 7 | What should I work on next? | Read the starter's roadmap and trackers |

**Score each run:** files edited in the starter zone; maintainer material read; patches marked and recorded; i18n and brand seams used. Run it on today's layout as a baseline, then after each change. This is the first-contact experiment from brainstorm v2 (exploration I), made concrete.

## Suggested order

1. **Create `maintainer/`** and move the maintainer-only docs and release tooling into it. Split `AGENTS.md` into the three files and add the root role-detection line. Remove `TERMS-OF-SALE.md`. This is hours of work, touches no code paths, and removes most of the ambiguity for agents.
2. **Run the agent test** (tasks 1–7) as a baseline.
3. **Add config seams** for ports, cookie prefix and product name, so tasks 1, 3 and 4 can be done without touching starter code.
4. **Introduce the zone rule:** `starter/` at the top level, move packages, admin, tooling and docs, and move root files to templates. This is the big, path-changing step; do it in one release with a clear upgrade note. Re-run the agent test.
5. **Split `convex/`** into `starter/` and app parts, and move the auth routes out of `web`. This is a breaking change for existing apps; bundle it with step 4 or the next major.
6. **Distribution build** (option 2), once there are several buyers.

## Open decisions

1. **Top-level `starter/` folder, or zones only where needed?** Recommended: a top-level folder, plus the `starter/` or `starter-*` rule for the places tools pin.
2. **Hide maintainer material:** convention now and a distribution build later (recommended), or go straight to the build?
3. **Storybook:** ship it as the design system's reference, or keep it maintainer-only?
4. **`SECURITY-REVIEW.md`:** distribute it as assurance, or keep it internal?
5. **Convex path rename to `api.starter.*`:** accept the one-time breaking change now, or wait for the component bet?
6. **The app's licence:** should the app template ship a default root `LICENSE` (for example "Proprietary, all rights reserved"), or leave it for the buyer to add?
