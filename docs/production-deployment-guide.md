# Production Deployment Guide

Step-by-step guide for deploying this monorepo to production using Vercel and Convex. Covers one-time infrastructure setup, first deployment, day-to-day operations, and rollback.

**This guide is for operators.** For pipeline internals (workflow architecture, artifact security, failure modes), see [deployment.md](./deployment.md).

## Architecture

```
                    GitHub Repository
                          │
                    Push to main
                          │
              ┌───────────┴───────────┐
              │     CI (4 workflows)  │
              │  shared, web, admin,  │
              │       landing         │
              └───────────┬───────────┘
                          │ all pass
                          ▼
                      CI Gate
                          │
              ┌───────────┴───────────┐
              │   Deploy Staging      │  ← automatic
              │                       │
              │  Convex (staging)     │
              │  Vercel ×3 (preview)  │
              └───────────┬───────────┘
                          │
                    Manual QA
                          │
              ┌───────────┴───────────┐
              │  Deploy Production    │  ← manual trigger
              │                       │
              │  Convex (production)  │
              │  Vercel ×3 (--prod)   │
              └───────────┴───────────┘
```

**Three Vercel projects:** web-app, admin-app, landing-app
**Two Convex deployments:** staging, production
**Rule:** Nothing reaches production without passing through staging first.

---

## 1. Prerequisites

### Accounts

| Service | Tier | URL |
|---------|------|-----|
| GitHub | Free (public) or Team (private) | github.com |
| Vercel | Hobby (free) or Pro | vercel.com |
| Convex | Starter (free) or Pro | convex.dev |

### CLI Tools

```bash
# Vercel CLI
bun add -g vercel

# Convex CLI (used via bunx, no global install needed)
bunx convex --version

# GitHub CLI
brew install gh
gh auth login
```

### Free Tier Limits

| Service | Limit | Expected Usage |
|---------|-------|----------------|
| GitHub Actions | 2,000 min/month (private) | ~200 min/month |
| GitHub Artifacts | 500 MB (private) | ~100 MB/month |
| Vercel Hobby | 1 person, 3 projects, unlimited deploys | Fits exactly (3 apps) |
| Convex Starter | 2 deployments | Staging + production fills it |

---

## 2. One-Time Infrastructure Setup

Complete these steps once, in order.

### 2a. Convex Cloud

