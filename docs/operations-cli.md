# Operations evidence CLI

```bash
bun run ops                              # glanceable builds + staging / production
bun run ops history --app web            # upload, deploy and workflow chronology
bun run ops candidates                   # full SHAs and production-gate evidence
bun run ops candidates --sha <40-character-commit-sha>
bun run ops history --limit 30 --pages 10 --json
```

**Read-only.** No deployment, promotion, rollback, approval, workflow dispatch, tag,
secret or environment mutation commands exist. This is an evidence browser, not a
release controller. Deploy using the existing [runbook](./deployment-runbook.md)
and `.github/workflows/cd-production.yml` after reviewing the evidence.

## Install and authenticate

Run from the repository root. Requires **Node.js 20+**, Bun, Git and the authenticated
[GitHub CLI](https://cli.github.com/) (`gh` on PATH). The CLI and tests are strict
TypeScript compiled with the repository's TypeScript compiler and executed by **Node**,
not Bun or Python. There are no additional runtime dependencies or global CLI installs.

```bash
bun install --frozen-lockfile
bun run ops --help
```

`bun run ops` compiles into ignored `scripts/ops/dist/`, then starts Node. To compile
once and invoke without the Bun wrapper: `bun run build:ops`, then
`node scripts/ops/dist/cli.js history`. No Python is needed for this CLI.

Use `gh auth login` once, or inject `GH_TOKEN` / `GITHUB_TOKEN` through your usual
secret manager. The CLI delegates authentication to `gh api`, as the deployment
composite actions do. For private repositories a fine-grained token needs read
access to Actions, Contents, Deployments and Commit statuses, plus repository
metadata. A classic token needs appropriate repository access. Public metadata can
be readable with fewer permissions, but Actions artifacts may still require auth.
Only **github.com** repositories are supported currently.

For Vercel, inject **`VERCEL_TOKEN`** into the process environment: the same variable
used by the deployment workflows, with access to the relevant team and projects.
The token needs project/deployment read access; no write capability is used. A local
`vercel login` session is not automatically imported. The CLI does not retrieve
GitHub secret values, read application `.env.local` files, or pull Vercel environment
variables. A project response can contain additional fields, but only deployment
identity/state/commit fields are retained for output. Raw response bodies and
subprocess stderr are never printed; credentials are never command-line arguments.

Do not put credentials in JSON configuration, commit them, or paste them into
shared terminal output. `--json` exports only normalized evidence, not raw provider
responses; URL query strings, fragments and userinfo are excluded.

## Repository and Vercel configuration

Repository precedence: `--repo OWNER/REPO`, `GH_REPO`, configuration `repo`, then
this checkout's GitHub `origin` URL. It never reads a hard-coded repository or team.

Application names come from `apps/*/package.json`, plus any extra configured app
names. Currently `web`, `admin`, `landing`, `landing-static`, `storybook` and `demo`
are recognized. **Only web/admin/landing have production CD jobs today.** CI build
jobs for the other apps are shown when available, not invented deployable bundles.
Convex deploy jobs appear in history; there is no live Convex health/schema query.

Pass an explicit, credential-free JSON file (nothing is auto-created):

```json
{
  "repo": "your-org/your-repo",
  "team_id": "team_REPLACE",
  "projects": {
    "web": {
      "staging": "prj_REPLACEwebSTAGING",
      "production": "prj_REPLACEwebPRODUCTION"
    },
    "admin": {
      "staging": "prj_REPLACEadminSTAGING",
      "production": "prj_REPLACEadminPRODUCTION"
    },
    "landing": {
      "staging": "prj_REPLACElandingSTAGING",
      "production": "prj_REPLACElandingPRODUCTION"
    }
  }
}
```

```bash
bun run ops --config ops-projects.json
bun run ops history --repo your-org/your-repo --config ops-projects.json --app admin
bun run ops --no-vercel                  # explicitly incomplete, GitHub-only
```

Alternatively inject `VERCEL_ORG_ID` and the existing pipeline variable names:
`VERCEL_PROJECT_ID_WEB_STAGING`, `VERCEL_PROJECT_ID_WEB`, and the equivalent
`ADMIN` / `LANDING` names. These override JSON values. For other applications the
name is uppercased and hyphens become underscores, e.g.
`VERCEL_PROJECT_ID_LANDING_STATIC_STAGING`. Omit `team_id` for a personal scope.
Project **IDs**, not names or guessed URL prefixes, are required. A project ID
cannot map to two app/environment pairs.

Staging and production are **separate Vercel projects**. Both deploy with `--prod`;
Vercel's `target: production` must NOT be interpreted as this repo's production
environment. Only the explicit project mapping establishes the environment. Missing
mappings and inaccessible/nonexistent production projects remain visibly unknown.

## Views and fields

- **Overview:** latest observed prebuilt upload per app, or CI build evidence when no
  upload was observed; latest observed deployment per app/environment; separate
  Vercel current-project target ID; three recent CD workflow runs.
- **History:** newest-first uploads, deployments/tags, CI/build-resolution jobs and
  workflows, then starter source-version tags. Each section displays up to `--limit`
  rows, with provider identifiers and links. Rows from multiple sources are retained
  deliberately, not counted as distinct physical deployments.
- **Candidates:** full commit SHAs, staging/production tag times, latest CI gate,
  same-checkout artifact names/availability and release labels. A filtered app does
  not narrow the repository-wide production workflow or make its gates app-specific.
- **JSON:** versioned envelope (`schema_version: 1`), all collected/filtered events,
  candidates, per-source coverage and limitations. Unlike the history table, the
  events array is not display-truncated. `sha` is the attributed checkout/deployment
  commit; `context_sha` is the provider's workflow context and may differ. `related`
  links matching deployment URLs, or full SHA **and** app for browsing artifacts.
  An artifact relationship does **not** assert that those bytes were deployed.

Times are UTC. An artifact time is **upload creation**, not exact build completion;
CI events expose Build-step start and completion when available. Deployment event
`time` is creation/start, `updated_at` is the observed completion/latest status time.
GitHub `inactive` is an environment-record state, not proof a Vercel deployment stopped
serving. Vercel `READY` is a deployment state, not a live health check.

`current: true` comes only from the mapped project's `targets.production.id`, never
from the newest successful deployment. A newer failed deploy can coexist with an
older current target. This is Vercel's reported project target, not an audit of every
custom alias, domain, traffic split or protection rule. Unknown current state is null.

Short SHAs in overview/history are display-only. All joins use full 40-character
SHAs plus application. Use `--json` or candidates to copy a full SHA; `--sha` rejects
prefixes. An exact SHA filter omits records whose actual SHA could not be established;
inspect unfiltered history to see those unknown records.

## Candidate classification — what it does and does not mean

| Classification | Evidence |
|---|---|
| `gates-pass` | A staging deployment tag whose **resolved commit matches its full SHA suffix**, plus a currently successful `ci/gate-passed` commit status |
| `blocked` | CI gate reports failure, error or pending |
| `insufficient-evidence` | No verified staging tag in the inspected evidence, or the gate is missing/unavailable |

These mirror the *evidence* gates in `cd-production.yml`, without executing its
confirmation or dispatch. The CLI deliberately does not copy that workflow's
short-SHA fallback. `gates-pass` is **not a recommendation, human approval, healthy
staging guarantee, all-app test certification, or guarantee deployment will succeed**.
A staging tag is repository-wide: selective deployment can skip unchanged apps, and
a rollback tag is not a comprehensive health check. Review per-app history too.

Candidates are ordered by latest observed activity, not git ancestry or semantic
version. Starter `vMAJOR.MINOR.PATCH` tags label source releases only; they are not
staging evidence or deployable Vercel artifacts. See [VERSIONING.md](../VERSIONING.md).

### Artifact identity and provenance

The authoritative contracts are:

- [build-app](../.github/actions/build-app/action.yml): `<app>-<Turborepo-input-hash>`,
  repo-wide reuse, build only on a miss, manifest + tarball + checksum, 90-day retention.
- [deploy-vercel](../.github/actions/deploy-vercel/action.yml): download by source run,
  check input hash and checksum, deploy prebuilt, set runtime `DEPLOYED_COMMIT`.
- [production](../.github/workflows/cd-production.yml) and
  [rollback](../.github/workflows/cd-rollback.yml): resolve artifacts through that
  same build action, not an unconditional rebuild or a requirement for SHA-named uploads.

The CLI recognizes current input-hash bundles and legacy full-SHA names; it excludes
test reports and arbitrary CI build directories. `available` means the artifact API
reports a non-expired upload with a future expiry, **not verified contents**. Deleted,
expired or out-of-window uploads cannot prove there was never a build.

A reused artifact may have been built at an older SHA. A successful resolution job
alone does not reveal which artifact was reused; **no nearest-build, timestamp or
short-SHA guess is made**. Candidate lists show attributable same-checkout uploads,
not a complete set of compatible artifacts. Missing artifacts do not automatically
block production: the workflow can build on a cache miss. Web/admin are designed for
cross-environment reuse; landing needs environment-specific inlined configuration.
The CLI does not recompute hashes, pull configuration, or verify that current build
inputs match an older artifact (including environment/configuration drift).

For manually dispatched production/rollback, GitHub `head_sha`, deployment `sha`,
and even the current manifest's `github.sha` can describe the workflow ref rather
than `inputs.git_sha` / `inputs.target_sha`. A verified deployment tag's annotation
links the run to its actual checkout target. Without that evidence, the target is
unknown unless a matching Vercel deployment supplies full git metadata. Metadata
conflicts are retained and flagged; a failed untagged dispatch is not silently
attributed to the default branch. Vercel git metadata is attribution, not attestation.

No artifact archives, workflow logs, manifest contents, tarball checksums or SLSA
attestations are downloaded/verified. The workflow verifies hash/checksum at deployment;
attestation coverage is a separate property and not inferred from run success. For
manual provenance verification follow [Artifact Security](./deployment-architecture.md#artifact-security).
No check of Convex schema compatibility, runtime configuration, live health, required
reviewers or deployment privileges is performed. Historical explanatory sections in
architecture/plan docs may describe older SHA-addressed workflows; current YAML wins.

## Coverage, cost and exit status

This is a bounded, non-atomic API snapshot, not an inventory transaction. Defaults:

- Up to 10 latest runs **per CD and app CI workflow**; latest-attempt jobs only.
- Up to 10 resolved deployment tags **per environment**, plus 10 source version tags;
  exact-SHA matching deployment tags are additionally resolved. Tagged runs are read
  even outside the run window.
- Up to 3 pages of 100 artifacts repo-wide, supplemented by selected CD runs' artifacts
  and builder context for recognized bundles. Busy repos can require `--pages 10`.
- Up to 40 GitHub deployments per environment (`min(100, 4 * --limit)`), with status
  pages; up to 3 pages of 100 Vercel deployments per configured project. An older
  current Vercel target is retained even outside those pages.

`--limit` and `--pages` accept 1–100. GitHub detail requests use at most six workers,
30-second request timeouts and no silent retries. Broader windows cost more API calls
and may hit rate limits. `complete` means that particular endpoint/window exhausted,
not all repository history. `windowed`, `partial` and `unavailable` are distinct and
appear in JSON; text always warns about bounded/incomplete evidence. Increasing
`--pages` does not widen the run/tag/deployment windows controlled by `--limit`.

Exit codes: **0** = requested sources read (possibly bounded); **2** = useful report
but at least one unavailable/partial source, including unmapped/disabled Vercel;
**1** = local configuration/runtime error (argument errors also use **2**).
Capture output even on exit 2. GitHub failures do not suppress Vercel, and vice versa.
No account-backed tests or remote writes are needed to validate the CLI:

```bash
bun run test:ops                         # strict compilation + node --test
bun run typecheck:ops                    # strict TypeScript check without emitting
bun run lint:ops                         # repository ESLint rules
```

Shared CI (`ci-shared.yml`) runs the CLI lint and Node tests in its lint/typecheck job.
Implementation and Node tests: `scripts/ops/*.ts`; deterministic provider fixture:
`scripts/tests/fixtures/ops-evidence.json`. Existing Python development-script tests
remain separate; they are not required to run the operations CLI.
