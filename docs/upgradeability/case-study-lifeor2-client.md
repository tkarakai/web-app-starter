# Upgradeability case study: lifeor2-client

**As of:** 2026-09-25
**Subject:** `~/dev/projects/lifeor2-client`, the first real business app built on this starter
**Companion to:** [upgradeability brainstorm v1](brainstorm-v1.md) (before this study) and [v2](brainstorm-v2.md) (revised with it)

## Summary

An agent built lifeor2-client on starter commit `e52e892` (16 Sep 2026). Its only instruction was "build the app based on the web-app-starter". Nine days later the starter is 47 commits ahead (374 files, v1.0.0 included).

A trial merge of starter `main` into the app gives **28 conflicted files and at least two silent runtime breaks**. Almost none of the conflicts come from the product itself. They come from four things the starter did not give the app:

1. **Configuration knobs.** The app needed a different auth cookie prefix and different ports. Both were literals spread across starter files.
2. **A way to take one upstream fix early.** The agent re-implemented an unreleased starter fix by hand, in Python.
3. **A place for branding and copy.** The product name was hard-coded into starter pages.
4. **Layered agent docs.** The app edited the starter's `CLAUDE.md`, `AGENTS.md` and `README.md` instead of adding its own.

The product code (about 11,000 lines) merges cleanly. Unprompted, the agent put all of it under `lifeor` names and plugged it in through the two seams that existed: a schema spread and an HTTP route.

The main lesson: **the seams that existed got used, and the conflicts are exactly where seams were missing.**

## Method

- Diffed the app against its fork point: `git diff e52e892 HEAD` in lifeor2-client. The app's history contains the starter's history, so the fork point is exact.
- Read the app's PRD, `CLAUDE.md`, `AGENTS.md` and the commit messages to see what the agent intended.
- Cloned the app into a scratch directory and ran `git merge upstream/main`. The app repo itself was not touched.
- Classified every conflict by cause, and searched the merged tree for changes that merge cleanly but break at runtime.

## What the agent did

| Area | What happened | Reading |
| --- | --- | --- |
| Product code | About 11k new lines, all namespaced: `components/lifeor/`, `lib/lifeor/`, `app/api/lifeor/`, `convex/lifeor*.ts`, `lifeorSchema.ts` | Good instinct, never asked for. Namespacing kept the product out of the merge. |
| Backend extension | `...lifeorTables` spread into `schema.ts` (3 lines); one `http.route` added in `http.ts` (3 lines) | Clean seams. Both files auto-merged. |
| Dashboard | A one-line swap in `dashboard/page.tsx`: `DashboardClient` became `Workspace` | Matches the "dashboard is a sample" decision. |
| Sample domain | Projects, tasks, uploads, `AppSidebar`, their tables and message namespaces were **left in place as dead code** | Nobody deletes the sample if deleting is not cheap and clearly safe. |
| Visual shell | Own workspace, no sidebar. A 909-line CSS file using design-system tokens (88 `var(--…)` references) and DS components | Tokens and primitives reused, layout replaced. The design system held up. |
| Branding | "LifeOR2" hard-coded in the sign-in page and root layout metadata. The environment banner removed. `appName` in all 15 locales still says "Web App Starter" | No brand place existed, so the brand went into starter files. |
| Localization | Zero message-file changes. All new UI strings are English literals | A 15-locale starter produced a one-locale app. The i18n system was bypassed, not extended. |
| Auth platform | Needed its own cookie prefix, because it shares localhost with LifeOR2's own Better Auth. The change was threaded through 9 files in 4 workspaces: `auth/server.ts`, a new `auth/cookies.ts`, backend `auth.ts` and `sessions.ts`, `edge-rate-limit`, both `proxy.ts`, both `clear-session` routes | A missing platform option. It also fixed a loose `endsWith("better-auth.session_token")` match. |
| Security hardening | Added `developmentOnly.ts` guards so mock email and dev seed cannot run outside local development. Touched 4 starter backend files | A general improvement that belongs upstream. |
| Ports | web moved 3001 → 3002 and admin to 3003, because LifeOR2 uses 3000–3001. Ports were changed in package scripts, Playwright configs, CI workflows and env examples | Ports are literals in many files. |
| Dev tooling | Commit message: "Port the process-isolation fix from web-app-starter PR #97". The agent re-implemented it in Python, which the starter forbids | The app wanted one fix before it was released. Upstream later shipped its own TypeScript version. |
| Admin app | Touched only through shared auth code (cookies) and ports | Consistent with "admin is consumed". |
| Landing, demo, storybook | Untouched. The PRD says "preserve their source initially; decide pruning during implementation" | Carried along unused. Pruning later rarely happens. |
| Provenance | The PRD records the exact starter commit. The old README was kept as `README.starter.md`. `CLAUDE.md` starts with "conventions below are inherited … upstream trackers are historical" | The agent invented a starter identity and doc layering on its own. |
| Dependencies | Own Renovate, 7 new runtime dependencies in `apps/web`, own pins (`convex` 1.31.7, `next` 16.1.6) | Independent drift from day one, as the brainstorm predicted. |
| Contracts | The app added `lifeor-session-isolation.spec.ts` and security tests of its own | Apps write contracts too, and those must survive upgrades. |

