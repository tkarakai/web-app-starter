# Build Once, Promote Through Environments — Working Plan

**Status as of 2026-09-17.** Written as a handoff: it assumes no prior conversation
context. Read the first three sections before picking up any phase below.

**Phase 1 is done and green. Phase 2 is blocked on an upstream dependency — read
[The Convex adapter blocker](#the-convex-adapter-blocker) before touching anything else.**

| Phase | State |
|---|---|
| 0 — spike | done; cross-project prebuilt deploy proven to work (see [Phase 0](#phase-0--the-spike-done)) |
| **1 — leak guard** | **done**; `scripts/check-env-leak.sh`, wired into `build-app` in `--warn` mode |
| **2 — web + admin made promotable** | **BLOCKED — see [The Convex adapter blocker](#the-convex-adapter-blocker)**. The artifact is clean, but auth breaks at runtime. E2E is red on PR #102 |
| **3 — Vercel env migration** | **blocked** — needs dashboard/CLI access this session did not have. Exact commands in [Phase 3](#phase-3--vercel-env-migration-blocked) |
| 4 — promote in the pipeline | not started; depends on Phase 3 |
| 5 — close out | not started; depends on Phase 4 |

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
| `NEXT_PUBLIC_DEPLOY_TIMESTAMP` | `SITE_URL` (now eliminated — see below) |
| `NEXT_PUBLIC_BUILD_ID` | `LANDING_URL` |
| `NEXT_PUBLIC_APP_NAME` | `WEB_APP_URL` |
| | `APP_ENVIRONMENT` |

The left column is identical across a promote by construction, so inlining it is correct
and it keeps its `NEXT_PUBLIC_` prefix. The right column is what blocks promotion.

`SITE_URL` was removed from web and admin entirely rather than converted: `robots.ts`,
`sitemap.ts` and the layouts now derive the origin from the request `Host` header via
`getRequestOrigin()`. One fewer variable to configure and keep in sync per environment.

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

**`SITE_URL` is now test-harness config, not app config.** `dev-start.sh` writes it
unprefixed for web and admin, and only the Playwright configs read it, as the base URL to
point tests at. The apps themselves no longer read it at all.

## The Convex adapter blocker

**Removing `NEXT_PUBLIC_CONVEX_URL` breaks server-side auth**, even though
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

`e` is the explicitly passed URL. Some call path inside the adapter — `getToken()` works,
so it is one of the query helpers — does **not** forward the `convexUrl` we configured, and
falls through to that inlined default. Because the default is baked at build time, setting
`NEXT_PUBLIC_CONVEX_URL` as a *runtime* variable on the Vercel project cannot rescue it.

So the two outcomes are currently exclusive: keep `NEXT_PUBLIC_CONVEX_URL` at build time and
the artifact stays pinned to one environment, or drop it and auth breaks. Resolving this
means finding the adapter call path that drops the URL — likely a small upstream fix or a
constructor option — and is a prerequisite for Phase 2. See
`docs/claude/auth-e2e-and-upgrade-plan.md` for the adapter's upgrade history.

## A second, unrelated defect in this branch

`SITE_URL` was a poor choice of name: Convex **already** uses `SITE_URL`
(`packages/backend/convex/auth.ts:129`) for a *comma-separated list of trusted origins*,
and `dev-start.sh` syncs it with `convex env set SITE_URL`. The Next apps now write a
single origin under the same name into `apps/<app>/.env.local`. Nothing reads both today,
so this did not cause the E2E failure, but the collision should be resolved before Phase 2
lands — `APP_ORIGIN` or `E2E_BASE_URL` would be unambiguous, and only the Playwright
configs consume it.

## Phase 3 — Vercel env migration (blocked)

**Why it is blocked:** this session's tooling refused Vercel environment-variable writes
(secret-store writes). Nothing else stands in the way.

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

Resolve this before Phase 4: either the projects exist elsewhere and the secrets are
correct, or they need creating with Root Directory `apps/<app>` and Framework Preset
Next.js (per `docs/deployment-architecture.md`), after which the secrets need updating.

## Phase 4 — promote in the pipeline (not started)

1. `build-app`: drop `environment` from the artifact name (`web-<sha>`, not
   `web-production-<sha>`). Also exclude `.next/cache` from the tarball — the spike's
   artifact was **340 MB**, most of it build cache that `vercel deploy --prebuilt` never
   reads. This matters more once Phase 4 downloads these across workflows.
2. `deploy-vercel`: add a `run-id` input for cross-workflow artifact download.
   `cd-production.yml` already has the `actions: read` permission.
3. `cd-production.yml`: replace the `build-web` and `build-admin` jobs with one that
   resolves the `cd-staging` run for the input SHA and downloads its artifacts, then deploy
   against the production project IDs. **Keep `build-landing`** — landing is still built
   per environment.
4. `cd-rollback.yml` references artifact names and needs the same rename.

## Phase 5 — close out (not started)

- Flip `check-env-leak.sh` from `--warn` to blocking for web and admin.
- Delete the legacy `NEXT_PUBLIC_*` values from the web and admin Vercel projects. Until
  this happens the Convex SDK's internal fallback keeps inlining `NEXT_PUBLIC_CONVEX_URL`
  into server chunks — harmless, since nothing reads it, but the guard will report it.
- Update `docs/deployment-architecture.md`: the "Per-Environment Builds" section states
  that a single artifact cannot serve both environments, which stops being true for web and
  admin.
- Update `docs/deployment-runbook.md` with the promote flow.
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
