# Receive platform update PRs

Adoption records App, fallback or deferred intent in `.github/update-delivery.json` and installs the app-owned `.github/workflows/update-platform.yml` caller from
`platform/templates/update-platform.yml`. Existing adopted apps can copy that template once.
After explicit owner setup enables delivery, it checks releases on weekdays at 05:23 UTC and supports **Actions → Update platform → Run
workflow**, with an optional version. Edit the caller's schedule and policy to fit your app.

The reusable `.github/workflows/platform-update.yml` belongs to the platform. Keep it unchanged.
`policy: patch` proposes patches within your installed minor; `minor` proposes the newest release
within your installed major. `major` also leaves new majors for an issue and human review.
`auto-merge: false` is the default.

## Credentials

For automatic CI on update PRs, install a GitHub App on this app repository only, with Contents,
Pull requests, Workflows and Issues **write** permissions. Store its ID in repository variable
`PLATFORM_UPDATER_APP_ID` and its PEM private key in Actions secret
`PLATFORM_UPDATER_PRIVATE_KEY`. Keep the key out of your checkout, logs and reports.

Choose the limited `GITHUB_TOKEN` fallback explicitly through [owner setup](setup-updates.md).
Allow GitHub Actions to create PRs; this repository-wide switch also permits approval capability,
but the updater submits no approvals. Token-created PRs may require **Approve workflows to run** in the PR banner before CI starts.
Workflow-run approval, review approval and the PR-creation setting are separate operations;
other token-triggered events (such as labels) do not start CI.
App-owned CI callers need `contents: read` and `pull-requests: read` for change detection,
and the `ready_for_review` pull-request event to run browser checks after finishing a draft.
The v2 `v2-ci-callers.ts` codemod updates the standard callers while preserving custom grants.
Workflow-file changes instead produce an issue with the manual upgrade command because the
fallback token cannot push them. A configured App with a missing/invalid key fails visibly;
it does not silently fall back to a different identity.

## What arrives

| Result | Delivery |
| --- | --- |
| All upgrade checks, including E2E, pass | Ready PR with the exact verified tree and new baseline |
| Seam conflict, patch, advisory, new secret or migration needs review | Draft PR with JSON/Markdown report and a checklist; installed baseline stays unchanged |
| A check or delivery step fails | Issue linking the failed operation, credential mode, run and reports; an already-pushed branch has draft-PR and saved-plan recovery links |
| New major | Issue linking release notes and breaking changes; no automatic major-upgrade PR |

Labels include `platform-update`, advisory `severity:*`, `migration`, `new-env`, and `breaking`
when applicable. The newest published cumulative advisory metadata is pinned into the upgrade
plan, even when it was published after the selected target. High/critical advisories require
specific review; the target must be outside the affected range and pass contracts.

An existing PR for `platform-update/vX.Y.Z` is left for its reviewer. The workflow never
force-pushes or resets an existing branch. If the app base advances during verification, rerun
from the new base. If a prior push succeeded but creating its PR failed, inspect that branch and
open its PR as a draft using the diagnostic compare link, inspect `upgrade-report.md` and
`upgrade-report.json`, then resume with `--relocate` before review edits. Do not blindly rerun
into an existing branch. A green preparation job can mean only “review plan produced”; E2E
and upgrade verification may not have run. Keep permission/setup failures separate from normal
review requests. Delivery preflights the PR switch when its existing token can read it; lack of
Administration access is reported unknown and never broadened.

With `auto-merge: true`, only verified patches without migrations, environment changes,
unresolved patches or an advisory approval gate qualify. The App must be configured, and the
base branch must enforce required CI checks. Private GitHub Free repositories may not provide
that branch protection; auto-merge is then visibly skipped and you merge after checking CI.

## Finish a draft locally

Check out its `platform-update/vX.Y.Z` branch before editing files, then run:

```sh
bun run platform:upgrade --resume upgrade-report.json --relocate
```

Relocation checks the exact draft files, index, previous baseline and app history. It preserves
the immutable plan and completed codemods, repeats installation and every verification check,
and requires new secret-configuration evidence for the new environment. It refuses an
interrupted command or already-recorded upgrade. Follow [UPGRADING.md](../UPGRADING.md) to
resolve each named review item, resume, commit the changes and report pair, and keep the PR a
draft until verification and CI pass. Do not edit report JSON manually.

## Verification and delivery boundaries

Release discovery and app verification run with read-only repository access. Verification
executes trusted platform and app code on an isolated GitHub runner; it receives no App key,
write token or deployment secrets. It uses an anonymous local Convex backend for E2E and never
deploys or changes a hosted database. A migration or new secret always requires operator work.

A separate job mints the repository-scoped App token after verification finishes or is skipped.
It can publish an issue when discovery or verification fails, or when a major needs review. It validates
the source/target identities, report and patch digests, and exact Git tree. Only inline workflow
code, pinned actions and Git run with that token. It applies the patch, commits with hooks
disabled, and pushes normally; it runs no app or downloaded scripts. Artifacts are retained for
14 days. The separate `platform-verification-report` artifact retains the JSON/Markdown report
even if a check fails before delivery packaging; inspect its failed step and diagnostic. Your
normal PR CI runs again on the resulting commit.

