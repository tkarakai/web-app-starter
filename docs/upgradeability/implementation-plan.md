# Repo separation: implementation plan

**Status:** plan, 2026-09-25
**Implements:** [repo-separation.md](repo-separation.md). Section references (§) point there.
**Target:** release **v2.0.0**, the first published release, in the final shape.

## How to read this plan

- **Phases** are milestones. **Tasks** are single pull requests unless noted otherwise.
- Each task lists its **repo** (P = product repo `web-app-starter`, M = maintainer repo `web-app-starter-maintainer`), its **size** (S under a day, M a few days, L a week or more), its **dependencies**, and **done when**: the acceptance check that closes it.
- Product-repo tasks go through the normal PR flow and `bun run ci`. Tasks marked **breaking** land on a `v2` integration branch, not `main` (see "Branching" below).
- Each phase ends with a **checkpoint**: what must be true before the next phase starts.

## Overview

```text
Phase 0  Preparation ─────────────┐
Phase 1  Maintainer repo ─────────┼──► Phase 2  Instruction layers and first skills
Phase 3  Configuration seam ──────┘              │
Phase 4  Convex spike (decision gate) ───────────┤
                                                 ▼
Phase 5  The big move (v2 branch, breaking) ──► Phase 6  Component migration
                                                 │
Phase 7  Upgrade tool and update delivery ◄──────┘
Phase 8  Lab
Phase 9  Release v2.0.0 ──► Phase 10  Re-baseline lifeor2-client
```

Phases 0, 1, 3 and 4 can run in parallel. Phase 2 needs Phase 1 (layer 3 must exist before content moves out of `AGENTS.md`). Phase 5 needs 2, 3 and the Phase 4 decision.

## Branching

- Phases 0–4 are additive and non-breaking: they land on `main` as normal PRs.
- Phases 5–7 rename paths and packages. They land on a long-lived **`v2` integration branch**:
  - `main` stays releasable while the move happens.
  - Each task is still its own PR, targeting `v2`.
  - `main` is merged into `v2` regularly with ordinary merge commits. Never rebase or force-push.
- `v2` merges into `main` once, at the start of Phase 9.

## Phase 0: Preparation

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 0.1 | **Settle open PRs.** Merge #150 (endpoint authorization contract), which becomes the first contract (§10). Close or park #149 (dependency comparison in the old starter-upgrade machinery, out of scope per decision 24). Review #148 (app-owned branding icons) against the configuration seam; merge if it fits, otherwise fold it into 3.1 | P | S | — | No open PR conflicts with Phase 5 paths |
| 0.2 | **Upstream lifeor2-client's improvements.** Cookie-prefix option in `@repo/auth`, threaded through `server.ts`, backend `auth.ts` and `sessions.ts`, `edge-rate-limit`, both `proxy.ts` and both `clear-session` routes. Exact cookie matching in `hasSessionCookie`. `developmentOnly` guards on mock email and dev seed. Tests for each | P | M | — | Tests pass; a fresh trial merge into lifeor2-client shows those files no longer conflict |
| 0.3 | **Merge this branch** (`tkarakai/upgradeability`: the design, plan, brainstorms and case study) into `main`, so the plan is visible to all worktrees. The docs move to the maintainer repo in 1.2 | P | S | — | On `main` |

**Checkpoint 0:** open PRs resolved; lifeor2-client's improvements are platform code.

