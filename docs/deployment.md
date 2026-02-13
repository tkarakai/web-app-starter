# Deployment Pipeline

This document covers the artifact-based CI/CD pipeline for deploying the web, admin, and landing apps.

## Architecture

```
Push to main → cd-staging.yml (one unified workflow)
  │
  ├─ CI phase (4 reusable workflow calls, parallel)
  │   ci-shared ─┐
  │   ci-web ────┤
  │   ci-admin ──┤  all must pass
  │   ci-landing─┘
  │
  ├─ CI Gate (sets ci/gate-passed commit status)
  │
  ├─ Change detection (which apps/packages changed?)
  │
  ├─ Build only changed apps (vercel build)
  ├─ Checksum + SLSA attest changed artifacts
  ├─ Deploy Convex to staging (if backend changed)
  ├─ Deploy changed apps to Vercel (vercel deploy --prebuilt)
  └─ Smoke tests + git tag
  │
  ▼
Deploy Production (manual trigger + approval gate)
  ├─ Verify this SHA was deployed to staging
  ├─ Build apps with production env vars (same SHA)
  ├─ Checksum + SLSA attest each artifact
  ├─ Deploy Convex to production
  ├─ Deploy 3 apps to Vercel (--prebuilt --prod)
  └─ Health checks + git tag
```

## Workflows

| Workflow | File | Trigger | Purpose |
|---|---|---|---|
| Deploy Staging | `cd-staging.yml` | Push to `main` | Unified CI + selective build/deploy to staging |
| Deploy Production | `cd-production.yml` | Manual (`workflow_dispatch`) | Deploy to production with approval gate |
| Rollback | `cd-rollback.yml` | Manual (`workflow_dispatch`) | Rollback any environment to a previous SHA |

## Composite Actions

| Action | Directory | Purpose |
|---|---|---|
| Build App | `.github/actions/build-app/` | Build a Next.js app via Vercel CLI, package as tarball |
| Deploy Vercel | `.github/actions/deploy-vercel/` | Deploy a prebuilt artifact to Vercel |
| Deploy Convex | `.github/actions/deploy-convex/` | Deploy Convex backend functions |

## How Deployments Work

### Staging (Automatic)

Every push to `main` triggers the unified `cd-staging.yml` workflow:

1. **CI phase** calls 4 CI workflows as reusable workflows (parallel)
2. **CI Gate** evaluates results and sets `ci/gate-passed` commit status
3. **Change detection** determines which apps/packages changed
4. **Build** only changed apps using `vercel build` with preview (staging) environment variables
5. **Attest** changed artifacts with SLSA build provenance via Sigstore
6. **Deploy Convex** backend (only if `packages/backend` changed)
7. **Deploy** changed apps to Vercel using `vercel deploy --prebuilt`
8. **Smoke test** deployed URLs
9. **Tag** the commit with `deploy/staging/<timestamp>/<sha>`

### Production (Manual)

Trigger via GitHub Actions UI or `gh` CLI:

```bash
gh workflow run cd-production.yml \
  -f git_sha=abc1234def5678... \
  -f confirm=deploy-production
```

The workflow:
1. **Validates** the confirmation string and verifies the SHA was deployed to staging
2. **Builds** all 3 apps with production environment variables
3. **Attests** artifacts
4. **Deploys Convex** to production (requires approval from the `production` GitHub Environment)
5. **Deploys** all 3 apps to Vercel with `--prod` flag
6. **Health checks** + creates annotated git tag `deploy/production/<timestamp>/<sha>`

### Rollback

Trigger via GitHub Actions UI or `gh` CLI:

```bash
# Rollback staging
gh workflow run cd-rollback.yml \
  -f environment=staging \
  -f target_sha=abc1234def5678... \
  -f confirm=rollback-staging

# Rollback production
gh workflow run cd-rollback.yml \
  -f environment=production \
  -f target_sha=abc1234def5678... \
  -f confirm=rollback-production
```

The rollback workflow rebuilds from the target SHA and redeploys. This ensures deterministic artifacts even if the original artifacts have expired (90-day retention).

## Artifact Security