## What an upgrade looks like today

Trial merge of starter `main` (`HEAD..upstream/main`: 47 commits) into the app: **28 conflicted files**.

| Cause | Conflicted files | Count | Would the brainstorm's system remove it? |
| --- | --- | --- | --- |
| Hand-ported upstream fix | `dev-start.sh`, `dev-stop.sh`, `dev-stop-convex.sh`, `dev-status.sh`, `dev-nuke-all.sh`, `ci-shared.yml`, `.gitignore`, `docs/claude/development.md` | 8 | Yes, if a single fix can be taken on its own and the upgrade knows it was taken |
| Missing config knob (cookie prefix, ports) | `auth/server.ts`, both `clear-session` routes, both `playwright.config.ts`, both `.env.example`, `ci-web.yml`, `ci-admin.yml` | 9 | Yes, with a real configuration surface |
| Dependencies and lockfile | `bun.lock` (21 hunks), root `package.json`, `apps/web/package.json`, `renovate.json` | 4 | Partly: regenerate the lockfile, never merge it; publish floors |
| Starter docs edited in place | `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/dependency-updates.md` | 4 | Yes, with layered agent docs |
| Branding and copy in starter files | `sign-in/page.tsx`, `[locale]/layout.tsx` | 2 | Yes: brand module plus an app message file |
| Generated code | `convex/_generated/api.d.ts` | 1 | Regenerate |

Several conflicts also carry a starter change underneath. The starter moved from `NEXT_PUBLIC_CONVEX_URL` to unprefixed `CONVEX_URL`, moved the web app from `NEXT_PUBLIC_SITE_URL` to `APP_ORIGIN`, and refactored `auth/server.ts`. So `auth/server.ts` is a three-way tangle: the app's cookie prefix, the starter's env rename and the starter's refactor.

### Silent breaks: clean merges that are wrong

These are more dangerous than the 28 conflicts, because nothing flags them.

1. **Env rename.** App code reads `NEXT_PUBLIC_CONVEX_SITE_URL` once and `NEXT_PUBLIC_SITE_URL` twice (in `lib/lifeor/`). These merge cleanly. After the upgrade the starter no longer provides them, so the app either fails at runtime or quietly keeps legacy variables that pin the build to one environment.
2. **Reverting a security fix while resolving a conflict.** The starter side of both `clear-session` conflicts still hard-codes `better-auth.session_token`. Resolving with "take upstream", the obvious choice for a file the app "didn't really own", silently reverts the app's cookie isolation. Sign-out would then clear the wrong cookies. Only the app's own session-isolation E2E test would catch it.

### Effort estimate (judgment, not measured)

- **Mechanical, about 15 files:** generated code, lockfile, ports, env examples, CI env blocks, docs. An agent can do these reliably.
- **Needs judgment, about 8 files:** `auth/server.ts`, both `clear-session` routes, the sign-in page and layout, and the dev scripts. For the dev scripts, drop the Python port, adopt upstream's TypeScript version and check it isolates processes the same way.
- **Invisible without checks:** the env renames in product code, plus confirming the cookie prefix still reaches every new upstream code path.

Realistically this is a half-day to a day for an experienced developer, or an agent run with several human checkpoints. It is 9 days of drift, and each week of delay adds more.

## Lessons