## Phase 1: Maintainer repo and workspace

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 1.1 | **Create the private repo** `web-app-starter-maintainer` with the §5 layout skeleton, a README, and `.gitignore` for `product/` | M | S | — | Repo exists; cloning it and cloning the product repo into `product/` works |
| 1.2 | **Move maintainer-only material.** `docs/roadmap.md`, the `*-plan.md` trackers, `dependency-log.md`, `dependency-catchup.md`, `SECURITY-REVIEW.md`, `docs/starter-upgrade-brainstorm.md`, `starter-versioning-strategy.md`, `starter-upgrades.md`, `docs/upgradeability/*` and `TERMS-OF-SALE.md` (to `sales/`). Remove them from the product repo in one PR. Fix every reference: the `AGENTS.md` topic-guide table, READMEs, skills and scripts | M + P | M | 1.1 | `grep` finds no product-repo links to moved files; `bun run ci:quick` passes |
| 1.3 | **Security review follow-up.** Check `SECURITY-REVIEW.md` for unresolved findings. It stays in public history, so any open finding is fixed rather than hidden (decision 18) | P | S–M | 1.2 | Every finding is either resolved or recorded as accepted in the maintainer repo |
| 1.4 | **Write layer 3** (`AGENTS.md`, `CLAUDE.md`) from today's maintainer content: trackers, release, "Maintaining this file", internals, the conflict-resolution wording from §7 | M | S | 1.2 | A maintainer agent started at the maintainer root can describe the release process and the zone rule's exemption for maintainers |
| 1.5 | **Setup script** (`setup/`). Per machine: link maintainer skills at user level. Per worktree: write `CLAUDE.local.md` and `AGENTS.override.md` into a product worktree. Add both names to the product repo's `.gitignore` | M + P | M | 1.4 | In a product worktree with overrides, Claude Code and Codex both report maintainer instructions; without them, only product guidance |
| 1.6 | **Maintainer skills.** Maintainer variants of `deps-update` and `deps-major` (writing to the maintainer repo's dependency log) become `starter-deps`; add `starter-release` and `starter-lab` stubs | M | S | 1.5 | The skills load at user level in both tools |
| 1.7 | **Release tooling move.** Move `scripts/release.*` and `release-starter.yml` to `release/` and a `release.yml` workflow in the maintainer repo, using a token scoped to tag and release the product repo. Remove them from the product repo | M + P | M | 1.1 | A dry-run release from the maintainer repo produces the tag and release notes it would publish, without publishing |

**Checkpoint 1:** the product repo contains no maintainer-only material, and maintainer agents get layer 3 in every workspace shape.

## Phase 2: Instruction layers and first skills

This phase is docs and skills only, on `main`. `platform/` starts to exist here, holding docs and skills; code moves in Phase 5.

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 2.1 | **Split `AGENTS.md`.** Usage content → `platform/AGENTS.md` (layer 2). Write the layer 1 templates in `platform/templates/` (root `AGENTS.md` opening with "read `platform/AGENTS.md`"; `CLAUDE.md` importing both). The product repo's own root files are these templates, filled in for the reference apps | P | M | 1.4 | Combined layer 1 + 2 is under 32 KiB; no layer 3 content remains; links valid |
| 2.2 | **Split docs by the layer test** (§7). Usage → `platform/docs/`; internals → the maintainer repo's `docs/platform-internals/`. Includes renaming away the `docs/claude/` folder | P + M | M | 2.1, 1.2 | Every former `docs/` file has one home; links valid |
| 2.3 | **Skill scaffolding.** `platform/agent-skills/` with the Agent Skills format; links in `.claude/skills/platform-*` and `.agents/skills/platform-*`; a check that every link resolves | P | S | 2.1 | Both tools list the platform skills when started at the repo root |
| 2.4 | **Convert existing commands** to skills: `platform-pr-review`, `platform-pr-respond`, `platform-deps` (the app-facing dependency skill, never touching `platform/**`) | P | S | 2.3 | Old `.claude/commands/*.md` and `.agents/skills/deps-*` are removed or replaced |
| 2.5 | **First new skills:** `platform-add-table`, `platform-add-page`, `platform-add-strings`. Written against today's layout; paths are updated in Phase 5 | P | M | 2.3 | A clean-worktree agent completes each skill's example task on a reference app, with CI green |

**Checkpoint 2:** a clean worktree (no overrides) gives an agent only usage guidance and skills. Maintainers build reference-app features through them from now on (decision 9).

## Phase 3: Configuration seam

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 3.1 | **`app.config.ts`**: identity (name, legal entity, support email, URLs), runtime (ports, cookie prefix, origins), brand (logos, token overrides, email palette and footer), switches (waitlist, invitations, announcements, environment banner). Typed, validated at load | P | M | 0.2 | One module; schema-validated; unit tests |
| 3.2 | **Read it everywhere.** Dev scripts and `dev-start.sh` ports; Playwright configs; CI env blocks; auth cookie prefix; TOTP issuer in `auth.ts`; page metadata; email templates (colours, footer, `lang`); `copy-shared-assets.sh` icons | P | L | 3.1 | Changing name, ports or cookie prefix in `app.config.ts` alone produces a working build with dev, E2E and CI following; `grep` finds no hard-coded product name or port outside it |
| 3.3 | **Product name out of message files**, passed as a message argument; remove `appName` from all 15 locales | P | S | 3.1 | Renaming the product touches no locale file |
| 3.4 | **`platform-configure` skill** | P | S | 3.2, 2.3 | An agent sets name, ports and cookie prefix via the skill with no other file edits |
| 3.5 | **Measure:** redo the lifeor2-client trial merge against the new `main` | M | S | 3.2 | The 9 value-related conflicts no longer occur; recorded in the evidence log |

**Checkpoint 3:** every value an app is likely to change lives in one app-owned file.

## Phase 4: Convex spike (decision gate)

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 4.1 | **Spike on `auditTrail`** (throwaway branch): a local `convex-platform` component with the `auditTrail` table and logic; wrappers in `convex/platform/`; declared env; the `convex-helpers` paginator; the admin app reading through wrappers; `convex-test` with component registration; a data migration on a staging copy | P | M (2–3 days) | — | Each exit criterion (§16) is recorded as pass or fail |
| 4.2 | **Decision record** in the maintainer repo: go ahead with the component, or fall back to `convex/platform/` without a component | M | S | 4.1 | Recorded; Phase 5.6 and Phase 6 scope set accordingly |

**Checkpoint 4:** the backend approach is decided.

## Phase 5: The big move (breaking, on `v2`)

The order matters: paths first, then the things that depend on them.

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 5.1 | **Package rename and move.** `packages/*` except `backend` → `platform/packages/`, renamed `@web-app-starter/*`. Workspaces, tsconfig paths, Turbo filters, Next `transpilePackages`, CI path filters. Ship the rename as a **codemod** in `platform/tooling/codemods/` and use it on the repo itself | P | L | Phase 2 | `bun run ci` green; the codemod is idempotent and has tests |
| 5.2 | **Platform apps.** `apps/admin`, `apps/storybook` → `platform/apps/` | P | M | 5.1 | Both build, test and deploy to staging |
| 5.3 | **Tooling.** Dev scripts, `setup-e2e`, local CI, `resolve-i18n-conflicts` and codemods → `platform/tooling/`; root `package.json` scripts point there | P | M | 5.1 | Every documented `bun run` command still works |
| 5.4 | **Root files.** `CHANGELOG`, `VERSIONING`, `UPGRADING`, `LICENSE` and `COMMERCIAL-LICENSE` → `platform/`. `platform/VERSION`. Short, stable root `README.md`; root keeps the evaluation `LICENSE`; `platform/templates/LICENSE` (proprietary, carving out `platform/`, pending a legal read). Base configs → `platform/config/`; root configs extend them | P | M | 5.1 | Root holds only seams and templates |
| 5.5 | **Auth routes out of `web`.** Sign-in, sign-up, reset, verify, invitations, `clear-session` and the auth part of `proxy.ts` → `@web-app-starter/auth-ui` (logic plus default views); `web` re-exports | P | L | 5.1 | Auth E2E suite green; `web` holds no auth logic |
| 5.6 | **Backend split.** Platform functions → `convex/platform/` (plus the component shell if 4.2 said go). The sample domain stays in the app zone with its own schema fragment | P | L | 4.2, 5.1 | Backend tests green; `schema.ts` holds only app tables plus the platform hook |
| 5.7 | **i18n split.** Platform namespaces into platform files, app namespaces into app files, merged at load; app override file; validation of stale overrides; locale subset setting | P | M | 5.1, 3.3 | Adding an app string touches no platform file |
| 5.8 | **Reusable workflows.** `platform-*.yml` (CI, CD, security) plus thin callers. Paid features conditional (CodeQL, dependency review, attestations, environment protections) with visible notices. Platform suite runs when `platform/**` changes. Check that actions stay SHA-pinned | P | L | 5.1 | CI green; a private-repo run on GitHub Free skips the paid features cleanly (tested on a scratch private repo) |
| 5.9 | **Renovate preset** in `platform/config/` with `ignorePaths: ["platform/**"]`; platform packages declare ranges | P | S | 5.1 | Renovate dry run proposes no change under `platform/` |
| 5.10 | **Zone check, `.platform-base.json`, `PLATFORM-PATCH`**: a tool and a CI job; a `platform-patch` skill | P | M | 5.4 | An unrecorded edit under `platform/` fails CI; a recorded one passes and is listed |
| 5.11 | **Contracts job:** session and cookie isolation (would have caught lifeor2's `clear-session` revert), endpoint authorization (#150), headers, env check. Runs on every PR | P | M | 5.5 | Contracts run against the reference apps; a deliberately reverted cookie fix fails |
| 5.12 | **`bun run adopt`** (§9) | P | M | 5.4, 5.10, 3.1 | On a fresh clone: set values, swap templates, optionally strip the sample and landings, link skills, write the base record; then zone check and build pass |
| 5.13 | **Update skills and docs for new paths**: the Phase 2 skills, `platform/AGENTS.md`, `platform/docs/` | P | S | 5.1–5.12 | Skill example tasks pass again on the new layout |

**Checkpoint 5:** on `v2`, a fresh clone can be adopted, stripped and built. Reference apps pass the zone check and contracts. CI runs on GitHub Free.

## Phase 6: Component migration (if Phase 4 said go)

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 6.1 | `auditTrail` for real (from the spike) | P | M | 5.6 | Tests green; admin reads through wrappers |
| 6.2 | `appSettings`, `announcements` | P | M | 6.1 | Same |
| 6.3 | Waitlist and invitations (includes pagination rework) | P | M | 6.1 | Same |
| 6.4 | `userProfiles`, `adminEmails`, sessions, rate-limit state | P | L | 6.1 | Same; auth E2E green |
| 6.5 | **Data migration** action plus status check; run on staging | P | M | 6.1–6.4 | Row counts match on staging; old tables dropped from `schema.ts` |

**Checkpoint 6:** platform data lives in the component, and staging is migrated.

## Phase 7: Upgrade tool and update delivery

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 7.1 | **`platform:upgrade` design document.** Topics: skipping versions, seam hooks, conflicts in seams, stop conditions, dry run, rollback, migration ordering | M | M | Phase 5 | Reviewed and approved |
| 7.2 | **`platform:upgrade` MVP.** Plan (read-only, including removed env still read by app code), apply (platform zone wholesale, seams three-way, codemods, lockfile regenerated), verify, record. `--non-interactive --report` for CI | P | L | 7.1 | Upgrades a reference app between two local test tags; the report lists everything §11 requires |
| 7.3 | **Release assets.** `release.ts` generates `advisories.json` and `breaking-changes.json`; `release.yml` attaches them | M | M | 1.7 | A dry-run release produces both files, validated by schema |
| 7.4 | **`update-check.ts` and the advisory check** in the contracts job | P | S | 7.3 | Installed version affected at `high` fails CI; lower warns |
| 7.5 | **`platform-update.yml`** (check, upgrade, PR or issue, outcomes, labels) and the caller template | P | L | 7.2, 7.4 | On a scratch private repo: a newer test release produces a PR that CI tests automatically; a conflicting one produces a draft PR; a major produces an issue |
| 7.6 | **`platform:setup-updates`**: the app-manifest flow (local server, preset permissions, code exchange, install prompt, store the ID and key with `gh`) and the `GITHUB_TOKEN` fallback | P | M | 7.5 | A buyer-style run on a scratch account completes setup in one sitting |
| 7.7 | **`platform-upgrade` skill** for finishing draft update PRs | P | S | 7.2 | An agent finishes a seeded draft PR with CI green |

**Checkpoint 7:** a scratch private app receives a test release automatically, as a tested PR.

## Phase 8: Lab

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 8.1 | **Fixtures:** reference apps at pinned tags plus one synthetic heavily customised app, adopted and stripped | M | M | 5.12 | `fixtures.json` lists them; each builds |
| 8.2 | **`rehearse.ts` and `lab.yml`:** upgrade each fixture to a candidate **through `platform-update.yml`**, run all checks, record results | M | L | 7.5, 8.1 | A candidate run produces a pass/fail table in the evidence log |
| 8.3 | **Skill tests:** each skill's example task on a freshly adopted app, headless agent, scored on skill use, platform-zone edits and CI | M | M | 8.1 | Results per skill in the lab report |
| 8.4 | **First-contact test** (the seven tasks: rename and recolour, add a billing page, run beside another project on port 4000, cookie clash, update dependencies, take an unreleased fix early, "what next?"). A "before" baseline can be taken from the pre-migration commit | M | M | 8.3 | Before and after scores recorded |

**Checkpoint 8:** a release candidate can be rehearsed end to end without manual steps.

## Phase 9: Release v2.0.0

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 9.1 | Merge `v2` into `main` | P | S | Checkpoints 5–8 | `main` green |
| 9.2 | `release.ts prepare v2.0.0`: changelog (v1.0.0 marked prepared but never published), advisories, breaking-change manifest | M | S | 9.1 | Release PR open |
| 9.3 | Lab rehearsal of the candidate | M | S | 9.2 | All green, or accepted exceptions recorded |
| 9.4 | Legal read of the evaluation and app-template licences | — | — | 5.4 | Approved |
| 9.5 | Publish v2.0.0 from the maintainer repo | M | S | 9.3, 9.4 | Tag, release and both JSON assets are public |

## Phase 10: Re-baseline lifeor2-client

lifeor2-client forked before the new layout, so its first move to v2.0.0 is a **one-time migration**, not a normal upgrade. It's the real-world test of the codemod and the migration notes.

| # | Task | Repo | Size | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| 10.1 | Migration guide for pre-v2 apps: run the rename codemod, map old paths to new, move app values into `app.config.ts`, move app strings to app namespaces, adopt the templates, write `.platform-base.json` | P | M | 9.5 | Guide published in `platform/UPGRADING.md` |
| 10.2 | Migrate lifeor2-client on a branch, following only the guide and skills | lifeor2-client | M | 10.1 | Its build, tests and session-isolation test pass; data migration done |
| 10.3 | Install the update workflow in lifeor2-client; the next release arrives as a tested PR | lifeor2-client | S | 10.2, 7.6 | First automatic update PR received |
| 10.4 | Evidence-log entry: conflicts, silent breaks, time, interventions, compared with the case study | M | S | 10.2 | Recorded |

## Cross-cutting rules

- **Every PR in the product repo** keeps `bun run ci` green and updates layer 2 docs and skills in the same PR when behaviour changes (layer 3 rule).
- **No maintainer material** enters the product repo; the release checklist confirms it.
- **Actions stay SHA-pinned.**
- **Reference apps** never carry `PLATFORM-PATCH` markers.
- **History:** ordinary commits and merges only; no rebase or force-push on shared branches.

## Open items tracked by this plan

| Item | Resolved in |
| --- | --- |
| Whether #148 fits the configuration seam | 0.1 |
| Unresolved security-review findings | 1.3 |
| Component or `convex/platform/` only | 4.2 |
| Legal wording of the licences | 9.4 |
| Detailed upgrade tool design | 7.1 |
| First feature to pilot the four-part feature delivery (§15) | After v2.0.0, with the roadmap |