The source defaults to public `tkarakai/web-app-starter`. Forks or rehearsal apps can explicitly
set `PLATFORM_SOURCE_REPOSITORY` to another trusted **public** release repository; this selects
code the upgrade executes. Use the same source for release discovery, advisory checks and the
CI baseline fetch. Private release sources are not supported by this public-source protocol.

## Self-hosted Linux runners

Start with [Choose where update jobs run](setup-updates.md#choose-where-update-jobs-run).
`bun run platform:setup-updates --workers local --yes` prepares and tests both installations
before enabling them; `--workers hosted --yes` clears their prepared-pool routing. The details below
explain the underlying routing for operators with custom installations.

GitHub-hosted runners remain the default. Updates can run on your own computers using the
[prepared-image worker manager](ci-workers.md). Use separate installations for verification and
publication, each with its own state directory, pool ID, builder, images and registration.
Do not reuse an ordinary CI installation or the retired Compose workers.

Remain in the reviewed application checkout for setup and all commands below. Run setup twice
with different `STARTER_WORKERS_HOME` directories:

```sh
STARTER_WORKERS_HOME="$HOME/.local/share/starter-update-verify" bun run ci:workers:setup --update-role verify --update-workflow .github/workflows/update-platform.yml
STARTER_WORKERS_HOME="$HOME/.local/share/starter-update-deliver" bun run ci:workers:setup --update-role deliver --update-workflow .github/workflows/update-platform.yml
```

Use your actual **caller** workflow filename, not the reusable `platform-update.yml`. Keep the
manager credential on the host as described in the worker guide. Use each installation's own
`starter-workers` command inside its state directory; the convenience command in PATH points
to the most recently installed one. Verification can run `check --install`; delivery accepts
`check` only and never runs app installation or CI. Do not use ordinary `enable` or
`check --github` for updater installations. The guided setup runs the dedicated worker diagnostic and inspects exact
source/run/attempt and image evidence. Then run the reviewed updater caller to check actual
delivery credentials and PR creation. Custom caller filenames require manual operator acceptance.

Use the absolute wrapper for each installation; these commands retain the app checkout as cwd:

```sh
"$HOME/.local/share/starter-update-verify/starter-workers" check --install
"$HOME/.local/share/starter-update-deliver/starter-workers" check
"$HOME/.local/share/starter-update-verify/starter-workers" status
"$HOME/.local/share/starter-update-deliver/starter-workers" status
```

Guided setup configures these automatically after its successful diagnostic. For custom
installations, configure them only after operator acceptance in
**Settings → Secrets and variables → Actions**:

- `PLATFORM_UPDATE_RUNNER`: the verification installation's **pool ID** (discovery and verification).
- `PLATFORM_UPDATE_DELIVERY_RUNNER`: the separate delivery installation's **pool ID**.

The workflow adds exact source, run, attempt and job labels. Labels alone do not authorize work:
the installed manager checks the configured caller or the manual
`platform-update-workers-check.yml` diagnostic, event, job and source against authenticated
GitHub metadata; the root-owned start hook checks repository ID/name, source, run, attempt,
event, ref and job again. Private updater pools accept only default-branch schedules or manual
runs. Public pools require an explicitly reviewed manual branch and never accept schedules or
fork jobs. Ordinary CI pools cannot accept updater jobs, and neither ordinary CI setting opts
workers into updater credentials. Keep reviewed caller and reusable workflows in the trusted
repository; updating their source requires normal review.

Publication launches only its independently prepared immutable tools image. It never builds an
app dependency seed, runs app scripts or shares writable caches with verification/ordinary CI.
The job still uses only pinned actions, inline publisher code and Git with hooks disabled.
Removing or clearing either selector uses `PLATFORM_CI_AUX_RUNNER` or legacy
`PLATFORM_CI_RUNNER` when set. With neither, it uses `ubuntu-latest` only when no other local
runner variable or explicit `PLATFORM_CI_LOCAL_ONLY=true` guard remains. Otherwise it requests
an unmatched local label. Cancel and restart
already queued runs, which retain their old labels. Then stop each unused installation explicitly:

```sh
"$HOME/.local/share/starter-update-verify/starter-workers" service stop
"$HOME/.local/share/starter-update-deliver/starter-workers" service stop
```

Revoke each installation's dedicated manager credential when retiring it.

Preparation requires an exact Bun package-manager version and consistent Playwright declarations
across all app manifests, including delivery's tool-profile preparation. If your workspaces
declare different Playwright versions, reconcile them through your normal dependency-update
process before preparing these workers. Preparation stops before Docker builds when these
requirements are not met.

The initial checkout's frozen offline installation proves only that checkout. Upgrade-target
codemod dependencies and app dependencies are installed separately in the disposable read-only
verification worker, with public-network access through its filtered proxy. Target browser builds
go into private job storage; no sudo or shared writable browser cache is required. The upgrade
launcher checks the target Node/Bun requirements independently. An incompatible target runtime
or missing system browser dependency fails verification and retains evidence for operator work;
it is never counted as a successful offline seed or automatic major upgrade. Review/update the
prepared tool profile before retrying such a target. Draft gates, manual majors and auto-merge
false remain the defaults.