### Checksums
Every build artifact (`.tar.gz`) has a companion `.sha256` checksum file. Checksums are verified before deployment.

### SLSA Build Provenance
Each artifact is attested using `actions/attest-build-provenance@v2` (Sigstore), providing SLSA Build Level 2 provenance. Verify with:

```bash
gh attestation verify <artifact.tar.gz> --repo owner/repo
```

### Build Manifest
Each build produces a JSON manifest recording: git SHA, environment, timestamp, workflow run URL, artifact checksum, and runner details.

### Git Tags
Every deployment creates a tag for auditability:

```
deploy/staging/2026-02-07T15-30-00Z/abc1234...
deploy/production/2026-02-07T16-00-00Z/abc1234...
deploy/staging/rollback/2026-02-07T17-00-00Z/abc1234...
```

To find the latest production deployment:
```bash
git tag --list 'deploy/production/*' --sort=-creatordate | head -1
```

## Per-Environment Builds

`NEXT_PUBLIC_*` variables are baked into the JS bundle at build time by Next.js. A single artifact cannot serve both staging and production. The pipeline builds separate environment-specific artifacts from the **same commit SHA**, verified by the CI gate.

## Vercel Project Setup

Three Vercel projects, one per app. **Do not connect to git** — deployments are managed by the pipeline.

| Vercel Project | App | Root Directory | Framework Preset | Staging (Preview) | Production |
|---|---|---|---|---|---|
| `web-app` | `apps/web` | `apps/web` | **Next.js** | Preview deployments | Production deployments |
| `admin-app` | `apps/admin` | `apps/admin` | **Next.js** | Preview deployments | Production deployments |
| `landing-app` | `apps/landing` | `apps/landing` | **Next.js** | Preview deployments | Production deployments |

