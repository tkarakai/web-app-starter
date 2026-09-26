# Separating starter and business app: who works where (draft v4)

**Version:** v4, 2026-09-25 · working draft (updated with verification results the same day)
**Supersedes:** [repo-separation-v3.md](repo-separation-v3.md)
**Builds on:** [brainstorm v2](brainstorm-v2.md) and the [lifeor2-client case study](case-study-lifeor2-client.md)

## Summary

The starter is split two ways:

- **Two repositories.**
  - The public **product repo** (`web-app-starter`) holds only what buyers receive.
  - The private **maintainer repo** (working name `web-app-starter-maintainer`) holds everything about developing, testing and releasing the platform.
- **Two zones inside the product repo.**
  - Anything under a directory named `platform/`, or any file named `platform-*`, is the **platform**. We maintain it, and apps take it wholesale on upgrade.
  - Everything else is the **app zone**, owned by whoever builds the app.

Instructions follow the same split. **The product repo teaches how to build an app on the platform. The maintainer repo teaches how to develop the platform.**

Two things are new in v4:

- **Agent Skills.** Step-by-step procedures for building on the platform ship as [Agent Skills](https://agentskills.io) inside the platform zone. Agents load them only when a task needs them.
- **Update delivery.** Apps receive platform releases through a shipped GitHub Actions workflow. It checks for new releases daily, runs the upgrade, and opens a pull request labelled by severity. We don't publish to npm.

## What changed from v3

| Area | v3 | v4 |
| --- | --- | --- |
| Agent Skills | Mentioned in passing | First-class part of layer 2; discovery rules verified for Claude Code and Codex |
| Instruction loading | "Verify each tool" | Verified against Claude Code and Codex docs; the template and override files are designed around the actual rules |
| Maintainer skills | In the maintainer repo | Installed at user level on maintainer machines, because repo-level skills above the product repo's root don't load there |
| npm | "Reserve the org in case we publish" | **We don't publish.** Claim the `@web-app-starter` scope anyway, to block dependency confusion. `@platform` is someone else's and has an `@platform/auth` package |
| Update delivery | Not designed | The `platform-update` workflow, an advisory check in CI, and machine-readable release assets |
| CI on private repos | Unverified table | Verified against GitHub docs, plus measured CI minutes per PR. New finding: GitHub Free can't create Environments in private repos, which our deploy jobs use |
| Existing starter-upgrade machinery | "Keep, port or retire" | Out of scope; not a constraint on this plan |

## Decisions

| # | Decision | Since |
| --- | --- | --- |
| 1 | Two repos: public product repo, private maintainer repo | v2 |
| 2 | Zone rule: `platform/` directories and `platform-*` files | v2 |
| 3 | Buyer, evaluator and app developer are one audience, at two moments (before and after adoption) | v2 |
| 4 | Convex platform component, after a spike on `auditTrail` | v2 |
| 5 | Security review, roadmap, trackers and release tooling are maintainer-only | v2 |
| 6 | Storybook ships as the design system's reference, platform-owned | v2 |
| 7 | App template ships a proprietary root `LICENSE` that carves out `platform/` | v2 |
| 8 | Product repo instructions cover only *using* the platform | v3 |
| 9 | Maintainers build the reference apps using only the product repo's guidance and skills | v3 |
| 10 | The product repo's CI is the CI buyers adopt | v3 |
| 11 | Product repo is public; licence enforced legally | v3 |
| 12 | Buyer contributions: out of scope for now | v3 |
| 13 | First release in the new shape: **v2.0.0** | v3 |
| 14 | Package scope `@web-app-starter/*` | v3 |
| 15 | No porting of reference-app changes; release notes cover the platform only | v3 |
| 16 | Keep staging and migrate its data; production isn't set up | v3 |
| 17 | v2 risks accepted | v3 |
| 18 | **Agent Skills are the delivery vehicle for platform procedures** | v4 |
| 19 | **No npm publishing.** The `@web-app-starter` npm organisation is claimed (done 2026-09-25) only as a defence | v4 |
| 20 | **Updates reach apps through a shipped `platform-update` workflow**, plus an advisory check in regular CI | v4 |
| 21 | **Existing starter-upgrade machinery is out of scope** | v4 |
| 22 | **Architecture docs are split between the two layers file by file** during the migration | v4 |

## Glossary

| Term | Meaning |
| --- | --- |
| **Starter** | The product we sell: the public `web-app-starter` repo, as released |
| **Platform** | What we keep maintaining after an app adopts the starter: `platform/` directories and `platform-*` files |
| **App zone** | Everything outside the platform zone; owned by the app |
| **Reference apps** | The starter's own app zone: `apps/web`, `apps/demo`, `apps/landing`, `apps/landing-static` and the sample domain |
| **Seam** | A file where the app plugs into the platform: `app.config.ts`, root `package.json`, Convex `schema.ts`, `convex.config.ts`, `http.ts` |
| **Skill** | An [Agent Skills](https://agentskills.io) folder: `SKILL.md` (name, description, instructions) plus optional scripts and references. Loaded by the agent when a task matches |
| **Maintainer** | Whoever develops and releases the platform |
| **App developer** | Whoever evaluates, adopts and builds on the starter |
| **Adopt** | The one-time step that turns a clone into an app |
| **Upgrade** | Taking a newer platform release into an adopted app |

## The instruction model

### The principle

| Question an agent is answering | Where the answer lives |
| --- | --- |
| "How do I build this product?" | Root `AGENTS.md`: app-owned; we supply a starting template |
| "What does the platform require, at the version installed here?" | `platform/AGENTS.md` and `platform/docs/`: platform-owned, replaced on upgrade |
| "How do I do this specific platform task, step by step?" | A **platform skill** in `platform/agent-skills/`: loaded only when the task matches |
| "How do I upgrade the platform?" | The `platform-upgrade` skill and `platform/UPGRADING.md` |
| "How do I change, test or release the platform itself?" | The maintainer repo only |

### The three layers

| Layer | Files | Owner | Content | Changes when |
| --- | --- | --- | --- | --- |
| **1. App guide** | Root `AGENTS.md`, `CLAUDE.md` | App (we ship the first version as a template) | What the product is; the app's own conventions; a "read first" pointer to layer 2 | Whenever the app wants. Upgrades never touch it |
| **2. Platform usage** | `platform/AGENTS.md`, `platform/docs/`, `platform/agent-skills/` | Platform zone, read-only in apps | Rules the platform dictates, seams, best practices, contracts, and procedures as skills | Every release; taken wholesale on upgrade, so it always matches the installed code |
| **3. Platform development** | Maintainer repo: `AGENTS.md`, `docs/`, `skills/` | Maintainer repo | Internals, testing the platform, release process, roadmap, trackers, logs, lab. Also: "layers 1 and 2 are deliverables" | Whenever we want; never shipped |

**Why platform rules can't live in the root template.** The root file is app-owned after adoption and stops receiving updates. The platform's rules change with each release, so they live in layer 2, which is replaced on every upgrade.

**Which layer does a document belong to?** Ask: "Would an app developer need this without ever editing `platform/`?" Yes → layer 2. No → layer 3. Architecture documents are split file by file on this test (decision 22).

### Who reads what

| Who, doing what | Reads |
| --- | --- |
| App developer's agent building the product | Layers 1 and 2; platform skills on demand |
| Maintainer building a reference app | Layers 1 and 2, exactly like a buyer. That's dogfooding: if the agent struggles, layer 2 has a gap |
| Maintainer changing the platform | Layer 3 first, then layer 2 as the deliverable to keep accurate |

### Platform skills

Skills keep `platform/AGENTS.md` short. At startup an agent loads only each skill's name and description, and the full instructions only when a task matches. Skills live in the platform zone, so every upgrade replaces them with the version matching the installed platform.

**Initial catalogue (proposal):**

| Skill | Does |
| --- | --- |
| `platform-add-table` | Add app tables next to the platform component; schema seam; indexes; tests |
| `platform-add-page` | Add a page and nav entry in an app that owns its shell; auth guard; i18n |
| `platform-add-strings` | Add messages in the app's namespace; locales the app ships |
| `platform-configure` | Set name, ports, cookie prefix, origins and brand in `app.config.ts` |
| `platform-feature-<name>` | Wire an optional platform feature into the app's UI (brainstorm topic 14); one skill per feature |
| `platform-upgrade` | Run `platform:upgrade`, read the plan, resolve seams, run checks |
| `platform-patch` | The escape hatch: make, mark and record a platform patch, and write the upstream request |
| `platform-deps` | Update the app's dependencies without touching `platform/**` |
| `platform-pr-review`, `platform-pr-respond` | Generic review workflows (today's `.claude/commands/pr-review*.md`) |

**Where tools discover skills** (verified from the [Claude Code](https://code.claude.com/docs/en/skills) and [Codex](https://learn.chatgpt.com/docs/build-skills) docs):

| Tool | Project skill folder | Scan range | Symlinks |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/<name>/SKILL.md` | Launch directory and parents up to the repo root; nested folders when Claude works in them | Supported |
| Codex | `.agents/skills/<name>/SKILL.md` | Launch directory up to the repo root | Supported |

Skills are stored once, in `platform/agent-skills/<name>/`. The adopt step creates links named `platform-<name>` in both `.claude/skills/` and `.agents/skills/`. The links follow the `platform-*` rule, so they're platform zone too. The product repo already uses this pattern (`.agents/skills` with links from `.claude/skills`).

**Skills are testable.** The lab (maintainer repo) runs each skill's task on a fresh adopted app, then checks that the agent used the skill, stayed out of `platform/`, and left the build and contracts green.

### How instructions load (verified)

From the [Claude Code memory docs](https://code.claude.com/docs/en/memory) and the [Codex AGENTS.md docs](https://learn.chatgpt.com/docs/agent-configuration/agents-md):

| Behaviour | Claude Code | Codex |
| --- | --- | --- |
| Files read | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`. Reads `AGENTS.md` only when no `CLAUDE.md` or `CLAUDE.local.md` exists at or above the launch directory | `AGENTS.override.md`, else `AGENTS.md` (one file per directory) |
| Directories | Launch directory and all parents at launch; subdirectories when it reads files there | Repo root down to the launch directory. **Nothing below the launch directory** |
| Imports | `@path` imports, up to four levels deep. Imports outside the project need a one-time approval | No import syntax documented |
| Local, uncommitted file | `CLAUDE.local.md`, loaded after `CLAUDE.md`. It exists only in the worktree where it was created | `AGENTS.override.md` **replaces** `AGENTS.md` in that directory |
| Size | Guidance: under 200 lines per file | 32 KiB combined by default |

**What this means for the design:**

1. **Template root `CLAUDE.md`:** `@AGENTS.md` and `@platform/AGENTS.md`. Claude Code loads both at launch.
2. **Template root `AGENTS.md`** opens with: "Before any task, read `platform/AGENTS.md`." Codex never loads `platform/AGENTS.md` by itself (it sits below the launch directory), so the instruction does it.
3. **Keep layers 1 and 2 small.** Combined they must stay well under Codex's 32 KiB. Detail goes into `platform/docs/` and skills.

### Maintainer instructions and skills

The maintainer works in the product repo but takes instructions from the maintainer repo:

```text
~/dev/web-app-starter-maintainer/          ← start here for platform work
├── AGENTS.md  CLAUDE.md                    layer 3
├── setup/                                  run once per machine and once per worktree
└── product/                                clone of web-app-starter (gitignored)
    ├── CLAUDE.local.md                     written by setup/, gitignored (Claude Code)
    ├── AGENTS.override.md                  written by setup/, gitignored (Codex)
    ├── AGENTS.md  CLAUDE.md                layer 1
    └── platform/AGENTS.md                  layer 2
```

- **Started at the maintainer repo root:** layer 3 loads first. Layers 1 and 2 load as the agent works in `product/`.
- **Started inside a product worktree** (worktrees, the no-mistakes pipeline, review commands): the local override loads.
  - `CLAUDE.local.md` says "you are a platform maintainer" and imports the maintainer `AGENTS.md`. The import is outside the project, so Claude Code asks for approval once.
  - `AGENTS.override.md` replaces `AGENTS.md` for Codex, so it carries the maintainer pointer **and** "then read `AGENTS.md` in this directory".
  - `CLAUDE.local.md` exists only in the worktree where it was created, so the setup script writes both files into each new worktree.
- **A worktree without the override files** is a clean buyer's view, useful for testing layers 1 and 2.
- **Maintainer skills** (release, lab, platform dependency updates) can't be repo-level. Both tools stop scanning at the product repo's root, so skills in the maintainer repo above it never load. Setup instead links them at user level (`~/.claude/skills/`, `~/.agents/skills/`) on the maintainer's machine, with distinct names (`starter-release`, `starter-lab`, `starter-deps`).

The product repo's `.gitignore` lists `CLAUDE.local.md` and `AGENTS.override.md`. Those are generic names that buyers can use for personal notes too.

## Gaps found in the model

1. **The root template can't stay current.** Fixed by layer 2.
2. **Maintainer tools started inside the product repo miss maintainer instructions.** Fixed by per-worktree override files and user-level maintainer skills.
3. **The app's Renovate would edit the platform.** Fixed with:
   - a Renovate preset that ignores `platform/**`;
   - platform packages that declare version ranges, not pins;
   - lockfile maintenance for patch-level fixes.
4. **Platform tests would run in every app's CI.** The platform suite runs only when `platform/**` changes; contracts run on every PR.
5. **Some checks only make sense for us.** Adopt-and-strip builds, upgrade rehearsals and first-contact tests run in the maintainer lab.
6. **The demo app is a reference app.** It stays in the product repo; the lab uses tagged copies.
7. **Reference apps could teach bad habits.** They never carry `PLATFORM-PATCH` edits.
8. **Some docs mix audiences.** They're split file by file using the layer test.

## The two repositories

| | Product repo `web-app-starter` | Maintainer repo `web-app-starter-maintainer` |
| --- | --- | --- |
| Visibility | Public; licence enforced legally | Private |
| Audience | App developers; maintainers while writing code | Maintainers only |
| Contains | Platform zone, reference apps, root templates, layer 2 and skills, `platform/CHANGELOG.md`, adopt, upgrade and update tooling, the CI buyers adopt | Layer 3, maintainer skills, roadmap, trackers, dependency log, security review, upgradeability drafts, release tooling and workflows, lab, workspace setup, sales and licence texts |
| Keeps | Issues, PRs, CI, Vercel and Convex staging, Renovate, lifeor2-client's merge base | — |

### Product repo layout

```text
/                                   seams and templates; after adoption, the app's
├── README.md                       short and stable; "run bun run adopt"
├── LICENSE                         evaluation licence until adoption; then proprietary, carving out platform/
├── AGENTS.md  CLAUDE.md            layer 1 template
├── .platform-base.json             after adoption: installed version, base commit, recorded patches
├── app.config.ts                   name, ports, cookie prefix, origins, brand, switches
├── package.json  turbo.json  tsconfig.json  eslint.config.mjs  renovate.json
├── apps/
│   ├── web/  demo/                 reference apps
│   └── landing/  landing-static/   reference marketing sites; removable at adoption
├── packages/backend/convex/
│   ├── convex.config.ts  schema.ts  http.ts     seams
│   ├── platform/                   platform-owned wrappers
│   └── <app functions>
├── platform/                       platform zone
│   ├── AGENTS.md                   layer 2
│   ├── README.md  CHANGELOG.md  UPGRADING.md  VERSIONING.md  VERSION  LICENSE  COMMERCIAL-LICENSE.md
│   ├── apps/admin/  apps/storybook/
│   ├── packages/                   @web-app-starter/*: auth, auth-ui, convex-platform, design-system,
│   │                               design-patterns, i18n, edge-rate-limit, ops, paper-roll
│   ├── agent-skills/               platform skills (SKILL.md folders)
│   ├── tooling/                    dev scripts, setup-e2e, local CI, adopt, upgrade, update check, zone check, codemods
│   ├── config/                     tsconfig, ESLint, Turbo bases; Renovate preset (ignores platform/**)
│   ├── docs/                       layer 2 reference
│   └── templates/                  layer 1 templates
├── infra/aws/                      platform scripts and templates; app-owned params/
├── .github/
│   ├── actions/                    platform-owned composite actions
│   └── workflows/
│       ├── platform-*.yml          reusable workflows, including platform-update.yml
│       ├── ci-*.yml  cd-*.yml      thin app callers
│       └── update-platform.yml     app-owned caller: the schedule
├── .claude/skills/platform-*       links to platform/agent-skills (Claude Code)
└── .agents/skills/platform-*       links to platform/agent-skills (Codex)
```

### Maintainer repo layout

```text
web-app-starter-maintainer/
├── AGENTS.md  CLAUDE.md           layer 3
├── product/                        clone of web-app-starter (gitignored)
├── setup/                          per-machine and per-worktree setup (overrides, user-level skills)
├── skills/                         starter-release, starter-lab, starter-deps
├── docs/
│   ├── platform-internals/         the internals halves of architecture docs
│   ├── roadmap.md  trackers/  dependency-log.md  dependency-catchup.md
│   ├── security-review.md
│   ├── upgradeability/             these drafts, case studies, evidence log
│   └── decisions/
├── release/                        release.ts, notes/
├── lab/                            fixtures.json, real-apps.json, rehearse.ts, skill tests
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
| Architecture docs | Split: behaviour → `platform/docs/`; internals → `docs/platform-internals/` | Both |
| Usage docs (code style, testing, development, CI, migrations, deployment, AWS, ops, dependency method) | `platform/docs/` | Product |
| `.claude/commands/*.md`, `.agents/skills/deps-*` | App-facing versions → `platform/agent-skills/`; maintainer versions → `skills/` | Both |
| `apps/admin`, `apps/storybook` | `platform/apps/` | Product |
| `apps/demo`, `apps/web`, `apps/landing*` | Stay in `apps/` (reference apps) | Product |
| `packages/*` except `backend` | `platform/packages/`, renamed `@web-app-starter/*` | Product |
| `packages/backend` platform functions | Component plus `convex/platform/` wrappers | Product |
| Dev and CI scripts | `platform/tooling/` | Product |
| `scripts/release.*`, `release-starter.yml` | `release/`, `.github/workflows/release.yml` | Maintainer |

## The zone rule and upgrades

**Rule:** `platform/` directories and `platform-*` files are platform-owned and never edited by hand in an adopted app.

| File class | On upgrade |
| --- | --- |
| Platform zone | Taken wholesale from the release |
| Seams | Three-way merge; the zone check confirms required hooks remain |
| App zone | Left alone |

**Escape hatch:** mark an edit `// PLATFORM-PATCH: <reason>` and record it in `.platform-base.json` (the `platform-patch` skill does both). The zone check fails CI on unrecorded platform-zone edits.

**`bun run platform:upgrade --to vX.Y.Z`**, in outline. It needs its own design document later.

1. Run the **target release's** tool.
2. Plan (read-only): advisories, breaking-change manifest, env, migrations, seam conflicts, recorded patches, removed env still read by app code.
3. Apply: platform zone from the release, app zone untouched, seams merged three-way, codemods.
4. Verify: zone check, contracts, platform suite, app tests, env, migration status.
5. Record: update `.platform-base.json`.

The same tool runs locally, through the `platform-upgrade` skill, and inside the update workflow below. Topics for its own design: skipping versions, seam hooks, conflicts in seams, agent stop conditions, dry runs, rollback, migration ordering.

## Update delivery

### The problem

Today a buyer learns about a release only by watching the repo, and a security fix reaches them only if they notice it. Delivery has four jobs:

1. Learn that a release exists.
2. Learn whether it's urgent.
3. Apply it.
4. Prove it works.

### Why not npm

Publishing platform packages to npm would give automatic Renovate or Dependabot PRs, and Dependabot security alerts in every buyer repo. But it would split the platform into two delivery channels: npm for packages, git for the admin app, tooling, CI, wrappers, docs and skills. The two could drift out of step, and it adds a publishing pipeline. The workflow below does all four jobs through git, for the whole platform.

**The npm scope is claimed anyway (decision 19).**

- The npm organisation `web-app-starter` now exists, so only its members can publish packages named `@web-app-starter/<name>`. We use the scope for workspace package names and publish nothing. (A free npm organisation can publish only public packages, which is fine because we don't publish.)
- `@repo`, the scope we use now, is **owned by someone else**, and so is `@platform`, which already has an `@platform/auth` package.
- Our `workspace:*` dependencies never resolve from the registry, so the current risk is low. But a scope we own removes the dependency-confusion risk entirely. That's also a second reason for the `@web-app-starter/*` rename.

### Research: what GitHub Actions allows

| Question | Answer | Source |
| --- | --- | --- |
| Can a scheduled workflow run in a private repo? | Yes, on every plan. It uses the plan's included minutes | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Included minutes, private repos | Free 2,000/month; Pro 3,000; Team 3,000; Enterprise Cloud 50,000. Linux 2-core overage costs $0.006/min. Public repos are free | Same |
| Shortest schedule | Every 5 minutes. Runs on the default branch only. Can be delayed at busy times, especially the top of each hour | [Events: schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) |
| Auto-disabled when inactive? | Only public repos, after 60 days without activity. Private repos keep running | Same |
| Can a workflow open a PR with `GITHUB_TOKEN`? | Yes, if the repo setting "Allow GitHub Actions to create and approve pull requests" is on. It's off by default for personal repos | [Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository) |
| Does CI run on that PR? | **Not automatically.** PRs created with `GITHUB_TOKEN` start workflow runs "in an approval-required state". GitHub recommends a GitHub App installation token or a personal access token instead | [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token) |
| Can `GITHUB_TOKEN` push changes to `.github/workflows/`? | **No, confirmed by experiment.** A push was rejected with "refusing to allow a GitHub App to create or update workflow `.github/workflows/probe.yml` without `workflows` permission". There is no `workflows` permission for `GITHUB_TOKEN`. Updating workflow files needs a GitHub App with Workflows write permission, or a PAT with the `workflow` scope. Our releases change `platform-*.yml`, so this matters | [Workflow syntax: permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) |

**Conclusion:** a daily scheduled workflow is allowed and cheap on every plan. To open a PR that CI actually tests, and that can include workflow changes, it needs a **GitHub App token**.

### The workflow

**Files we ship:**

| File | Zone | Role |
| --- | --- | --- |
| `.github/workflows/platform-update.yml` | Platform | Reusable workflow: check, upgrade, open the PR or issue |
| `.github/workflows/update-platform.yml` | App (from the template) | The caller: schedule, manual trigger, policy inputs. App-owned, so the app chooses its schedule |
| `platform/tooling/update-check.ts` | Platform | Compares installed and released versions; reads advisories |
| `platform/agent-skills/platform-upgrade/` | Platform | For finishing an update PR that needs judgment |

**Caller (app-owned):**

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

1. **`check`** (about 1 minute, read-only token):
   - Read the installed version from `.platform-base.json`.
   - List releases of `tkarakai/web-app-starter`. It's public, so no special token is needed.
   - Choose the target: the newest release allowed by `policy`. A new **major** version always becomes an issue, not a PR, because it needs a person.
   - Download the release's `advisories.json`. If the installed version is affected, record the severity.
   - Stop if an open PR for this target already exists (branch `platform-update/vX.Y.Z`).
2. **`upgrade`** (only when there's a target; a few minutes):
   - Mint a GitHub App token (`actions/create-github-app-token`). Check out with it.
   - `bun install`. Fetch the target tag from the public repo.
   - Run **the target release's** `platform:upgrade --to vX.Y.Z --non-interactive --report`.
   - Regenerate the lockfile. Commit to `platform-update/vX.Y.Z` and push.
   - Open the PR with `gh pr create`, using the report as the body:
     - Title: `Platform v2.1.0 → v2.1.3 (security: high)`
     - Labels: `platform-update`, `severity:<level>`, plus `breaking`, `migration` and `new-env` when they apply
3. **Outcome handling:**

   | Upgrade result | What the workflow does |
   | --- | --- |
   | Clean | Ready-for-review PR. With `auto-merge: true`, a clean patch with no migration or new env is set to merge when CI passes |
   | Needs judgment (seam conflicts, recorded patches to review, migrations) | **Draft** PR with a checklist from the report. A human, or an agent using the `platform-upgrade` skill, finishes it |
   | Tool failure | An issue with the log and the manual command |
   | New major available | An issue linking the release notes and breaking changes |

4. **CI runs on the PR** as on any other, because it was opened with an App token. The platform suite runs because `platform/**` changed.

**Advisory check in regular CI** (`platform-advisory-check`, part of the platform's contract job). On every CI run, it reads the installed version and the latest `advisories.json`:

- A known vulnerability at `high` or above fails the check.
- Lower severities warn.

This reaches the buyer even if the update workflow is switched off or broken.

**What each release must publish** (maintainer repo's `release.yml`), as GitHub release assets:

- `advisories.json`: advisory ID, severity, affected version range, fixed version, summary.
- `breaking-changes.json`: the manifest `platform:upgrade` reads.
- The release notes, as today.

### Buyer setup

One time, guided by the `platform-configure` skill or `bun run platform:setup-updates`:

1. **Create a GitHub App** in the buyer's own account or organisation, with permissions Contents (write), Pull requests (write), Workflows (write) and Issues (write), installed on the app's repo only. The helper uses GitHub's [app-manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest), which presets permissions through `default_permissions`:
   - It starts a short-lived local web server and opens `https://github.com/settings/apps/new` (or the organisation's equivalent) with the manifest.
   - The buyer reviews it and clicks create.
   - GitHub redirects to the local server with a code. The helper exchanges it through `POST /app-manifests/{code}/conversions` for the App ID and private key. All steps must finish within one hour.
   - The helper then asks the buyer to install the App on the repo, and stores the ID and key with `gh`.
2. Store the App's ID as a repository variable and its private key as a secret.
3. Keep or edit the schedule and policy in `update-platform.yml`.

**Without an App** (fallback): the workflow uses `GITHUB_TOKEN` and the "Allow GitHub Actions to create pull requests" setting. The PR opens, but CI needs a manual "Approve and run". A release that changes `platform-*.yml` can't be pushed, so the workflow opens an issue with the manual command instead.

### Cost and frequency

| Item | Billed minutes | Per month |
| --- | --- | --- |
| Daily check on weekdays | About 1 per run | About 22, roughly 1% of the Free plan's 2,000 |
| The upgrade job | A few, only when a release exists | Depends on release cadence |
| CI on the update PR | Same as the app's normal CI | See below |

We measured the starter's own CI on a recent PR that touched everything: **8 workflows, about 62 billed minutes** (CI Web 25, CI Admin 7, CI Shared 7, CI Landing 6, CI Landing Static 6, CI Storybook 5, Security 5, and 1 for the release check). Path filters make typical PRs cheaper. On GitHub Free, that's about 30 full-CI PRs a month before overage. Apps that drop the landing sites run fewer workflows.

**Daily on weekdays is the recommendation.**

- Hourly would cost about 720 minutes a month for no benefit, because releases aren't hourly.
- Weekly is too slow for security fixes.
- The advisory check in every CI run covers the gap between checks.

### Alternative considered: Renovate

A Renovate custom regex manager could track the version in `.platform-base.json` against our GitHub releases, and `postUpgradeTasks` could run `platform:upgrade`. It's not the primary route, for three reasons:

- `postUpgradeTasks` works only on **self-hosted** Renovate with an `allowedCommands` list, not on the hosted Mend app.
- The upgrade would run inside Renovate's environment, which is harder to debug.
- Our workflow already opens the PR.

It could be added later just to show platform updates in the Dependency Dashboard.

## CI: the buyer's CI is ours

The product repo's CI is the CI buyers adopt, and that's a selling point. Its logic lives in `platform-*.yml` reusable workflows and `.github/actions/`; the app keeps thin callers.

### What differs in a private repo (verified)

| Feature we use | Public repo | Private repo | Handling |
| --- | --- | --- | --- |
| Actions minutes | Free | 2,000 (Free) / 3,000 (Pro, Team) / 50,000 (Enterprise Cloud) per month; about 62 per full PR measured | Path filters; E2E shard count as a setting; document the budget |
| Artifact storage | Free | 500 MB / 1 GB / 2 GB / 50 GB | Short retention |
| CodeQL code scanning | Free | Needs a GitHub Code Security licence | Skip with a notice unless enabled |
| `dependency-review-action` | Free | Needs GitHub Code Security or Advanced Security | Same |
| **GitHub Environments** (12 deploy jobs in `cd-*.yml` use `staging` or `production`) | Free | GitHub Free can't configure environments in private repos; Pro and Team can. On Free, a private repo's environment protection rules and environment secrets are **ignored** (GitHub docs). A job that names a missing environment **runs and auto-creates it** (confirmed by experiment on Pro) | Deploy jobs rely only on repository-level secrets (true today), so they work on Free. Approval gates are a paid-plan bonus, not a dependency |
| Environment secrets | Free | Pro, Team or Enterprise | Our deploy secrets are repository-level already |
| Required reviewers, wait timers, custom protection rules | Free | Not available on Free, Pro or Team; Enterprise only | Production approval is plan-dependent; document it |
| Deployment branch restrictions | Free | Pro and Team | Document |
| Protected branches | Free | Pro and Team | Needed for auto-merge with required checks; document |
| Artifact attestations (`actions/attest`, 6 uses) | Free | **Not available for user-owned private repos, on any plan.** Confirmed by experiment on Pro: "Feature not available for user-owned private repositories". Organisation-owned private repos need Enterprise Cloud (GitHub's plan documentation) | The attest steps are skipped with a notice unless the repo is public or a variable enables them. A failed attest must never fail a deploy |
| TruffleHog secret scan | Works | Works | — |

**Rule:** every workflow runs on GitHub Free for a private repo. Paid features skip with a visible notice, and repository variables turn them on (documented in `platform/docs/ci.md`).

### What runs where

| Check | Product repo PRs | App PRs | Maintainer lab (per release candidate) |
| --- | --- | --- | --- |
| Build, lint, types, app tests | Yes | Yes | — |
| Platform contracts and advisory check | Yes | Yes | — |
| Platform unit suite | When `platform/**` changes | When `platform/**` changes (update PRs) | — |
| Zone check | Yes | Yes | — |
| Adopt and strip, build | — | — | Yes |
| Upgrade rehearsals | — | — | Yes |
| First-contact and skill tests | — | — | Yes |

## Adopting the starter

`bun run adopt`, once, after cloning:

1. Set name, ports, cookie prefix and origins in `app.config.ts`.
2. Replace the root `README.md`, `LICENSE`, `AGENTS.md` and `CLAUDE.md` with templates.
3. Optionally remove the sample domain, `demo`, `landing` and `landing-static`.
4. Link platform skills into `.claude/skills/` and `.agents/skills/`.
5. Write `.platform-base.json` and add the `upstream` remote.
6. Offer update setup (the GitHub App).
7. Run the zone check and a build; print what's the app's and what's the platform's.

## The Convex platform component

Unchanged from v3:

- **Component** (`platform/packages/convex-platform`): the platform's tables and logic.
- **Platform-owned wrappers** (`convex/platform/`): Better Auth, identity checks, public API (56 references), HTTP routes, crons.
- **App-owned:** everything else.

Constraints:

- No `ctx.auth` in a component.
- Component functions aren't client-callable.
- Environment variables must be declared (16).
- No `.paginate()` (3 files to rework).
- IDs become strings across the boundary.

Spike on `auditTrail` with exit criteria, then either migrate the rest, or fall back to `convex/platform/` without a component. Data migration runs on staging and on lifeor2-client.

## Cutting a release

| Step | Where | What happens |
| --- | --- | --- |
| 1. Develop | Product repo | PRs to `main` from the maintainer workspace |
| 2. Prepare | Maintainer repo, `release.ts prepare` | Changelog with advisories; `advisories.json` and `breaking-changes.json`; bump `platform/VERSION`; release PR on the product repo |
| 3. Rehearse | Maintainer repo, `lab.yml` | Upgrade lab fixtures and lifeor2-client to the candidate, **through the same `platform-update` workflow buyers use**. Run skill and first-contact tests. Red blocks the release |
| 4. Publish | Maintainer repo, `release.yml` | Tag `vX.Y.Z` on the product repo; GitHub release with notes and both JSON assets |
| 5. Announce | GitHub release and Security Advisory | Buyers' update workflows pick it up on their next run; the advisory check flags affected versions in every CI run |
| 6. Record | Maintainer repo | Release, evidence and dependency logs |

## Migration plan

1. **Maintainer repo and workspace:** move maintainer-only material; write layer 3; add the setup script (per-worktree overrides, user-level maintainer skills).
2. **Layers 1 and 2 and the first skills:** split `AGENTS.md` and docs with the layer test; write the root templates; convert today's commands and dependency skills; add `platform-configure`, `platform-add-table` and `platform-add-page`.
3. **Configuration seam** (`app.config.ts`) and lifeor2-client's upstream improvements.
4. **Convex spike** on `auditTrail`, then decide.
5. **The big move:** `platform/` zone, `@web-app-starter/*` rename with a codemod, adopt, zone check, auth routes out of `web`, reusable workflows with plan-conditional jobs (including optional Environments), the Renovate preset.
6. **Rest of the component migration**, if the spike passed; staging data migration.
7. **Update delivery:** `platform-update.yml`, the caller template, `update-check.ts`, the advisory check, release assets, and the App setup helper.
8. **Publish v2.0.0.** Mark v1.0.0 as prepared but never published.
9. **Re-baseline lifeor2-client** on v2.0.0; it becomes the lab's first real-app rehearsal, run through the update workflow.
10. **Later:** the detailed `platform:upgrade` design, and the first-contact test harness. A "before" baseline can be taken any time from the pre-migration commit.

## Verification results

All open items are resolved. Experiments ran on the private repo `tkarakai/web-app-starter-store` (owner on GitHub Pro) on 2026-09-25, on a temporary branch. The runs, branch and environments were deleted afterwards, and Actions were switched off again.

| # | Question | Result | How we know |
| --- | --- | --- | --- |
| 1 | What happens to a job that names a GitHub Environment in a private repo? | It runs, and a missing environment is auto-created. On GitHub Free, environments can't be configured in private repos, and their protection rules and secrets are ignored. On Pro and Team, environments work, but **required reviewers and wait timers are refused** ("ensure the billing plan supports the required reviewers protection rule") | Experiment (Pro), plus the GitHub docs source (`manage-environments.md`) |
| 2 | Artifact attestations on private repos | Not available for user-owned private repos. Organisation-owned private repos need Enterprise Cloud | Experiment (Pro): "Feature not available for user-owned private repositories"; GitHub plan docs |
| 3 | Can the App's permissions be preset for buyers? | Yes. The manifest's `default_permissions` presets them; the buyer confirms in the browser; the code is exchanged for the ID and key within one hour | [GitHub docs](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) |
| — | Can `GITHUB_TOKEN` push workflow-file changes? | No; rejected without the `workflows` permission | Experiment |
| 4 | Codex import syntax | Not needed; the design tells Codex to read `platform/AGENTS.md` explicitly | — |

**A side finding:** the store repo's owner settings require every action to be pinned to a full commit SHA. Unpinned actions were refused. Our workflows already pin SHAs; keep that as a rule, because buyers may have the same policy.