**Create two deployments** in the [Convex dashboard](https://dashboard.convex.dev):

1. Create a project (e.g., `my-app`)
2. This gives you a "production" deployment — rename or note it as your **staging** deployment
3. Create a second deployment for **production**

**Set environment variables** for each deployment:

```bash
# Switch to the staging deployment first
# (select it in the dashboard or use CONVEX_DEPLOYMENT env var)

# Staging (include all app origins that authenticate against this backend)
bunx convex env set SITE_URL "https://your-staging-web.vercel.app,https://your-staging-admin.vercel.app"
bunx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"

# Production (switch deployment in dashboard first)
bunx convex env set SITE_URL "https://your-production-web.vercel.app,https://your-production-admin.vercel.app"
bunx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
```

> **IMPORTANT:** `BETTER_AUTH_SECRET` must be different for each environment. Generate a new random value for each.

> **Multi-app origins:** `SITE_URL` is a comma-separated list of all app origins that authenticate against this Convex backend. The auth config (`packages/backend/convex/auth.ts`) uses it to build `trustedOrigins`. If you add more apps, append their origins here.

**Generate deploy keys:**

1. In each deployment's Settings > Deploy Key, click "Generate"
2. Save the keys — you'll add them to GitHub in step 2c

**Record these values:**

| Value | Staging | Production |
|-------|---------|------------|
| Convex URL (`NEXT_PUBLIC_CONVEX_URL`) | `https://xxx.convex.cloud` | `https://yyy.convex.cloud` |
| Convex Site URL (`NEXT_PUBLIC_CONVEX_SITE_URL`) | `https://xxx.convex.site` | `https://yyy.convex.site` |
| Deploy Key | `prod:xxx...` | `prod:yyy...` |

### 2b. Vercel Projects

**Create three projects** in the [Vercel dashboard](https://vercel.com/dashboard):

| Project Name | App Directory | Purpose |
|--------------|---------------|---------|
| `web-app` | `apps/web` | Main web application |
| `admin-app` | `apps/admin` | Admin dashboard |
| `landing-app` | `apps/landing` | Marketing/landing page |

For **each project**:

1. **Disable Git auto-deploy:** Project Settings > Git > uncheck "Auto-Deploy"
   - Deployments are managed by the CI/CD pipeline, not Vercel's git integration
2. **Set the Framework Preset** to "Next.js"
3. **Set the Root Directory** to the app path (e.g., `apps/web`)

**Configure environment variables** for each project:

**web-app:**

| Variable | Preview (Staging) | Production |
|----------|-------------------|------------|
| `NEXT_PUBLIC_CONVEX_URL` | Staging Convex URL | Production Convex URL |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Staging Convex Site URL | Production Convex Site URL |
| `NEXT_PUBLIC_SITE_URL` | `https://staging-web.vercel.app` | `https://web.yourdomain.com` |

**admin-app:**

| Variable | Preview (Staging) | Production |
|----------|-------------------|------------|
| `NEXT_PUBLIC_CONVEX_URL` | Staging Convex URL | Production Convex URL |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Staging Convex Site URL | Production Convex Site URL |
| `NEXT_PUBLIC_SITE_URL` | `https://staging-admin.vercel.app` | `https://admin.yourdomain.com` |

**landing-app:**

| Variable | Preview (Staging) | Production |
|----------|-------------------|------------|
| `NEXT_PUBLIC_SITE_URL` | `https://staging-landing.vercel.app` | `https://yourdomain.com` |
| `NEXT_PUBLIC_WEB_APP_URL` | `https://staging-web.vercel.app` | `https://web.yourdomain.com` |

**Record these IDs:**

```bash
# Find your Vercel Org ID and Project IDs
vercel whoami          # Shows org
vercel project ls      # Lists projects with IDs
```

Or find them in each project's Settings > General.

| Value | ID |
|-------|-----|
| Vercel Org ID | `team_xxx` or `usr_xxx` |
| web-app Project ID | `prj_xxx` |
| admin-app Project ID | `prj_yyy` |
| landing-app Project ID | `prj_zzz` |

### 2c. GitHub Configuration

**Create environments** (Settings > Environments):

1. **`staging`**
   - Deployment branches: `main` only
   - No protection rules (auto-deploy on every push)

2. **`production`**
   - Deployment branches: `main` only
   - Required reviewers: add at least one person
   - Wait timer: 15 minutes (optional, gives time to cancel)

**Add repository secrets** (Settings > Secrets and Variables > Actions > Repository secrets):

| Secret | Value |
|--------|-------|
| `VERCEL_TOKEN` | Vercel personal access token (Settings > Tokens) |
| `VERCEL_ORG_ID` | Your Vercel org/user ID |
| `VERCEL_PROJECT_ID_WEB` | web-app project ID |
| `VERCEL_PROJECT_ID_ADMIN` | admin-app project ID |
| `VERCEL_PROJECT_ID_LANDING` | landing-app project ID |

> **Note:** `VERCEL_PROJECT_ID_*` must be **repository secrets** (not environment secrets) because the CD workflow build jobs run without an `environment:` context and can only access repository-level secrets.

**Add environment secrets** (Settings > Environments > [env] > Environment secrets):

| Secret | `staging` | `production` |
|--------|-----------|--------------|
| `CONVEX_DEPLOY_KEY` | Staging deploy key | Production deploy key |

> **Note:** `CONVEX_DEPLOY_KEY` must be different per environment — it controls which Convex deployment receives the push.

**Configure branch protection** (Settings > Branches > `main`):

- [x] Require a pull request before merging
- [x] Require status checks to pass before merging
  - Required checks: `CI Shared Complete`, `CI Web Complete`, `CI Admin Complete`, `CI Landing Complete`
- [x] Require branches to be up to date before merging

### 2d. Custom Domains (Production)

**Vercel domains** (per project, Settings > Domains):

| Project | Domain |
|---------|--------|
| landing-app | `yourdomain.com` |
| web-app | `app.yourdomain.com` (or `web.yourdomain.com`) |
| admin-app | `admin.yourdomain.com` |

Add the domain in Vercel, then configure DNS at your registrar:

```
# CNAME records (if using subdomains)
app.yourdomain.com     CNAME  cname.vercel-dns.com
admin.yourdomain.com   CNAME  cname.vercel-dns.com

# A record (if using apex domain for landing)
yourdomain.com         A      76.76.21.21
```

Vercel provisions SSL certificates automatically.

**Update Vercel environment variables** after adding custom domains — the `NEXT_PUBLIC_SITE_URL` production values should use the custom domain.

**Update Convex `SITE_URL`** to match the production custom domains (all auth origins):

```bash
# In production deployment
bunx convex env set SITE_URL "https://app.yourdomain.com,https://admin.yourdomain.com"
```

---

## 3. Pre-Deployment Checklist

Run through this checklist before the first deployment or any major infrastructure change.

### Code Readiness

- [ ] All CI checks pass locally: `bun run ci`
- [ ] No `console.log` debugging statements in production code
- [ ] TypeScript strict mode passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`
- [ ] All tests pass: `bun run test:all`
- [ ] Production build succeeds: `bun run build`

### Infrastructure Readiness

- [ ] Convex staging deployment exists with environment variables set
- [ ] Convex production deployment exists with environment variables set
- [ ] `BETTER_AUTH_SECRET` is unique per environment (staging != production)
- [ ] Vercel projects created (web-app, admin-app, landing-app)
- [ ] Vercel git auto-deploy is disabled for all projects
- [ ] Vercel environment variables set for both Preview and Production scopes
- [ ] GitHub `staging` environment created
- [ ] GitHub `production` environment created with required reviewers
- [ ] All repository secrets set (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_*`)
- [ ] All environment secrets set (`CONVEX_DEPLOY_KEY` per environment)
- [ ] Branch protection enabled on `main` with required status checks

### Verify Configuration

```bash
# Verify Convex env vars (run for each deployment)
bunx convex env list
# Should show: SITE_URL, BETTER_AUTH_SECRET

# Verify GitHub secrets are set (no way to read values, but check they exist)
gh secret list
gh secret list --env staging
gh secret list --env production

# Verify branch protection
gh api repos/{owner}/{repo}/branches/main/protection --jq '.required_status_checks.contexts[]'
# Should list: CI Shared Complete, CI Web Complete, CI Admin Complete, CI Landing Complete
```

---

## 4. First Deployment

### Step 1: Deploy to Staging

Staging deploys automatically on every push to `main`. For the first deployment:

```bash
# Ensure you're on main and up to date
git checkout main
git pull origin main

# Push (or merge a PR)
git push origin main
```

**Monitor the pipeline:**

```bash
# Watch CI workflows
gh run list --branch main --limit 5

# Wait for the CI gate
gh api repos/{owner}/{repo}/commits/$(git rev-parse HEAD)/status \
  --jq '.statuses[] | select(.context=="ci/gate-passed") | "\(.state) - \(.description)"'

# Watch the staging deployment
gh run list --workflow=cd-staging.yml --limit 1
gh run watch $(gh run list --workflow=cd-staging.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

### Step 2: Validate Staging

Once the staging workflow completes, run through this checklist:

**Automated checks (already done by the pipeline):**
- [x] All 3 apps respond to HTTP requests (smoke tests)
- [x] Git tag created: `deploy/staging/<timestamp>/<sha>`

**Manual checks:**

- [ ] **Landing page** loads at the staging URL
  - Navigation links work
  - Links to web app point to staging web URL
- [ ] **Web app** loads at the staging URL
  - Sign-up flow works (create a test account)
  - Sign-in flow works
  - Dashboard loads after sign-in
  - Sign-out works
  - Auth redirects work (visiting `/dashboard` while signed out → `/sign-in`)
- [ ] **Admin app** loads at the staging URL
  - Authentication works
  - Admin features load
- [ ] **Convex dashboard** shows the staging deployment is active
  - Functions tab shows deployed functions
  - Data tab shows tables (may be empty on first deploy)
  - Logs tab shows no errors
- [ ] **Security headers** present:
  ```bash
  curl -sI https://staging-web.vercel.app | grep -iE '(strict-transport|x-frame|x-content-type|referrer-policy|content-security)'
  ```
- [ ] **No console errors** in browser DevTools on any app

### Step 3: Promote to Production

```bash
# Find the staging deployment SHA
git fetch --tags
STAGING_SHA=$(git tag --list 'deploy/staging/*' --sort=-creatordate | head -1 | rev | cut -d'/' -f1 | rev)
echo "Staging SHA: ${STAGING_SHA}"

# Trigger production deployment
gh workflow run cd-production.yml \
  -f git_sha="${STAGING_SHA}" \
  -f confirm=deploy-production
```

**Approve the deployment** in the GitHub Actions UI:
1. Go to Actions > "Deploy Production" > the pending run
2. Click "Review deployments"
3. Select the `production` environment
4. Click "Approve and deploy"

**Monitor:**

```bash
gh run list --workflow=cd-production.yml --limit 1
gh run watch $(gh run list --workflow=cd-production.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

### Step 4: Verify Production

- [ ] All 3 production URLs respond
- [ ] Production git tag created:
  ```bash
  git fetch --tags
  git tag --list 'deploy/production/*' --sort=-creatordate | head -1
  ```
- [ ] Authentication works on production
- [ ] Custom domains resolve correctly (if configured)
- [ ] SSL certificates active (padlock in browser)
- [ ] Convex production deployment active in dashboard

---

## 5. Day-to-Day Operations

### Standard Deploy Flow

```
PR merged to main
       │
       ▼
CI runs (automatic, ~5 min)
       │
       ▼
Staging deploys (automatic, ~3 min)
       │
       ▼
Validate staging (manual, 2–5 min)
       │
       ▼
Promote to production (manual trigger)
```

### Quick Reference Commands

```bash
# ── Check what's deployed ──────────────────────────────
# Latest staging deployment
git fetch --tags
git tag --list 'deploy/staging/*' --sort=-creatordate | head -1

# Latest production deployment
git tag --list 'deploy/production/*' --sort=-creatordate | head -1

# What's on staging but NOT yet on production
PROD_SHA=$(git tag --list 'deploy/production/*' --sort=-creatordate | head -1 | rev | cut -d'/' -f1 | rev)
STAGE_SHA=$(git tag --list 'deploy/staging/*' --sort=-creatordate | head -1 | rev | cut -d'/' -f1 | rev)
git log --oneline ${PROD_SHA}..${STAGE_SHA}

# ── Deploy to production ───────────────────────────────
gh workflow run cd-production.yml \
  -f git_sha="${STAGE_SHA}" \
  -f confirm=deploy-production

# ── Monitor a running deployment ───────────────────────
gh run list --workflow=cd-staging.yml --limit 3
gh run list --workflow=cd-production.yml --limit 3

# ── Check CI status for a commit ───────────────────────
gh api repos/{owner}/{repo}/commits/$(git rev-parse HEAD)/status \
  --jq '.statuses[] | "\(.context): \(.state)"'
```

### Deploying Hotfixes

For urgent fixes that need to skip the normal PR review flow:

1. Create a hotfix branch, make the fix, push
2. Merge to `main` (with expedited review if your branch protection requires it)
3. CI runs → staging auto-deploys
4. Quick-validate staging
5. Promote to production immediately

The pipeline is the same — you're just moving faster through the manual validation step.

---

## 6. Post-Deployment Checklist

Run after every production deployment.

- [ ] Production deployment workflow completed successfully
- [ ] Git tag created: `deploy/production/<timestamp>/<sha>`
- [ ] All 3 production apps respond with HTTP 200:
  ```bash
  curl -sI https://web.yourdomain.com | head -1
  curl -sI https://admin.yourdomain.com | head -1
  curl -sI https://yourdomain.com | head -1
  ```
- [ ] Convex production deployment shows no errors in Logs tab
- [ ] Auth flow works (sign in with a test account)
- [ ] No new error spikes in Vercel Logs (project > Logs tab)
- [ ] Deployment tagged and visible in `git tag --list 'deploy/production/*'`

---

## 7. Rollback

### Decision: Rollback vs. Roll Forward

| Scenario | Action | Why |
|----------|--------|-----|
| Bug, no schema changes | **Rollback** | Fast return to known-good state |
| Bug with additive schema changes | **Rollback** | Additive changes are backward-compatible |
| Bug with breaking schema + migrated data | **Roll forward** | Old schema may be incompatible with new data |
| Performance regression | **Rollback** | Revert to last known-good state |
| Security vulnerability | **Rollback** | Speed matters; patch forward after |
| Data corruption | **Roll forward** | Rollback doesn't undo data damage |

### Rollback Steps

```bash
# 1. Find the last known-good SHA
git fetch --tags
git tag --list 'deploy/production/*' --sort=-creatordate | head -5
# Use the SECOND entry (the deployment before the broken one)
TARGET_SHA="<sha-from-second-entry>"

# 2. Verify what's in that deployment
git log --oneline ${TARGET_SHA} -5

# 3. Trigger the rollback
gh workflow run cd-rollback.yml \
  -f environment=production \
  -f target_sha="${TARGET_SHA}" \
  -f confirm=rollback-production

# 4. Monitor
gh run watch $(gh run list --workflow=cd-rollback.yml --limit 1 --json databaseId --jq '.[0].databaseId')

# 5. Verify
git fetch --tags
git tag --list 'deploy/production/rollback/*' --sort=-creatordate | head -1
curl -sI https://web.yourdomain.com | head -1
```

> **Note:** The rollback workflow rebuilds from source — it does not reuse old artifacts. This means rollback works regardless of artifact age (90-day retention). See [deployment.md — Rollback Procedures](./deployment.md#rollback-procedures) for edge cases.

---

## 8. Schema Migrations

### Safe Changes (Deploy Directly)

These go through the normal deploy pipeline with no special handling:

- New table
- Optional field (`v.optional(...)`)
- New index
- New Convex function
- New literal added to a `v.union()`

### Breaking Changes (Two-Phase Deploy)

These require a migration strategy:

1. **Phase 1:** Add new field/table alongside old one. Deploy. Both old and new code works.
2. **Backfill:** Run a migration to populate new field from old data.
3. **Phase 2:** Remove old field/table. Deploy. Only new code works.

**Checklist for breaking schema changes:**

- [ ] Phase 1 code is backward-compatible (old frontend + new backend works)
- [ ] Phase 1 deployed to staging and validated
- [ ] Phase 1 promoted to production
- [ ] Backfill migration tested on staging
- [ ] Backfill migration run on production
- [ ] Soak period (at least one full deployment cycle before Phase 2)
- [ ] Phase 2 deployed to staging and validated
- [ ] Phase 2 promoted to production
- [ ] Verified rollback is no longer possible past Phase 1 (accepted risk)

> See [deployment.md — Convex Schema Migration Safety](./deployment.md#convex-schema-migration-safety) for detailed examples.

---

## 9. Operational Health

### Where to Check Logs

| What | Where |
|------|-------|
| Application logs | Vercel dashboard > Project > Logs |
| Build logs | GitHub Actions > workflow run |
| Backend function logs | Convex dashboard > Deployment > Logs |
| Backend data | Convex dashboard > Deployment > Data |
| Deployment history | `git tag --list 'deploy/*' --sort=-creatordate` |
| CI status | GitHub Actions tab or `gh run list` |

### Deployment History

```bash
# All deployments (most recent first)
git fetch --tags
git tag --list 'deploy/*' --sort=-creatordate | head -20

# Production only
git tag --list 'deploy/production/*' --sort=-creatordate | head -10

# Staging only
git tag --list 'deploy/staging/*' --sort=-creatordate | head -10

# Rollbacks only
git tag --list 'deploy/*/rollback/*' --sort=-creatordate

# Details of a specific deployment
git tag -v '<tag-name>'
```

### Free Tier Monitoring

Check these periodically to avoid hitting limits:

| What | Where to Check | Limit |
|------|----------------|-------|
| GitHub Actions minutes | Settings > Billing > Actions | 2,000 min/month (private) |
| GitHub Artifacts storage | Settings > Billing > Actions | 500 MB (private) |
| Vercel deployments | Vercel dashboard > Usage | Unlimited (Hobby) |
| Vercel bandwidth | Vercel dashboard > Usage | 100 GB/month (Hobby) |
| Convex function calls | Convex dashboard > Usage | Varies by plan |
| Convex storage | Convex dashboard > Usage | Varies by plan |

### Alerting

No automated alerting is configured by default. Options by team size:

| Team Size | Approach | Setup Required |
|-----------|----------|----------------|
| Solo | GitHub email notifications (built-in) | Enable in repo Settings > Notifications |
| Small team | Slack webhook on deploy failure | Add `SLACK_WEBHOOK_URL` secret + workflow job |
| Production-critical | PagerDuty / Opsgenie integration | Webhook integration |

> See [deployment.md — Alerting & Notifications](./deployment.md#alerting--notifications-future-enhancement) for implementation details.

---

## 10. Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Staging not deploying after push | CI gate hasn't passed yet | Wait for all 4 CI workflows; check `gh run list` |
| CI gate stuck as pending | One CI workflow hasn't completed | Check which workflow is still running |
| Production deploy rejected | Wrong confirmation string or SHA not staged | Use exact string `deploy-production`; verify SHA has a staging tag |
| Convex deploy fails | Wrong deploy key for the environment | Check `CONVEX_DEPLOY_KEY` secret matches the target deployment |
| App shows stale content | CDN cache or browser cache | Hard refresh; check Vercel deployment URL directly |
| Auth not working after deploy | `SITE_URL` mismatch in Convex env vars | Verify `SITE_URL` matches the actual app URL(s) |
| `BETTER_AUTH_SECRET` error | Secret not set or empty | Run `bunx convex env list` in the target deployment |
| Vercel build fails | Missing environment variables | Check Vercel dashboard > Project > Settings > Environment Variables |
| Rollback fails on schema | New data incompatible with old schema | Roll forward instead; see [Schema Migrations](#8-schema-migrations) |
| Health checks timeout | Cold start or CDN propagation | Re-run the job; if persistent, check Vercel logs |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────┐
│                  DEPLOY COMMANDS                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Check staging SHA:                                 │
│  git tag -l 'deploy/staging/*' --sort=-cd | head -1 │
│                                                     │
│  Promote to production:                             │
│  gh workflow run cd-production.yml \                │
│    -f git_sha=<SHA> -f confirm=deploy-production   │
│                                                     │
│  Rollback production:                               │
│  gh workflow run cd-rollback.yml \                  │
│    -f environment=production \                      │
│    -f target_sha=<SHA> \                            │
│    -f confirm=rollback-production                   │
│                                                     │
│  Monitor deployment:                                │
│  gh run list --workflow=cd-production.yml -L1       │
│  gh run watch <RUN_ID>                              │
│                                                     │
│  Check CI status:                                   │
│  gh api repos/{o}/{r}/commits/<SHA>/status \        │
│    --jq '.statuses[]|"\(.context): \(.state)"'     │
│                                                     │
└─────────────────────────────────────────────────────┘
```