> **Important:** Both **Root Directory** and **Framework Preset** must be set correctly. The build runs from the monorepo root to avoid a [Turbopack path-doubling bug](https://github.com/vercel/next.js/issues/88579); Root Directory tells the builder which app to build, and Framework Preset ensures `@vercel/next` is used (not `@vercel/static-build`).

## Convex Deployment

Convex deploys **before** frontend apps. Backend functions and schema must be live before app code that references them.

### Schema Migration Rules

- **Additive changes** (new tables, optional fields, indexes): safe to deploy directly
- **Breaking changes** (remove fields, change types): use two-phase deploy:
  1. Deploy backward-compatible Convex code (add new, keep old)
  2. Deploy frontend that uses new code
  3. Run data migration
  4. Deploy cleanup (remove old field)

## Prerequisites (Manual Setup)

### 1. Vercel Account & Projects

1. Create a Vercel account at [vercel.com](https://vercel.com) (Hobby/free tier)
2. Create 3 projects: `web-app`, `admin-app`, `landing-app`
3. **Set Root Directory** in each project (Settings > General > Root Directory): `apps/web`, `apps/admin`, `apps/landing` respectively. The build runs from the monorepo root; Root Directory tells the `@vercel/next` builder which app to build.
4. **Set Framework Preset** to **Next.js** in each project (Settings > General > Framework Preset). Without this, the builder detects `@vercel/static-build` from the monorepo root and fails.
5. **Disable auto-deploy from git** in each project (Settings > Git)
6. Set environment variables in each project's dashboard for both Preview and Production environments:

**web-app & admin-app:**
| Variable | Preview (Staging) | Production |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | Staging Convex URL | Production Convex URL |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Staging Convex Site URL | Production Convex Site URL |
| `NEXT_PUBLIC_SITE_URL` | App's staging URL | App's production URL |

**landing-app:**
| Variable | Preview (Staging) | Production |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Landing staging URL | Landing production URL |
| `NEXT_PUBLIC_WEB_APP_URL` | Web app staging URL | Web app production URL |

7. Note down: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and each project's `VERCEL_PROJECT_ID`

### 2. Convex Cloud Deployments

1. Create 2 Convex deployments: one for staging, one for production
2. Set environment variables in each deployment's dashboard:
   - `BETTER_AUTH_SECRET`: generate with `openssl rand -base64 32` (different per env)
   - `SITE_URL`: the Convex site URL for that deployment
3. Generate deploy keys in each deployment's settings

### 3. GitHub Repository Configuration

**Environments** (Settings > Environments):
- `staging`: no protection rules, deployment branches: `main`
- `production`: required reviewers, 15-minute wait timer, deployment branches: `main`

**Secrets** (Settings > Secrets and Variables > Actions):

| Secret | Scope | Description |
|---|---|---|
| `VERCEL_TOKEN` | Repository | Vercel personal access token |
| `VERCEL_ORG_ID` | Repository | Vercel team/org ID |
| `VERCEL_PROJECT_ID_WEB` | Environment (staging + production) | Web app Vercel project ID |
| `VERCEL_PROJECT_ID_ADMIN` | Environment (staging + production) | Admin app Vercel project ID |
| `VERCEL_PROJECT_ID_LANDING` | Environment (staging + production) | Landing app Vercel project ID |
| `CONVEX_DEPLOY_KEY` | Environment (staging) | Convex staging deploy key |
| `CONVEX_DEPLOY_KEY` | Environment (production) | Convex production deploy key |

**Branch protection** on `main`:
- Require PR reviews
- Required status checks: `CI Shared Complete`, `CI Web Complete`, `CI Admin Complete`, `CI Landing Complete`

## Troubleshooting

### Vercel build uses `@vercel/static-build` instead of `@vercel/next`
The Vercel project's Framework Preset is not set to Next.js. Since the build runs from the monorepo root, the builder doesn't auto-detect Next.js. **Fix:** Set Framework Preset to **Next.js** in each project's Settings > General.

### Vercel build fails with "No Output Directory named public"
Same root cause as above — `@vercel/static-build` expects a `public` directory. **Fix:** Set Framework Preset to **Next.js**.

### Staging deploy not triggering
Check the unified `cd-staging.yml` workflow run in GitHub Actions. The CI phase runs all 4 CI workflows as reusable workflows; if any fail, the CI Gate job fails and subsequent build/deploy jobs are skipped.

### Production deploy rejected
Verify: (1) confirmation string is exactly `deploy-production`, (2) the SHA has a staging deployment tag, (3) the `production` environment approval was granted.

### Artifact checksum mismatch
The deployment will fail if the artifact was corrupted during upload/download. Re-run the workflow — artifacts are rebuilt deterministically from the same SHA.

### Convex deployment fails
Check the deploy key is correct for the target environment. Deploy keys are scoped to a specific Convex deployment.

### Rollback to expired artifact
The rollback workflow rebuilds from source at the target SHA. As long as the git tag exists, rollback works regardless of artifact retention.

## Free Tier Constraints

| Service | Free Tier | Expected Usage |
|---|---|---|
| GitHub Actions | 2,000 min/month (private) | ~200 min/month |
| GitHub Artifacts | 500 MB (private) | ~100 MB/month |
| Vercel Hobby | 1 person, unlimited deploys, 3 projects | Fits exactly |
| Convex Starter | 2 deployments | Staging + production fills it |

---

## Failure Modes & Inconsistent States

The pipeline can leave the system in a partially-deployed state in several scenarios. This section catalogs each one, its impact, and the correct response.

### Build Phase Failure

Only changed apps are built (`build-web`, `build-admin`, `build-landing` run conditionally). Both `deploy-convex` and `attest` depend on **all build jobs** completing (unchanged apps are skipped, not failed). If any build fails:

- `deploy-convex` is skipped (no backend change)
- All frontend deploys are skipped
- System remains on the previous version — **clean state, no inconsistency**
- **Action:** Fix the build error and push again (staging) or re-run the workflow (production)

### Convex Deployment Failure

`deploy-convex` runs after all builds succeed. All three frontend deploy jobs depend on it. If Convex deploy fails:

- All frontend deploys are skipped
- System remains on the previous version — **clean state, no inconsistency**
- **Action:** Check the deploy key is correct for the target environment. Convex deploy keys are scoped to a specific deployment. Re-run the workflow after fixing.

### The Convex-First Window

This is an **expected transient state**, not a bug. After `deploy-convex` completes, the three frontend deploys start in parallel. During this window (typically 30–90 seconds):

- Old frontend code talks to the new Convex backend
- If the Convex changes are **backward-compatible** (new functions, new tables, new optional fields) → no user impact
- If the Convex changes are **breaking** (removed a query, renamed a function, changed return shape) → users see errors until frontends deploy

**This is why Convex changes must always be backward-compatible with the currently-running frontend.** See [Schema Migration Safety](#convex-schema-migration-safety) for how to handle breaking changes safely.

### Partial Frontend Deployment

`deploy-web`, `deploy-admin`, and `deploy-landing` run as three independent parallel jobs. If one succeeds and another fails:

- The succeeded app is on the new version; the failed app stays on the old version
- The smoke test / post-deploy job is skipped (it `needs` all three)
- The deployment tag is **not** created
- **Impact:** Usually low. The three apps are independent — they share the same Convex backend but do not call each other. Users of the failed app stay on the old version, which is compatible with the new backend (see Convex-first window above).
- **Action:** Re-run the failed job from the GitHub Actions UI. If that doesn't work, trigger the rollback workflow for the previous good SHA.

### Smoke Test / Health Check Failure

All three apps deployed successfully, but the smoke test (staging) or health check (production) fails:

- All apps are on the new version — the deployment **completed**
- The deployment tag is **not** created (record/post-deploy depends on smoke test)
- The failure might be **transient** (cold start, CDN propagation delay) or **real** (broken deployment)
- **Action:** Manually verify the URLs. If transient, re-run the smoke test job. If actually broken, trigger the rollback workflow.

### Attestation Failure

The `attest` job runs in parallel with `deploy-convex` — both depend on the builds, but not on each other. Attestation failure does **not** block Convex deployment or frontend deploys.

- **Impact:** Supply-chain integrity only — no SLSA provenance for this run. Artifacts still have SHA256 checksums.
- **Action:** Investigate the Sigstore/attestation error and re-run if needed. This is not urgent for functionality.

### Summary

| Failure Point | System State | User Impact | Action |
|---|---|---|---|
| Build failure | Previous version (clean) | None | Fix and re-push |
| Convex deploy failure | Previous version (clean) | None | Fix deploy key, re-run |
| Convex-first window | New backend, old frontends (transient) | None if backward-compatible | Ensure backward compatibility |
| Partial frontend deploy | Mixed frontend versions | Low (apps are independent) | Re-run failed job or rollback |
| Smoke test failure | New version deployed, tag missing | Possibly broken | Verify URLs, rollback if needed |
| Attestation failure | Deployment proceeds normally | None (integrity gap) | Re-run attestation |

---

## Rollback Procedures

### How Rollback Works

The `cd-rollback.yml` workflow performs a **full rebuild and redeploy** from the target SHA:

1. Validates the confirmation string and checks for a prior deployment tag
2. Checks out the target SHA and rebuilds all 3 apps for the target environment
3. Deploys Convex backend from the target SHA (backend first, same as forward deploy)
4. Deploys all 3 apps to Vercel using the freshly-built artifacts
5. Runs health checks and creates a rollback tag: `deploy/<env>/rollback/<timestamp>/<sha>`

The rebuild-from-source approach means rollback works **regardless of artifact age**. Original artifacts may have expired (90-day retention), but git history is permanent.

**Concurrency:** The rollback workflow uses the same concurrency group (`deploy-<env>`) as normal deploys, so a rollback cannot collide with an in-progress deployment.

### Step-by-Step Rollback Runbook

**1. Find the target SHA**

```bash
# List the last 10 successful deployments for the environment
git fetch --tags
git tag --list 'deploy/production/*' --sort=-creatordate | head -10

# Example output:
# deploy/production/2026-02-07T16-00-00Z/abc1234def5678...
# deploy/production/2026-02-05T12-30-00Z/def5678abc1234...
```

The SHA is the last segment of the tag name. Use the second most recent tag (the last known-good deployment before the current broken one).

**2. Verify the target SHA**

```bash
# Check what was in that deployment
git log --oneline abc1234def5678 -5

# Check the workflow run that created the tag (in the tag annotation)
git tag -v 'deploy/production/2026-02-05T12-30-00Z/def5678abc1234...'
```

**3. Trigger the rollback**

```bash
# Rollback production
gh workflow run cd-rollback.yml \
  -f environment=production \
  -f target_sha=def5678abc1234... \
  -f confirm=rollback-production

# Rollback staging
gh workflow run cd-rollback.yml \
  -f environment=staging \
  -f target_sha=def5678abc1234... \
  -f confirm=rollback-staging
```

**4. Monitor the rollback**

```bash
# Watch the workflow run
gh run list --workflow=cd-rollback.yml --limit=1
gh run watch <run-id>
```

**5. Verify**

```bash
# Confirm the rollback tag was created
git fetch --tags
git tag --list 'deploy/production/rollback/*' --sort=-creatordate | head -1

# Manually verify the deployment URLs
curl -sI https://your-web-app.vercel.app | head -1
curl -sI https://your-admin-app.vercel.app | head -1
curl -sI https://your-landing-app.vercel.app | head -1
```

### When Rollback Cannot Work

Rollback can fail in these scenarios:

**Breaking Convex schema changes with incompatible data.** If the new code wrote data using a new schema (e.g., added a required field, changed a field type), rolling back to the old schema will fail because Convex validates the schema against existing data. The old schema may reject documents written by the new code.

Example: You added `phase: v.string()` as a required field and deployed. New documents were created with `phase`. Rolling back to the old schema (which doesn't have `phase`) may succeed if `phase` is not in the schema validator, but rolling back to a schema that expects a different structure will fail.

**Changed Vercel environment variables.** The rollback rebuilds from source and pulls environment variables from the Vercel dashboard (`vercel pull`). If those variables have changed since the target SHA was originally deployed (e.g., a Convex URL was updated), the rebuilt artifact will use the **current** variables, not the original ones.

**Removed external dependencies.** If the target SHA references an npm package version or external API that is no longer available, the rebuild will fail.

### Rollback vs. Roll-Forward Decision Matrix

| Scenario | Rollback? | Roll Forward? | Rationale |
|---|---|---|---|
| Simple bug, no schema changes | **Yes** | — | Fastest path to working state |
| Bug with additive schema changes (new table, optional field) | **Yes** | — | Additive changes are backward-compatible |
| Bug with breaking schema + data already migrated | — | **Yes** | Old schema may be incompatible with new data |
| Performance regression | **Yes** | — | Revert to last known-good state |
| Security vulnerability | **Yes** | — | Speed matters; patch forward after rollback |
| Data corruption from new code | — | **Yes** | Rolling back code doesn't undo data damage; need a fix |

---

## Convex Schema Migration Safety

This section expands on the [Schema Migration Rules](#schema-migration-rules) above with detailed procedures and examples.

### Safe Changes (Deploy Directly)

These changes are backward-compatible and can go through the normal deployment pipeline:

| Change | Why It's Safe |
|---|---|
| Add a new table | Old code doesn't reference it |
| Add an optional field (`v.optional(...)`) | Old code ignores it; old documents don't have it |
| Add a new index | Old code doesn't use it |
| Add a new Convex function (query/mutation/action) | Old frontend doesn't call it |
| Add a new literal to a `v.union()` (e.g., adding `"archived"` to status) | Old documents use existing literals; new literal is only written by new code |

### Breaking Changes (Require Migration Strategy)

These changes can cause failures if deployed directly:

| Change | Risk |
|---|---|
| Remove a table | Old frontend code referencing it will crash |
| Remove a field | Old frontend code reading it gets `undefined` |
| Add a **required** field | Old code doesn't write it; new documents from old code fail validation |
| Change a field type (e.g., `v.string()` → `v.number()`) | Existing data doesn't match new validator |
| Rename a field | Same as remove old + add new required |
| Remove a literal from `v.union()` | Existing documents with that literal fail validation |
| Remove a Convex function | Old frontend calling it gets a runtime error |

### Two-Phase Migration Pattern

Use this pattern for zero-downtime breaking changes. Example: renaming `status` to `phase` on the `launchItems` table.

**Current schema:**
```typescript
launchItems: defineTable({
  title: v.string(),
  status: v.union(v.literal("idea"), v.literal("building"), v.literal("shipping")),
  // ...other fields
})
```

**Phase 1 — Add new field, keep old (backward-compatible)**

```typescript
// schema.ts — Phase 1
launchItems: defineTable({
  title: v.string(),
  status: v.union(v.literal("idea"), v.literal("building"), v.literal("shipping")),
  phase: v.optional(v.union(v.literal("idea"), v.literal("building"), v.literal("shipping"))),
  // ...other fields
})
```

```typescript
// mutation — Phase 1: write both fields
export const create = mutation({
  args: { title: v.string(), phase: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("launchItems", {
      title: args.title,
      status: args.phase,  // old field (for old frontend)
      phase: args.phase,   // new field (for new frontend)
      // ...
    });
  },
});

// query — Phase 1: read from new field with fallback
export const list = query({
  handler: async (ctx) => {
    const items = await ctx.db.query("launchItems").collect();
    return items.map(item => ({
      ...item,
      phase: item.phase ?? item.status,  // prefer new field, fall back to old
    }));
  },
});
```

Deploy Phase 1 Convex + frontend. Both old and new frontends work.

**Data migration — Backfill existing documents**

```typescript
// One-off action to backfill phase from status
export const backfillPhase = action({
  handler: async (ctx) => {
    const items = await ctx.runQuery(internal.launchItems.listWithoutPhase);
    for (const item of items) {
      await ctx.runMutation(internal.launchItems.setPhase, {
        id: item._id,
        phase: item.status,
      });
    }
  },
});
```

Run via the Convex dashboard or CLI: `npx convex run launchItems:backfillPhase`

**Phase 2 — Remove old field (cleanup)**

```typescript
// schema.ts — Phase 2
launchItems: defineTable({
  title: v.string(),
  phase: v.union(v.literal("idea"), v.literal("building"), v.literal("shipping")),
  // status field removed
  // ...other fields
})
```

Deploy Phase 2 Convex + frontend. Remove all `status` references from code.

### When Rollback Is Impossible

After Phase 2 cleanup:
- The `status` field is gone from the schema
- Rolling back to pre-Phase-1 code expects `status` as a required field
- If `status` was actually removed from documents during migration, rollback fails

**Mitigation:** Keep Phase 1 deployed for a soak period (at least one full deployment cycle) before proceeding to Phase 2. Test rollback in staging before cleaning up in production. Once Phase 2 is deployed and stable, accept that rollback past Phase 1 is no longer possible.

---

## Downtime & Maintenance Mode

### When Downtime Is NOT Needed

Most deployments require zero downtime:

- **Additive schema changes** — new tables, optional fields, new indexes, new functions
- **Frontend-only changes** — no Convex changes at all
- **Bug fixes** that don't change the data model
- **Two-phase migrations** — handled by the pattern above

### When Downtime May Be Needed

- **Breaking schema changes that cannot use two-phase** — extremely rare; usually means a fundamental data model redesign
- **Bulk data migrations requiring exclusive access** — e.g., re-keying all documents, merging tables
- **Infrastructure changes** — migrating to a different Convex deployment

### Option A: Maintenance Mode via Convex Flag (Future Enhancement)

Not currently implemented. Implementation sketch:

**1. Add a `systemSettings` table:**

```typescript
// schema.ts
systemSettings: defineTable({
  key: v.string(),
  value: v.string(),
}).index("by_key", ["key"]),
```

**2. Add a maintenance mode check to mutations:**

```typescript
// lib/maintenance.ts
export async function checkMaintenance(ctx: QueryCtx) {
  const setting = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", q => q.eq("key", "maintenanceMode"))
    .unique();
  if (setting?.value === "true") {
    throw new ConvexError("System is undergoing maintenance. Please try again shortly.");
  }
}
```

**3. Frontend checks the flag and shows a maintenance banner:**

```typescript
const maintenanceMode = useQuery(api.systemSettings.isMaintenanceMode);
if (maintenanceMode) return <MaintenanceBanner />;
```

**4. Deployment sequence with maintenance mode:**

```
1. Set maintenance flag:  npx convex run systemSettings:setMaintenance --args '{"enabled": true}'
   → Frontend shows maintenance banner
   → Mutations rejected server-side
2. Deploy Convex (schema migration)
3. Run data migration if needed
4. Deploy all 3 frontends
5. Verify health checks
6. Clear maintenance flag:  npx convex run systemSettings:setMaintenance --args '{"enabled": false}'
```

**Trade-offs:**
- Requires pre-existing maintenance mode code in the app before the first use
- Adds a query to every page load (the flag check)
- Simple to understand and operate

### Option B: Two-Phase Migration (Zero Downtime)

The preferred approach for most breaking changes. See [Two-Phase Migration Pattern](#two-phase-migration-pattern) above. Requires more careful planning but avoids any user-facing interruption.

### Decision Matrix

| Change Type | Downtime? | Recommended Approach |
|---|---|---|
| New table / optional field | No | Direct deploy |
| New Convex function | No | Direct deploy |
| Rename a field | No | Two-phase migration |
| Remove a field with data | No | Two-phase migration |
| Change field type | No | Two-phase migration |
| Add required field | No | Two-phase migration (add as optional first) |
| Complete schema redesign | Possibly | Maintenance mode or extended two-phase |
| Merge/split tables | No (usually) | Two-phase migration |
| Infrastructure migration | Yes | Maintenance mode |

---

## Artifact Retention & Recovery

### Artifact Lifecycle

GitHub Actions artifacts are retained for **90 days** (configured in `build-app/action.yml`). After 90 days:

- The tarball (`.tar.gz`) and checksum (`.sha256`) are deleted from GitHub
- The build manifest JSON is also deleted
- SLSA attestations remain in the GitHub attestation store (separate from artifact retention)
- **Git tags are permanent** and persist indefinitely in the repository

### Rollback Does Not Depend on Artifacts

The rollback workflow (`cd-rollback.yml`) **always rebuilds from source** at the target SHA. It never attempts to download old artifacts. This means rollback works at any point in the future, as long as:

- The git tag or SHA is known
- The Vercel environment variables are still valid
- The npm dependencies are still available in registries

### Finding Deployable SHAs

Git tags are the durable reference for identifying known-good deployment states:

```bash
# List recent production deployments
git fetch --tags
git tag --list 'deploy/production/*' --sort=-creatordate | head -10

# List recent staging deployments
git tag --list 'deploy/staging/*' --sort=-creatordate | head -10

# List all rollbacks
git tag --list 'deploy/*/rollback/*' --sort=-creatordate

# Get details of a specific deployment (shows workflow run URL)
git tag -v 'deploy/production/2026-02-07T16-00-00Z/abc1234...'

# Find all deployment tags for a specific SHA
git tag --list --points-at abc1234def5678 | grep deploy/
```

### Manual Artifact Recovery (Not Recommended)

It is technically possible to download artifacts from GitHub before they expire and store them externally (e.g., in an S3 bucket or a GitHub Release). To redeploy, you would upload the tarball and deploy with `vercel deploy --prebuilt`.

However, this is **error-prone and not recommended** because:
- The rebuild-from-source approach already handles expired artifacts
- Manual downloads risk version mismatches or corrupted files
- There's no automation around it, so it depends on someone remembering to do it

If artifact preservation is important for compliance or audit purposes, consider:
- Increasing the retention period (up to 400 days on GitHub Enterprise)
- Attaching artifacts to GitHub Releases for permanent storage
- Using the SLSA attestations (which persist independently) for provenance verification

---

## Alerting & Notifications (Future Enhancement)

No alerting mechanisms are currently implemented. Deployment failures are only visible in the GitHub Actions UI. This section documents available approaches.

### GitHub Built-in Email Notifications

GitHub sends email notifications for failed workflow runs by default to repository watchers.

**Configuration:** Repository Settings > Notifications > Actions

**Limitations:**
- Email only (no Slack, no PagerDuty)
- No granular filtering (all workflow failures, not just deployments)
- Can be noisy if CI also sends failure emails
- Delay depends on email delivery

**Recommendation:** Enable as a baseline. No code changes required.

### Slack Webhook Integration

Add a notification job to each CD workflow that fires on failure. Example implementation:

```yaml
# Add to cd-staging.yml, cd-production.yml, cd-rollback.yml
notify-failure:
  name: Notify Deployment Failure
  needs: [deploy-web, deploy-admin, deploy-landing]
  if: failure()
  runs-on: ubuntu-latest
  steps:
    - name: Send Slack notification
      uses: slackapi/slack-github-action@v2
      with:
        webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
        webhook-type: incoming-webhook
        payload: |
          {
            "text": ":red_circle: Deployment failed",
            "blocks": [
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "*Deployment Failed*\n*Workflow:* ${{ github.workflow }}\n*SHA:* `${{ github.sha }}`\n*Run:* <${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Run>"
                }
              }
            ]
          }
```

**Setup required:**
1. Create a Slack incoming webhook in your Slack workspace
2. Add `SLACK_WEBHOOK_URL` as a repository secret in GitHub
3. Add the `notify-failure` job to each CD workflow

### GitHub Deployments API

The pipeline already uses GitHub Environments, which tracks deployment status on the repository's Environments page. Third-party monitoring tools (Datadog, PagerDuty, Opsgenie) can poll the GitHub Deployments API for status changes.

```bash
# Check deployment status via API
gh api repos/{owner}/{repo}/deployments --jq '.[0:5] | .[] | "\(.environment) \(.sha[0:7]) \(.created_at)"'
```

### Recommendation

| Team Size | Approach |
|---|---|
| Solo / small team | GitHub email notifications (built-in, zero setup) |
| Team with Slack | Add Slack webhook to CD workflows |
| Production-critical | PagerDuty or Opsgenie integration via webhook |

---

## Auto-Rollback (Future Enhancement)

Automatic rollback on deployment failure is not currently implemented. This section documents the feasibility and trade-offs.

### Frontend Auto-Rollback (Feasible)

GitHub Actions supports `if: failure()` on jobs, which can trigger a rollback workflow when smoke tests fail. Implementation sketch:

```yaml
# Add to cd-staging.yml after the smoke-test job
auto-rollback:
  name: Auto-Rollback on Failure
  needs: [smoke-test]
  if: failure()
  runs-on: ubuntu-latest
  steps:
    - name: Find previous deployment SHA
      id: prev
      run: |
        git fetch --tags
        # Get the second most recent staging tag (skip the failed one, which wasn't tagged)
        PREV_TAG=$(git tag --list 'deploy/staging/*' --sort=-creatordate | head -1)
        PREV_SHA=$(echo "${PREV_TAG}" | rev | cut -d'/' -f1 | rev)
        echo "sha=${PREV_SHA}" >> "$GITHUB_OUTPUT"

    - name: Trigger rollback
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: |
        gh workflow run cd-rollback.yml \
          -f environment=staging \
          -f target_sha=${{ steps.prev.outputs.sha }} \
          -f confirm=rollback-staging
```

This pattern works for **frontend (Vercel) deployments** because Vercel deployments are independent and idempotent — deploying an old version over a new one is safe.

### Why Convex Auto-Rollback Is Risky

Convex auto-rollback should **not** be automated because:

1. **Data written during the Convex-first window.** Between Convex deploy and smoke test, the new backend may have processed mutations and written documents using the new schema. Auto-rolling back Convex could fail if the old schema is incompatible with this new data.

2. **Schema validation is strict.** Convex validates the deployed schema against all existing data. If new data doesn't match the old schema, the rollback deploy is rejected entirely.

3. **Data loss risk.** If the auto-rollback somehow succeeds (e.g., the schema change was additive), documents written during the window might become inaccessible or invalid.

Auto-rollback of Convex should always be a **manual decision** after assessing whether data was written against the new schema.

### Recommendation

- **Staging:** Auto-rollback of Vercel frontends is safe and useful for catching regressions early. Convex rollback stays manual.
- **Production:** Do not auto-rollback. Alert the team (see [Alerting & Notifications](#alerting--notifications-future-enhancement)) and let a human decide whether to rollback or roll forward.
- **Prerequisite:** Implement alerting first, so the team knows when auto-rollback fires and can verify the result.
