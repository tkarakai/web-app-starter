# Build Once, Promote Through Environments — Working Plan

**Status as of 2026-09-17.** Written as a handoff: it assumes no prior conversation
context. Read the first three sections before picking up any phase below.

**Phases 1–4 and 6 are done. Start at Phase 5 — but read
[Production projects do not exist](#production-vercel-projects-do-not-exist) first: the promote
path cannot be exercised until those exist.**

The central question — *is build-once/promote possible with this stack at all?* — is
answered **yes**, and proven end to end: see
[Proof that promotion works](#proof-that-promotion-works).

| Phase | State |
|---|---|
| 0 — spike | done; cross-project prebuilt deploy proven to work (see [Phase 0](#phase-0--the-spike-done)) |
| **1 — leak guard** | **done**; `scripts/check-env-leak.sh`, wired into `build-app` in `--warn` mode |
| **2 — web + admin made promotable** | **done**; artifact carries no environment identity, and a build made with one Convex URL provably serves another at runtime. Full E2E green on both apps |
| **3 — Vercel env migration** | **done for staging**, verified: `app1-web-staging` and `app1-admin-staging` carry `CONVEX_URL`, `CONVEX_SITE_URL`, `APP_ENVIRONMENT` (+ `LANDING_URL` on web) alongside the legacy names. **Production projects still do not exist** |
| **4 — promote in the pipeline** | **done**; `cd-production` promotes web + admin instead of rebuilding. Untested end to end — no production projects to deploy into |
| 5 — close out | not started; depends on a real promote run |
| **6 — content-addressed artifacts** | **done**; artifacts are named by Turborepo's build-input hash, so an unchanged app is never rebuilt and every commit resolves. See [deployment-architecture.md](../deployment-architecture.md#artifacts-are-content-addressed) |

Scope: **web and admin only.** `landing` and `landing-static` keep `NEXT_PUBLIC_*` and
keep being rebuilt per environment. That is forced, not a compromise — see
[Why landing is excluded](#why-landing-is-excluded).

---

## 1. The problem

Next.js inlines every `NEXT_PUBLIC_*` variable into the JavaScript bundle at build time,
and inlines any `process.env` read that happens during a static prerender. An artifact
built with staging's configuration therefore *contains* staging's identity. It cannot be
promoted to production, which is why `cd-production.yml` rebuilds from source rather than
deploying the bits that were tested on staging.

This is not theoretical. From a real staging build of `apps/web`:

```
new n.ConvexReactClient("https://festive-civet-955.convex.cloud")
```

## 2. Why this is worth doing

What is deployed to production today is *a* build of the tested commit, not *the* build
that was tested. Any nondeterminism between the two runs — dependency resolution, builder
version, a Vercel project setting that drifted — reaches production unverified.

## 3. The variable taxonomy

The distinction the whole plan rests on:

| Build identity — safe to inline | Environment identity — must be runtime |
|---|---|
| `NEXT_PUBLIC_GIT_SHA` | `CONVEX_URL` |
| `NEXT_PUBLIC_GIT_BRANCH` | `CONVEX_SITE_URL` |
| `NEXT_PUBLIC_DEPLOY_TIMESTAMP` | `SITE_URL` (eliminated — see below) |
| `NEXT_PUBLIC_BUILD_ID` | `LANDING_URL` |
| `NEXT_PUBLIC_APP_NAME` | `WEB_APP_URL` |
| | `APP_ENVIRONMENT` |

The left column is identical across a promote by construction, so inlining it is correct
and it keeps its `NEXT_PUBLIC_` prefix. The right column is what blocks promotion.

`SITE_URL` was removed from web and admin entirely rather than converted: `robots.ts`,
`sitemap.ts` and the layouts now derive the origin from the request `Host` header via
`getRequestOrigin()`. One fewer variable to configure and keep in sync per environment.
Do not reintroduce the name — it belongs to Convex; see
[the collision](#a-second-defect-also-fixed-the-site_url-name-collision).

---

## Phase 0 — the spike (done)

Three findings worth not rediscovering:

**Cross-project prebuilt deploy works.** `apps/web` was built linked to
`app1-web-staging`, then deployed with `vercel deploy --prebuilt --prod` to a throwaway
project with a *different* project ID. Vercel logged `Using prebuilt build artifacts from
.vercel/output` and the deployment returned 200. The throwaway had **no Root Directory, no
framework preset and no environment variables** — so the Build Output API is genuinely
project-agnostic and Phase 4 does not require the two projects to have matching settings.

**The danger is real.** That throwaway project had zero environment variables, yet the
live deployment served `https://festive-civet-955.convex.cloud` and
`https://app1.staging.netsense.dev` from its client chunks. Substitute the production
project for the throwaway and that is production talking to the staging Convex backend.

**The guard's first version gave a false pass on the most important variable.** `vercel
pull` writes values double-quoted with a trailing escaped newline
(`FOO="https://x.convex.cloud\n"`). Sourcing that file produces a needle containing a
literal `\n` that never matches. `check-env-leak.sh` parses the file directly for this
reason — do not "simplify" it back to `source`.

## Phase 1 — the leak guard (done)

`scripts/check-env-leak.sh <app> [--warn]` reads the *values* of the environment-identity
variables from the pulled Vercel env and greps the build output for them. It is
self-configuring: there is no denylist to maintain, it simply asserts that nothing
`vercel pull` provided appears in the artifact.

It runs from `.github/actions/build-app/action.yml` in `--warn` mode. Flip it to blocking
in Phase 5, once no environment still depends on the legacy names.

Two details:

- Values shorter than 12 characters (`APP_ENVIRONMENT=staging`) are too common to match by
  value, so the guard looks for the inlined *identifier* instead.
- `.next/cache` and `*.map` are excluded — neither is served.

## Phase 2 — web and admin made promotable (done)

**Mechanism.** `packages/design-system/src/components/config/public-config.tsx` provides
`PublicConfigProvider` + `usePublicConfig()`. Each root layout calls
`readPublicConfigFromEnv()` at request time and passes the result down. React serializes
it into the RSC payload, so client components receive real runtime values from an
environment-agnostic build. No `<script>` injection and no CSP nonce handling needed.

**`readPublicConfigFromEnv` lives at `@repo/design-system/server`, not in the main
barrel.** Exporting server-side configuration reading from `src/index.ts` means any client
component importing from `@repo/design-system` pulls it in. Keep that separation.

**`getRequestOrigin` lives in `apps/web/src/lib/`, not in the design system.**
`@repo/design-system` imports nothing from `next` anywhere else and declares no `next`
peer dependency, so a `next/headers` import there resolved locally through hoisting but
failed in CI with `TS2307: Cannot find module 'next/headers'`. Only web needs the helper;
keeping the design system framework-agnostic was the right fix rather than adding the peer
dependency.

**Turborepo strips undeclared environment variables.** `NEXT_PUBLIC_*` is passed
through to tasks by default; the unprefixed names are not. Until they were added to
`turbo.json`, `turbo build` succeeded for each app run standalone but failed under turbo
with a module-evaluation throw from `@repo/auth`, because the variables never reached the
task. Any further runtime variable must be added to `turbo.json` as well as to Vercel.

**A non-obvious fix that mattered.** `apps/web/src/app/actions.ts` called
`fetchQuery(api.userProfiles.getLocale, {})` with no URL. `convex/nextjs` falls back to
`process.env.NEXT_PUBLIC_CONVEX_URL` *inside the SDK*, which Next then inlines — so the
artifact stayed pinned to staging even after every application-level read was fixed. The
URL is now passed explicitly. If a future leak appears in a `convex/dist/esm` chunk, look
for another implicit-URL call site.

**Verification.** Both apps were built against their real staging Vercel projects with the
legacy `NEXT_PUBLIC_*` names removed from the pulled env (simulating the Phase 5 end
state). The guard passes for both, and a direct scan for each staging value finds **0
files** in either artifact.

**`APP_ORIGIN` is test-harness config, not app config.** `dev-start.sh` writes it for web
and admin, and only the Playwright configs read it, as the base URL to point tests at. The
apps themselves derive their origin from the request and read no such variable.

## The Convex adapter defect (fixed)

**Removing `NEXT_PUBLIC_CONVEX_URL` broke server-side auth**, even though
`@repo/auth/server` passes `convexUrl` explicitly to `convexBetterAuthNextJs()`.

Symptom: `/dashboard` renders, but `fetchAuthQuery(api.auth.getCurrentUser)` in
`apps/admin/src/app/(dashboard)/layout.tsx` throws, so the guard redirects to
`/api/auth/clear-session` and every authenticated page bounces to `/sign-in?session_cleared=1`.
Both web and admin are affected.

Proven by bisection, not inference:

| state | `admin-sessions.spec.ts` |
|---|---|
| `origin/main` | 2 passed, 1 flaky-pass (31s) |
| this branch | **2 failed**, 1 passed (1.9m) |
| this branch + `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` added back to `apps/admin/.env.local` | **3 passed (22s)** |

The mechanism is visible in the compiled output. The Convex SDK's default URL is a
**build-time literal**, not a runtime lookup:

```js
let r = e ?? "http://127.0.0.1:3210";
... throw Error("Environment variable NEXT_PUBLIC_CONVEX_URL is not set.")
```

`e` is the explicitly passed URL. The culprit is one line in
`@convex-dev/better-auth@0.12.5`, `dist/nextjs/index.js`:

```js
const getArgsAndOptions = (args, token) => {
    return [args[0], { token }];   // no `url`
};
```

`convexBetterAuthNextJs` accepts `convexUrl` but only uses it when fetching tokens. Its
`fetchAuthQuery` / `preloadAuthQuery` / `fetchAuthMutation` / `fetchAuthAction` call
`convex/nextjs` with `{ token }` alone, so `NextjsOptions.url` falls back to its documented
default of `process.env.NEXT_PUBLIC_CONVEX_URL`. `getToken()` and `isAuthenticated()` were
unaffected because they use the explicitly passed `convexSiteUrl`.

**The fix is entirely on our side.** `NextjsOptions.url` is a supported option, and the
adapter package contains no `NEXT_PUBLIC` references of its own. `packages/auth/src/server.ts`
now re-exports `handler`, `getToken` and `isAuthenticated` from the adapter unchanged, and
implements the four data helpers itself as thin wrappers that pass
`{ token, url: process.env.CONVEX_URL }`. The adapter's own `callWithToken` retry path was
inert here — it only retries when `opts.jwtCache.enabled` is set, which this project does
not configure — so nothing was lost. Drop the wrappers if a future version forwards
`convexUrl` to its query helpers.

## Proof that promotion works

Not inferred from the artifact being clean — measured on a running server.
`apps/admin` was built with one Convex URL and started with a different one:

| | value |
|---|---|
| `CONVEX_URL` at build | `https://build-time-only.convex.cloud` |
| `CONVEX_URL` at runtime | `https://runtime-value-wins.convex.cloud` |
| served by `/sign-in` | **`runtime-value-wins.convex.cloud`** |
| build-time value in the served page | **absent** |

The build-time value appears nowhere in the served output (only in a `.js.map`, which is
not served). Combined with the guard passing against a real staging build, that is the
property build-once/promote requires.

Test evidence: `apps/admin` 11/11 passed; `apps/web` 103 passed with 1 flaky-pass
(`auth-rate-limits.spec.ts` — flaky on `origin/main` too).

## A second defect, also fixed: the `SITE_URL` name collision

`SITE_URL` was a poor choice of name. Convex **already** uses it
(`packages/backend/convex/auth.ts:129`) for a *comma-separated list of trusted origins*,
which `dev-start.sh` and `infra-setup-staging.sh` set via `convex env set SITE_URL`. Writing
a single app origin under the same name into `apps/<app>/.env.local` was ambiguous even
though nothing read both.

The app-level value is now `APP_ORIGIN`, and only the Playwright configs consume it, as the
URL to point tests at. `SITE_URL` again means exactly one thing: Convex's trusted-origin
list.

## Phase 3 — Vercel env migration (done for staging)

Verified on 2026-09-17: `app1-web-staging` and `app1-admin-staging` both carry the new
unprefixed names alongside the legacy `NEXT_PUBLIC_*` ones. The same still needs doing on the
production projects, once they exist.

The migration is deliberately dual-name so there is no flag day: add the new names
*alongside* the existing `NEXT_PUBLIC_*` ones, deploy Phase 2 code, then delete the old
ones in Phase 5. At no point does a deployment depend on both halves landing together.

For **`app1-web-staging`** and the production web project, add with Production scope:

| New name | Value |
|---|---|
| `CONVEX_URL` | same as existing `NEXT_PUBLIC_CONVEX_URL` |
| `CONVEX_SITE_URL` | same as existing `NEXT_PUBLIC_CONVEX_SITE_URL` |
| `LANDING_URL` | same as existing `NEXT_PUBLIC_LANDING_URL` |
| `APP_ENVIRONMENT` | same as existing `NEXT_PUBLIC_APP_ENVIRONMENT` |

For **`app1-admin-staging`** and the production admin project: the same minus
`LANDING_URL`.

Do **not** add `SITE_URL` — web and admin derive the origin from the request now.

Leave `app1-landing-staging` and the production landing project untouched.

```bash
# Per project, from a directory linked to it:
vercel link --yes --scope web-app-starter --project app1-web-staging
vercel env pull .env.p --environment=production        # read the existing values
printf '%s' "<value>" | vercel env add CONVEX_URL production
# ...repeat per variable
```

### Production Vercel projects do not exist

`vercel project ls` under the `web-app-starter` team lists only `app1-web-staging`,
`app1-admin-staging`, `app1-landing-staging` and the unrelated `cpa-prep`. The
`VERCEL_PROJECT_ID_WEB` / `_ADMIN` / `_LANDING` repository secrets point at projects that
are not visible in that scope.

Creating them was deliberately **not** attempted, for two reasons: the environment-variable
writes needed to make them useful are blocked anyway, and the correct production values are
not derivable from this repository — the production Convex deployment is reachable only
through `CONVEX_DEPLOY_KEY` in GitHub secrets (locally, `convex deployments` reports only
an anonymous dev deployment), and the production domains are not recorded anywhere in the
repo. Guessing either would be worse than leaving it.

Still true as of 2026-09-17: `vercel project ls` shows only the three `*-staging` projects and
the unrelated `cpa-prep`. This is now the single thing standing between the pipeline and a
working promote. The projects need creating with Root Directory `apps/<app>` and Framework
Preset Next.js (per `docs/deployment-architecture.md`), the four unprefixed variables setting
on each per Phase 3, and the `VERCEL_PROJECT_ID_*` secrets updating to the new IDs.

## Phase 4 — promote in the pipeline (done)

- `build-app` names artifacts `<app>-<sha>` with no environment segment, and excludes
  `.next/cache` and `.next/dev` from the tarball.

  > An earlier revision of this doc said the artifact was **340 MB, nearly all build
  > cache**. That was wrong: the bulk was `.next/dev`, stale `next dev` output on the
  > machine doing the measuring, which never exists on a fresh CI checkout. Measured
  > properly, a CI-equivalent `apps/web` artifact is **5.0 MB**. The exclusions are still
  > correct — CI does produce `.next/cache` during the build — just not for the reason
  > originally given.
- `deploy-vercel` gained `run-id` + `github-token` (cross-workflow download; empty values
  fall back to the current run, so one step serves both paths) and `expected-sha`, which
  checks the artifact's build manifest. A promoted artifact is deployed without being
  rebuilt, so its manifest is the only evidence of what it contains — trusting the artifact
  *name* would be enough to deploy the wrong run's bytes.
- `cd-production.yml` replaces `build-web`/`build-admin` with `resolve-staging-build`, which
  finds the `cd-staging` run holding both `web-<sha>` and `admin-<sha>`. `build-landing`
  stays. `attest` now covers landing only: web and admin were attested by the staging run
  that actually built those bytes.
- `cd-rollback.yml` picked up the artifact rename. Note it still *rebuilds* from the target
  SHA rather than promoting — worth revisiting, but out of scope here.

**Change detection interacts with promotion.** `cd-staging` builds only the apps whose files
changed, so a push-triggered run for a SHA may hold no `web-<sha>` artifact. Promoting a
different SHA's artifact would silently ship untested bytes, so `resolve-staging-build` fails
with an actionable message instead: re-run `cd-staging` for that SHA with `force_deploy=true`.
Artifacts also expire after 90 days, which the same check catches.

## Pre-merge verification of the staging path

Merging to `main` triggers `cd-staging` automatically, so the staging path is the one that
carries real risk. What was checked before merging, without running the workflow:

| Check | Result |
|---|---|
| `build-app` output names vs the names `cd-staging` passes to `deploy-vercel` | match exactly (`web-<sha>`, `web.tar.gz`, `web.tar.gz.sha256`) |
| `deploy-vercel`'s new empty-string `run-id` / `github-token` defaults | harmless — `download-artifact`'s cross-run path is guarded by `if (inputs.token)`, so an empty token takes the current-run path and `runID` (`parseInt("")` → `NaN`) is never read |
| Artifact completeness with `.next/cache` excluded | `robots.txt.func`, `sitemap.xml.func`, `[locale].func`, `_middleware.func` all present |
| `vercel deploy --prebuilt` of that artifact | deploys and aliases successfully; static chunks serve 200; middleware runs (CSP headers present) |
| `actionlint` | 34 findings on the branch, 34 on `main` — no new ones |

The deployed test artifact returns **500** on `/en` when the target project has no environment
variables. That is the intended behaviour, not a regression: `readPublicConfigFromEnv()` throws
on a missing `CONVEX_URL` so a misconfigured deployment fails loudly on the first request. Before
this work the same artifact would have returned 200 — while silently talking to whichever Convex
deployment built it, which is the bug being fixed.

`/robots.txt` returning 404 is pre-existing: the live `app1-web-staging` deployment on `main`
returns 404 for it too. The i18n middleware 307s it to `/en/robots.txt`.

**What this does not prove.** `cd-staging` itself has not run. Change detection, the CI gate,
artifact upload/download inside a real run, and the Convex deploy step are all unexercised. The
workflow is only dispatchable on the branch it lives on, so a genuine end-to-end test means
either dispatching `cd-staging` from this branch or merging and watching the first run.

## Phase 6 — content-addressed artifacts (done)

Phase 4 left a real hole: `cd-staging` builds only the apps whose files changed, so a
commit touching only `apps/web/**` produced a `deploy/staging` tag but no `admin-<sha>`
artifact — and `cd-production` required both. The runbook's "take the newest staging tag"
would hand you a SHA that could not be promoted. Building everything unconditionally would
have fixed it at the cost of the thing this whole effort exists to avoid.

The fix was to stop keying artifacts by commit. An artifact is a function of *that app's
inputs*, not of the repo's history, so it is named by Turborepo's hash of those inputs and
looked up repo-wide. Reuse then needs no bookkeeping: identical inputs produce an identical
name. Every commit resolves, because the hash comes from the tree at that commit.

The mechanism is documented in
[deployment-architecture.md](../deployment-architecture.md#artifacts-are-content-addressed).
What is worth not rediscovering are the two traps, both of which silently destroy reuse:

**1. Turborepo hashes declared env var *values*.** With the runtime variables in `env`, the
same source produced different hashes per environment, so production would never find
staging's artifact:

| env at build | web hash |
|---|---|
| staging values | `49c0e79e82ae01d8` |
| production values | `9099174289c3dee7` |

They belong in `passThroughEnv` — available to the task, excluded from the hash. With that,
all environments hash identically.

**2. Framework inference folds every `NEXT_PUBLIC_*` into the hash.** Turborepo infers
`nextjs` and auto-hashes those variables, which includes `NEXT_PUBLIC_GIT_SHA` — so the hash
moved on every commit and nothing was ever reused:

| | web hash |
|---|---|
| `GIT_SHA=aaa` | `92719641215039d5` |
| `GIT_SHA=bbb` | `e7677e6d44420101` |
| either, with `--framework-inference=false` | `0f0a86db85489206` |

The hash is therefore always computed with `--framework-inference=false`, and each app
declares what it hashes explicitly.

**Verified properties** (measured, not assumed):

| Scenario | web | admin | landing |
|---|---|---|---|
| staging vs production env | same hash ✅ | same hash ✅ | differs ✅ (correct — inlined config) |
| change `apps/web/src/**` | changes | unchanged → reused | unchanged → reused |
| add `README.md` / `AGENTS.md` | unchanged → reused | unchanged → reused | unchanged → reused |

The `!**/*.md` and `!qa/**` exclusions in `inputs` are what make the third row work; without
them the `AGENTS.md` that `next dev` generates inside `apps/web` would invalidate the build.

**Still true after this phase:** landing and landing-static are built once per environment,
because their config is inlined. Content addressing still saves them a rebuild when nothing
changed within an environment.

## Phase 5 — close out (not started)

- **Exercise a real promote** once production projects exist: deploy a SHA to staging, run
  `cd-production` for it, and confirm web/admin serve production config from the staging bytes.
  Nothing below should land before that.
- Flip `check-env-leak.sh` from `--warn` to blocking for web and admin. Expect it to still
  report one leak until the legacy names are deleted: with `NEXT_PUBLIC_CONVEX_URL` present at
  build time, the Convex SDK inlines it as its internal default. Nothing reads that default any
  more (see [the adapter defect](#the-convex-adapter-defect-fixed)), so it is harmless — but it
  is why the guard cannot be made blocking before the cleanup below.
- Delete the legacy `NEXT_PUBLIC_*` values from the web and admin Vercel projects. Until
  this happens the Convex SDK's internal fallback keeps inlining `NEXT_PUBLIC_CONVEX_URL`
  into server chunks — harmless, since nothing reads it, but the guard will report it.
- ~~Update `docs/deployment-architecture.md`~~ — done in Phase 4: "Per-Environment Builds"
  is now "Promotion (build once, deploy twice)", the flow diagram reflects promoting rather
  than rebuilding, and the inaccurate "requires approval from the `production` GitHub
  Environment" claim is corrected (there are no required reviewers — see below).
- Update `docs/deployment-runbook.md` with the promote flow and the
  `force_deploy=true` workaround for change-detection gaps.
- **Decide whether production should require human approval.** The `production` GitHub
  Environment has a branch policy but no required reviewers, so `cd-production` runs
  straight through on the confirmation string alone. That is a deliberate-looking gate that
  is not actually enforced; either add reviewers or stop describing it as an approval gate.
- Fix `CLAUDE.md`, which still describes `landing` as "Dynamic landing page — i18n, SSR".
  It has been a static export since PR #42.
- `scripts/infra-setup-staging.sh` still provisions only `NEXT_PUBLIC_*` names.

---

## Why landing is excluded

`apps/landing` sets `output: "export"` in production (PR #42). A static export has no
server at runtime, so it cannot read runtime environment variables at all — no amount of
variable renaming changes that.

Measured on real production builds, counting prerendered files containing environment
values:

| app | prerendered html / rsc | files with environment values baked in |
|---|---|---|
| web | 2 / 13 | 0 |
| admin | 1 / 6 | 0 |
| landing | 63 / 484 | **242** |

Rebuilding a static marketing page per environment is cheap and low-risk. The apps where a
stale-build-against-live-backend mismatch actually hurts — auth and Convex data — are the
two that become promotable.

If landing ever needs to promote too, the options are to drop `output: "export"` (which
`landing-static` already exists to provide), or to rewrite sentinel values in the tarball
at deploy time — the latter mutates the artifact *after* provenance attestation and is not
recommended.

## Relation to PR #35

PR #35 ("feat: build once, promote through environments") attempted this in February and
went stale: 27 conflicted files, and it assumed `landing` was server-rendered, which stopped
being true. It should be closed. The approach here differs in three ways that came out of
the spike: landing is excluded rather than converted, the leak guard exists so a missed
variable is a red build rather than a production incident, and the Vercel rename is
dual-name rather than a coordinated cutover.