1. **Seams get used; missing seams become conflicts.** With no instruction, the agent used the schema spread and HTTP route and namespaced its product. Every place with no seam (cookie name, ports, product name, copy, docs) turned into an in-place edit of starter code. The cheapest upgradeability work is adding seams, not tooling.
2. **The configuration surface is the biggest single cause.** Nine conflicts plus one silent break came from values the starter hard-codes. The brainstorm's branding topic was too narrow. Rule: any value an app is likely to change (name, ports, cookie prefix, origins, email sender, feature switches) is an input, never a literal repeated across files.
3. **Apps want individual fixes before releases.** The agent needed PR #97 before any release contained it and hand-ported it, which caused 8 conflicts and a language drift. The brainstorm assumed whole-release upgrades. There should be a supported "take this one fix" path that records what was taken, so the next upgrade can drop it. Smaller, more frequent starter releases reduce the need.
4. **Fixes flow upstream too.** Cookie-prefix configuration, dev-only guards on mock email and dev seed, and stricter cookie matching are all improvements the starter should take. The brainstorm treated the relationship as one-way. It needs a simple contribution path, for example a list of "upstream candidates" kept in the app.
5. **Unguided agents skip i18n and branding.** A 15-locale starter produced English-only product UI with the brand hard-coded. A brand module alone would not have prevented that; the agent has to be told, and ideally a lint must fail on product literals in starter files and untranslated JSX text.
6. **"Prune later" doesn't happen.** The sample domain, landing, demo and storybook were all kept "for now". They will keep pulling in upstream churn the app does not use (this upgrade alone brings 29 demo files, 45 `infra/aws` files and 33 `packages/ops` files). Removing the sample and unused apps must be a cheap, first-class, day-one operation, or every app will carry everything forever.
7. **Provenance and layered docs arise naturally.** The agent recorded the starter commit, kept the starter README aside and prefixed the inherited `CLAUDE.md`. That confirms the identity file idea. It also shows that 4 conflicts come from the app editing starter-owned agent docs; starter guidance should live in files the app never edits, with the app's guidance layered on top.
8. **The conflict count understates the risk.** The two silent breaks matter more than the 28 conflicts. The brainstorm's behaviour contracts are the only defence, and they must include the app's own contracts (session isolation) as well as the starter's.
9. **The starter moves fast.** 47 commits, a release and a breaking env rename landed within 9 days of the fork. Release notes need an explicit "breaking" list with what to rename, and apps benefit from upgrading often while the diff is small.
10. **The admin app and design system held up.** Admin was untouched apart from shared auth plumbing, which supports treating it as consumed. The design system's tokens and primitives were reused inside a completely different layout, which supports "restyle, don't rewrite".

## What this changes in the brainstorm

| Brainstorm item | Effect |
| --- | --- |
| Topic 2, sample domain | **Confirmed and sharpened.** The sample was not deleted, because deleting was not obviously safe. Add "drop unused apps (landing, demo, storybook)" to the same day-one operation. |
| Topic 7, branding | **Widen to a configuration surface:** brand, ports, cookie prefix, origins, email sender. |
| Topic 8, localization | **Add enforcement.** Separation alone does not stop an agent writing English literals. |
| Topic 4, behaviour contracts | **Confirmed as the priority.** They are the only thing that catches the silent breaks. Contracts must also cover app-added invariants. |
| Topic 6, identity | **Confirmed.** The agent recorded the fork commit by itself. |
| Topic 12, agent benchmark | **lifeor2-client is benchmark run #1.** Upgrading it for real is the first measurable data point. |
| Topic 11, divergence | Recording what an app took early (hand-ported fixes) matters more than recording what it removed. |
| **New:** selective fix uptake | Add a supported path to take one upstream fix, with a record the next upgrade can use. |
| **New:** upstream contributions | Add a path for app-found improvements to reach the starter: cookie prefix, dev-only guards. |
| **New:** layered agent docs | Starter `AGENTS.md`/`CLAUDE.md` content moves to files the app never edits; the app's root docs import them. |

## Suggested next steps

1. **Upstream the app's improvements:** a cookie-prefix option in `@repo/auth`, the `developmentOnly` guards, and exact cookie matching in `hasSessionCookie`. That removes 3+ conflicts for this app and prevents them for every future one.
2. **Make ports and product name configuration,** then re-run the trial merge to measure the drop.
3. **Do the real upgrade of lifeor2-client** with an agent, on a branch, using this document as the plan. Record time, human interventions and what the contracts caught. That is the first real run of the upgrade benchmark.
4. **Ship a starter contract for session and cookie handling** that would have caught the `clear-session` revert.

## Reproducing the trial merge

```bash
git clone ~/dev/projects/lifeor2-client /tmp/lo2 && cd /tmp/lo2
git fetch ~/dev/projects/lifeor2-client refs/remotes/upstream/main:refs/remotes/upstream/main
git merge --no-edit upstream/main          # 28 conflicted files as of 2026-09-25
git diff --name-only --diff-filter=U
```
