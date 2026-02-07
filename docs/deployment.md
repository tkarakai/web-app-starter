# Deployment Pipeline

This document covers the artifact-based CI/CD pipeline for deploying the web, admin, and landing apps.

## Architecture

```
Push to main
  │
  ├─ CI (4 existing workflows run in parallel)
  │   ci-shared ─┐
  │   ci-web ────┤
  │   ci-admin ──┤  all must pass for same SHA
  │   ci-landing─┘
  │
  ▼
CI Gate ── aggregates all 4 CI results into one status check
  │
  ▼
Deploy Staging (automatic)
  ├─ Build apps with staging env vars (vercel build)
  ├─ Checksum + SLSA attest each artifact
  ├─ Upload to GitHub Artifacts
  ├─ Deploy Convex to staging
  ├─ Deploy 3 apps to Vercel (vercel deploy --prebuilt)
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
| CI Gate | `ci-gate.yml` | `workflow_run` (CI completion) | Aggregates all CI results into `ci/gate-passed` status |
| Deploy Staging | `cd-staging.yml` | Push to `main` | Auto-deploy to staging after CI passes |
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

Every push to `main` triggers the staging pipeline:

1. **CI Gate** waits for all 4 CI workflows to pass (polls `ci/gate-passed` status)
2. **Build** all 3 apps in parallel using `vercel build` with preview (staging) environment variables
3. **Attest** each artifact with SLSA build provenance via Sigstore
4. **Deploy Convex** backend to the staging deployment
5. **Deploy** all 3 apps to Vercel using `vercel deploy --prebuilt`
6. **Smoke test** each staging URL
7. **Tag** the commit with `deploy/staging/<timestamp>/<sha>`

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
deploy/staging/2026-02-07T15:30:00Z/abc1234...
deploy/production/2026-02-07T16:00:00Z/abc1234...
deploy/staging/rollback/2026-02-07T17:00:00Z/abc1234...
```

To find the latest production deployment:
```bash
git tag --list 'deploy/production/*' --sort=-creatordate | head -1
```

## Per-Environment Builds

`NEXT_PUBLIC_*` variables are baked into the JS bundle at build time by Next.js. A single artifact cannot serve both staging and production. The pipeline builds separate environment-specific artifacts from the **same commit SHA**, verified by the CI gate.

## Vercel Project Setup

Three Vercel projects, one per app. **Do not connect to git** — deployments are managed by the pipeline.

| Vercel Project | App | Staging (Preview) | Production |
|---|---|---|---|
| `web-app` | `apps/web` | Preview deployments | Production deployments |
| `admin-app` | `apps/admin` | Preview deployments | Production deployments |
| `landing-app` | `apps/landing` | Preview deployments | Production deployments |

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
3. **Disable auto-deploy from git** in each project (Settings > Git)
4. Set environment variables in each project's dashboard for both Preview and Production environments:

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

5. Note down: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and each project's `VERCEL_PROJECT_ID`

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

### Staging deploy not triggering
Check that the CI gate workflow ran and created the `ci/gate-passed` status. The staging workflow polls for this status with a 30-minute timeout.

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
