# Dependency Updates (Renovate)

Dependency bumps in this monorepo are automated with [Renovate](https://docs.renovatebot.com/),
running as a **self-hosted GitHub Action**. Renovate proposes updates, regenerates `bun.lock`, lets
the existing CI pipeline run, and opens PRs — but **only for releases that are at least 10 days old**,
so we adopt versions that the wider ecosystem has already vetted (not yanked, not a fresh
supply-chain surprise).

- Config: [`renovate.json`](../renovate.json)
- Workflow: [`.github/workflows/renovate.yml`](../.github/workflows/renovate.yml)

## How it runs

| | |
|---|---|
| **Schedule** | Cron in `renovate.yml` — Monday & Thursday at 06:00 UTC. |
| **Manual run** | GitHub → **Actions → Renovate → Run workflow** (`workflow_dispatch`). Pick `debug` log level to troubleshoot. |
| **Cooldown** | `minimumReleaseAge: "10 days"` + `internalChecksFilter: "strict"` — a new release is held until it has been public for 10 days. Younger releases show as *pending* on the dashboard rather than as open PRs. |
| **Progress** | Renovate maintains a **"Dependency Dashboard"** issue listing pending, open, and held updates. Start there. |
| **Lockfile** | Renovate updates `bun.lock` itself (the image bundles Bun and reads `packageManager: bun@…` from the root `package.json`). It also updates the root `overrides` pins. |

## Update & merge policy

Defined in `renovate.json` → `packageRules`:

- **Patch / minor / pin / digest** → **auto-merged** once all CI checks pass (`platformAutomerge`).
- **Dev dependencies** (non-major) → grouped into a single "dev dependencies (non-major)" PR.
- **Major versions** → **never auto-merged**; always a PR for a human to review.
- **Sensitive frameworks** (`next`, `react`, `react-dom`, `convex`, `better-auth` +
  `@convex-dev/better-auth` + `@better-auth/passkey`, `tailwindcss` + `@tailwindcss/postcss`) →
  their **majors are isolated** into individual PRs so changelogs / migration guides can be reviewed
  deliberately.

> The first run is intentionally noisy — it clears an accumulated drift backlog (several apps trail
> on next/react/convex/tailwind). Expect a wave of PRs, after which it stays quiet.

## The `RENOVATE_TOKEN` secret

**This is the one piece of manual setup, and the system does not work without it.**

### Why it's needed

Renovate authenticates to GitHub with this token. It **must not** be the default `GITHUB_TOKEN`,
because PRs opened by `GITHUB_TOKEN` **do not trigger other workflows** (a GitHub anti-recursion
rule). If Renovate used the default token, our `ci-*.yml` `pull_request` workflows would never run on
bump PRs — so "the tests run" would silently be false, and auto-merge (which waits on those checks)
could never complete.

### Creating it (fine-grained PAT)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** the org/user that owns this repo. **Repository access:** *Only select repositories* → this repo.
3. **Repository permissions:**
   - Contents: **Read and write**
   - Pull requests: **Read and write**
   - Workflows: **Read and write**
   - Issues: **Read and write** (for the Dependency Dashboard)
4. **Expiration:** set a finite expiry (e.g. 90 days) and note the date — see *Rotation* below.
5. Generate and copy the token.

> **Team alternative:** for shared ownership, create a dedicated **GitHub App** instead of a PAT
> (no personal account tied to it, finer control, longer-lived) and pass its installation token to
> the action. A PAT is fine to start.

### Storing it

GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:

- **Name:** `RENOVATE_TOKEN`
- **Value:** the token from above

`renovate.yml` reads it via `token: ${{ secrets.RENOVATE_TOKEN }}`.

### Managing & rotating it

- **Owner:** record who owns the token (a person, or the GitHub App).
- **Expiry:** fine-grained PATs expire. Put the renewal date somewhere visible.
- **Rotate:** regenerate the token (or extend its expiry) → update the `RENOVATE_TOKEN` secret with
  the new value. No code change needed.
- **Symptoms of an expired/invalid token:** the **Renovate** Actions run fails at authentication, or
  more subtly, Renovate stops opening PRs and the Dependency Dashboard goes stale. If bump PRs stop
  appearing, check the token first.

## Repo settings required for auto-merge

Auto-merge only works when GitHub permits it **and** CI checks are *required* — otherwise Renovate's
`platformAutomerge` merges as soon as GitHub allows, **before** CI finishes.

1. **Settings → General → Pull Requests → "Allow auto-merge"** — enable.
2. **Branch protection on `main`** — require the PR status checks that gate merges: the `*-complete`
   summary jobs from `ci-shared`, `ci-web`, `ci-admin`, and `ci-landing`.
3. Ensure the **`RENOVATE_TOKEN`** secret exists (above).

## Validating a config change

Before merging edits to `renovate.json`:

```bash
npx --yes --package renovate renovate-config-validator renovate.json
```

For a local dry run (no PRs created), from the repo root:

```bash
LOG_LEVEL=debug npx renovate --platform=local
```

Confirm it proposes bumps, **withholds** releases younger than 10 days ("Not enough time has
elapsed"), and plans to update `bun.lock` and the root `overrides`.
