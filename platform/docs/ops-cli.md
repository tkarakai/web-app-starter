# Ops CLI

The ops CLI joins GitHub workflow runs, CI statuses, artifacts and deployment records with the deployments currently serving Vercel domains. It also dispatches staging, production and rollback workflows and follows their progress.

## Guided operations console

Run **`bun run ops` with no arguments in a terminal** to open a persistent guided console. `bun run ops console --config PATH` opens it explicitly with another configuration. Arrow keys move the selection, Enter selects, and Escape goes back; visible Back and Home choices are available throughout. At Home, Escape asks whether to exit, with **Keep using ops** selected by default. Escape again cancels exit and restores the previous home selection, so repeated Escape presses cannot close the console. Ctrl-C or the explicit Quit choice closes the local console without cancelling remote work. Blank text input cancels a selection/confirmation.

The console uses a paper-roll layout: a selected action stays with its resulting output, and a horizontal line closes that output before the next choices. Named sections remain in scrollback. Loading headers animate until results arrive; live monitoring updates only the open section. Follow-up questions stay with the selected action, without inserting a separator between the choice and its output. The reusable terminal library is [`@repo/paper-roll`](../../packages/paper-roll/README.md); ops owns the workflows, confirmations and provider calls.

After confirming a deployment or rollback, the console automatically opens **Watching**. No menu choice is required to continue: it locates the accepted request, follows the pinned workflow attempt, then checks intended serving state. The screen shows phase counts, active/failed jobs (not just the first jobs returned), and its last update time. **Enter** opens optional deployment actions; **Return to live watch** or Escape from those actions returns to watching. Escape from the watch screen leaves local monitoring; remote work continues. Completion and failure automatically produce an explicit result screen. **Watch again** retries observation only, never dispatch. The Home **Watch** entry reconnects to the saved operation. A resume command is available under actions for use in another terminal; the console never selects it automatically.

The home menu remains usable while its read-only summary loads. It offers:

- **Monitor environments:** inspect all environments or one, open an app, watch live observations, and investigate recent operations. Current serving state is distinct from the latest recorded attempt.
- **Investigate a deployment problem:** select a run or enter its ID; inspect jobs, failed stages, recorded effects, current serving state, failed-job logs, and suggested next steps. When a latest deployment failed, the home menu offers direct investigation of that run and attempt. Guidance never automatically retries or rolls back.
- **Deploy to production / staging:** select a candidate or enter an explicit commit, review changes and scope, inspect staging evidence, then continue to a separate confirmation. The default confirmation choice goes back. Production and every rollback also require typing the environment name.
- **Roll back an environment:** browse verified prior deployment tags and inspect a target. Prior success does not establish compatibility with today's data. Rollback deploys backend code and runs migrations; it does not restore data.
- **Explore deployment history:** retain environment/app/time filters while opening run details and exporting observations. The screen states its record limit; **Look further back** expands it up to 1,000 records per source. Routine history limits are not home-screen warnings; provider failures still appear as incomplete information.
- **Setup and access:** inspect account access and configuration, or run the existing setup/repair wizard, then return to the calling journey.

After a confirmed dispatch the console stays with the operation through workflow completion and serving verification. Operators can leave that screen, investigate, or return Home. A local session stores the most recently selected guided dispatch in `<config-path>.session.json` (default `ops.config.json.session.json`). It contains only repository, environment, full SHA, workflow/ref, request ID, run/attempt when known, and acceptance/time information. The request identity is saved **before** the write so a disconnected or ambiguous response can be investigated on reopening. Resume only reads the existing request/run; it never redispatches. A changed repository configuration or a newer run attempt requires explicit investigation. Multiple consoles share the most recent saved session; older operations remain accessible by run ID.

Evidence screens offer the equivalent command and an export. Exports are timestamped JSON observations in the git-ignored `.ops-reports/` directory, with coverage, links, errors, and observation time. Session/export files are written with private filesystem permissions. They contain operational metadata; share them deliberately. URL query strings, fragments and userinfo are removed from reports. Historical records and present-day serving observations remain separate.

Explicit commands remain noninteractive except for applicable setup repair. Bare `ops` with redirected input/output, and `ops --json`, retain the status-query behavior. `ops console --json` or piped `ops console` fails with `INTERACTIVE_REQUIRED`. No hidden interactive approval is inferred by scripts.

## Install and configure

Install [GitHub CLI](https://cli.github.com) (`gh`) and a current [Vercel CLI](https://vercel.com/docs/cli) (`npm install -g vercel@latest`). From the repository root:

```sh
bun install --frozen-lockfile
bun run ops setup
```

Each project question names the app and environment, for example: “Which Vercel project hosts the 'web' app in STAGING?” Use ↑/↓ and Enter to choose a team, project or domain; Esc cancels without saving. Selecting a project assigns it to that app/environment, and Skip leaves that specific target untracked. The domain menu lists the project’s actual aliases so you can choose the hostname people use.

The wizard checks both accounts, offers the official browser/device login if a session is missing or expired, verifies repository access, lists your Vercel teams by name, and lets you map projects to each app/environment. It previews the nonsecret config before saving. Existing accessible mappings are offered as defaults; switching teams requires choosing mappings again. Skipped targets are saved as `null` and displayed separately as “Not tracked (skipped in setup)”; they do not cause configuration errors in status or doctor. Setup prints the absolute file path after a successful save. The file is git-ignored and may be hidden from change lists. Use `--config PATH` for another file or `--team ID_OR_SLUG` to preselect a team.

You can also authenticate and inspect access separately:

```sh
bun run ops auth login github   # delegates to gh auth login --hostname github.com --web
bun run ops auth login vercel   # delegates to vercel login
bun run ops auth status         # account, credential source, status for both services
bun run ops teams               # team names, slugs and IDs; no repository config needed
bun run ops projects --team web-app-starter  # accepts a team slug or ID
bun run ops doctor
```

GitHub uses `GH_TOKEN`, then `GITHUB_TOKEN`, then `gh auth token --hostname github.com`. Vercel uses `VERCEL_TOKEN` if supplied; otherwise it delegates authenticated reads to [`vercel api`](https://vercel.com/docs/cli/api), letting the official CLI manage its login session and refresh. Ops never reads Vercel's private credential files or copies its session token. Vercel currently labels this API command beta; an older CLI without the required flags gets an explicit upgrade instruction.

No credentials belong in `ops.config.json`; token/password/secret fields are rejected. The provider CLIs still store/manage credentials according to their own storage behavior. For headless CI, supply environment tokens from your secret manager. Environment credentials take precedence; a failed override does **not** silently fall back to another account. Unset an override before switching to CLI login. Read access needs repository contents, Actions and deployments access; dispatch additionally needs Actions write access. The workflows use their own existing GitHub/Vercel/Convex secrets.

When the config file is missing or has invalid/incomplete local settings, interactive commands that need project configuration first explain the issues and offers guided setup or repair before contacting either provider. Accepting runs setup and then resumes the original command; declining continues without setup. Cancelling setup before saving stops the original command. Complete configuration files do not trigger a prompt. GitHub-only investigation commands and account/team/project discovery do not offer unrelated Vercel setup; the console offers setup as an explicit journey. Repair copies valid recognized fields into a draft and offers them as defaults, including intentional skips. Invalid fields are re-entered or selected. Explicit “track all domains” is saved as `"domain": null`; an omitted hostname is an unresolved setup choice. Remote project access and domain aliases are checked during the wizard; authentication/provider failures are reported, not treated as permission to erase settings. If JSON cannot be parsed, setup explains that it must rebuild the file rather than guessing its contents. The original remains unchanged until the operator reviews and saves; concurrent edits are detected before replacement. Credential fields are never copied into a repaired config. JSON and piped commands never prompt or launch setup. Ordinary setup instructions and prompts use stdout; errors use stderr. `auth status`, `teams`, and `projects` support `--json` and work independently of the other provider's authentication. `setup` and `auth login` require a terminal; with `--json` or redirected input they return `INTERACTIVE_REQUIRED` with commands for a human to run. An error from one provider does not hide the other's auth status. CLI subprocess failures retain diagnostics; HTTP status/request IDs are retained when the provider CLI exposes them. CLI calls have a 30-second process timeout; Vercel may perform its own retries within that window.

To repair a file directly, run `bun run ops setup --config PATH` (or omit `--config` for `ops.config.json`). You do not need to delete it first. Invalid-file errors in noninteractive commands include the repair command.

For manual configuration, copy `ops.config.example.json` to the git-ignored `ops.config.json` and edit:

- `repository`: GitHub `owner/repository`.
- `workflowRef`: branch containing the deployment workflows, normally `main`.
- `teamId`: nonsecret Vercel team ID shown by `ops teams`, used to scope project, alias and deployment queries. Ops pins the CLI `--scope` explicitly so its last-selected team cannot override this ID. A team is required when using the CLI session; current Vercel CLI does not support personal-account scopes. Missing team configuration gets setup instructions rather than inheriting the CLI’s last-selected team. This does not change the GitHub workflow's deployment destination, which uses its own secrets and project IDs.
- `apps.<app>.projects.<environment>.id`: Vercel project ID shown by `ops projects --team TEAM_ID`.
- A `null` environment mapping, for example `"production": null`, means intentionally untracked. An absent environment key means configuration is missing. Skipping affects CLI visibility only; it does not disable deployments or change workflow destinations.
- `domain`: canonical hostname, without `https://`, or `null` to explicitly track all aliases. Without a hostname, all aliases must agree on a deployment or status reports `domains-diverge`. An omitted field in older files also checks all aliases, but interactive commands offer repair so you can make that choice explicit.

Without a config file, GitHub commands infer the repository using `gh repo view` (or `--repo owner/repo`). `status` reports a single `CONFIG_MISSING` error with setup instructions and the missing app/environment mappings, rather than creating deployment rows labeled `unconfigured`. Configured targets and GitHub results remain visible; JSON reports `ok: false`, `partial: true`, and missing mappings in `errors[].details.missingProjectMappings`, with exit code 3. Missing mappings outside an explicit `--app`/`--env` selection do not fail that query. `doctor` also treats missing mappings as an error. GitHub-only commands still work without Vercel mappings.

The CLI does not guess environment identities from project names or Vercel's `production` target: both staging and production use that target in this repository.

## Inspect operations

```sh
bun run ops                            # guided console in a terminal
bun run ops status --env staging --watch
bun run ops runs --active
bun run ops runs --active --watch
bun run ops watch 123456789
bun run ops logs 123456789 --attempt 1
bun run ops diagnose 123456789 --attempt 1
bun run ops verify --run 123456789 --env production
bun run ops watch 123456789 --attempt 1 --until serving
bun run ops watch --request REQUEST_ID --until serving
bun run ops history --env production --since 2026-09-01
bun run ops builds --app web
bun run ops candidates --to staging
bun run ops candidates --to production
bun run ops inspect FULL_SHA --to production
bun run ops diff production FULL_SHA
```

`candidates --to staging` lists recent commits from the repository's default branch that produced at least one currently available app package, newest first, with one entry per full SHA, the commit message, and the last reported overall `ci/gate-passed` status. It does not use workflow-run head SHAs or individual workflow conclusions as release candidates. The guided staging picker uses the same list; enter an explicit SHA to review a commit from another branch. Staging reruns CI before deploying. Without `--to`, candidates still defaults to production and uses successful staging tags.

The default staging list requires positive evidence of artifact production: a recorded new build for the selected SHA, or a deployable package uploaded by its staging push run. A successful CI/build/deployment job, artifact reuse, test reports, or missing records does not qualify. **Show all recent commits** (or `candidates --to staging --all-commits`) reveals reuse-only, unknown, expired, unchanged and backend-only commits for review. Entering an explicit SHA also remains available. Unknown evidence remains unknown; hiding it does not assert that nothing was built. Production promotion and rollback retain their own candidate rules.

Only the current naming convention **`<app>-<16 lowercase hexadecimal input-hash characters>`** qualifies as a deployable package. Legacy `<app>-<40-character commit SHA>` and environment-prefixed names are excluded from candidate and build inventories: the current deployment workflow does not resolve those names.

Candidate labels name apps with available **new**, **reused**, or other **existing** artifacts; expired artifacts are identified separately. Independently of build records, **artifacts: web/admin/landing** identifies available app packages uploaded by a staging **push** run for that commit. The CLI checks the source run's event, workflow path and SHA, excludes test reports and expired artifacts, and links each package to its run. Manually dispatched runs cannot use this upload association: their workflow head SHA may differ from the selected deployment SHA. If the repository-wide catalog cannot identify a package, the CLI queries that commit’s staging push runs and their artifact lists directly. Exact app package names identify web/admin/landing; test reports never count. When those runs have finished and their artifact lists are complete, no matching packages is reported as **no current-format app artifacts**. **Artifact availability unknown** is reserved for incomplete, failed or still-running observations. These labels describe retained uploads from staging push runs; they do not say that a deployment could not reuse an older package. **Backend deployed** describes source deployment without a frontend artifact. Release review offers **View recorded per-app build results**, including unknown or unchanged outcomes. These labels use deployment records and the current artifact listing; they do not prove the artifacts match current target configuration. The target-specific review also shows whether a previously matching artifact exists, a build is expected, or reuse must be resolved during deployment. The workflow recomputes input hashes, reuses matching artifacts, and builds on a miss. No fresh artifact is required just because a commit is newer.

`status` shows current domain targets, latest recorded app attempts, up to 20 active GitHub runs, recent deployment operations, and the latest recorded backend deployment outcomes. A finished failed attempt remains visible after leaving the active-run list. Activity with an unknown environment is labeled unknown; mixed app SHAs can be expected after selective staging. `runs --active` includes queued, waiting, pending, requested and in-progress workflows, with current jobs/steps. GitHub downloadable job logs are available after completion; `logs` fetches failed-job logs through `gh`. While a run is active, use its step status or the GitHub URL.

Tables shorten SHAs for readability, except candidate SHAs, which remain complete for copying. Source links are printed beneath relevant rows. `--json` retains full SHAs, provider IDs, timestamps, URLs, job steps and evidence. Timestamps are UTC. Watches refresh every ten seconds by default, with `--interval` and `--timeout` overrides. Ctrl-C stops watching; it does not cancel GitHub work.

`history` also includes timestamped deployment tags, so older releases remain visible before the new per-app records exist. Tag targets are resolved (including annotated tags) and must agree with their SHA suffix. Tag annotations link historical runs, including runs outside the recent workflow window. Conflicting tags are excluded with explicit errors. Staging and production get separate history windows. Tags describe what a workflow reported and are not proof of per-app health.

`--limit` bounds each environment/workflow history window before local app/date filtering. Reports include per-source coverage: `complete` (that endpoint/window exhausted), `windowed` (cap reached), `partial` (earlier pages retained after failure), or `unavailable`. A bounded report is not a complete repository audit. Useful results from other sources survive failures; deployment authorization still requires readable, nonconflicting gate evidence. GitHub artifacts and ops records are separate bounded catalogs, so absence of a correlation is **unknown**, not proof that nothing was built. Candidate artifact summaries search the newest 1,000 artifacts and staging records, then use commit-specific staging run/artifact lookups to resolve missing uploads (up to 1,000 runs/artifacts per endpoint, with truncation reported); `inspect` performs exact artifact-name lookups. An unchanged app can legitimately have no build record at a newer SHA. Larger history windows use API pagination. No persistent cache substitutes stale data on provider failures.

## Exercise the complete workflow

First commit and push these changes to a branch available on GitHub. The workflow code must contain the new `git_sha` and `request_id` inputs; the existing workflow on an older `main` will reject them. Use `--ref YOUR_BRANCH` to test workflow code before merging, if your GitHub environment branch policies permit it. Production's branch policy may require merging to `main` first. Do not bypass those policies.

Select an explicit commit SHA and review the staging request:

```sh
bun run ops deploy FULL_SHA --to staging --ref YOUR_BRANCH --dry-run
bun run ops deploy FULL_SHA --to staging --ref YOUR_BRANCH --yes --watch
bun run ops status --env staging
bun run ops history --env staging
bun run ops inspect FULL_SHA --to production
bun run ops diff production FULL_SHA
bun run ops deploy FULL_SHA --to production --dry-run
bun run ops deploy FULL_SHA --to production --yes --watch --until serving
```

Manual staging dispatch tests the selected source SHA and forces all apps to resolve/deploy, ensuring an explicit staging trial of the release. Push-triggered staging remains selective. Source checkout and workflow code are distinct: build/deploy actions come from the workflow commit even when deploying older application source.

Production dispatch requires an exact staging tag and successful `ci/gate-passed`. These checks are repeated by the workflow. `inspect` uses recorded target-environment input hashes for the selected commit to report artifact reuse and expiry. Without that evidence it reports `resolve-at-deploy`, even if another environment has an artifact for the app. Reuse depends on matching build-input hashes, not a per-app operator setting; the workflow recomputes those hashes using current target configuration. Missing/expired artifacts may be rebuilt. Landing resolves a separate production artifact. Deployment requires an explicit artifact source run, selected commit SHA and 16-character input hash. The action always checks the artifact name and manifest app/hash/source/checksum; omitting the expected hash cannot bypass verification. Availability does not mean an attestation has been cryptographically verified by this CLI.

A successful dispatch response is acceptance, not deployment success. Every CLI dispatch has a unique `requestId` embedded in the workflow run title. `--watch` uses this exact ID, avoiding accidental attachment to another operator's run. If connection loss makes acceptance uncertain, the error includes the request ID and workflow URL. Check for that run before retrying: write requests are never automatically retried.

Rollback uses the existing rebuild/reuse-and-redeploy workflow, including backend functions and migrations; it does not restore database contents:

```sh
bun run ops rollback PREVIOUS_FULL_SHA --to staging --dry-run
bun run ops rollback PREVIOUS_FULL_SHA --to staging --yes --watch --until serving
```

Rollback requires an exact prior deployment tag for the chosen environment. The workflow now fails if that evidence cannot be checked. Before a production rollback, inspect the source/migrations and compatibility with current data.

## Diagnosis and serving verification

`diagnose RUN_ID` pins the observed run attempt and joins jobs, failed steps, recorded per-app effects, and current serving state when the environment is known. It distinguishes backend/migration failures, build/artifact resolution, frontend deployment, verification, and evidence recording failures. A record-write failure can follow successful deployment; check effects before retrying. A skipped job or missing record does not establish that nothing changed. `logs RUN_ID --attempt N` reads failed-job logs from the selected attempt.

`inspect SHA --to ENV` includes the release assessment, current serving rows, repository comparisons per app, backend files in those comparisons, active operations, deployment scope and verification criteria. Comparisons are bounded provider evidence; changed backend files do not prove compatibility. Missing monitoring mappings can make this preview partial without changing workflow deployment scope. Production/rollback dispatch rechecks its own required gates, including resolved tag targets. Duplicate project mappings are rejected and app-prefixed test reports are not classified as deployable artifacts.

`verify --run RUN_ID [--env ENV]` performs a single read. `watch RUN_ID --until serving` and `deploy/rollback ... --watch --until serving` continue beyond workflow completion. Ordinary `watch` still ends at workflow completion. A watcher pins the first observed attempt; `--attempt N` pins one explicitly. A newer attempt produces `RUN_SUPERSEDED`, rather than silently following a rerun. `watch --request ID` locates an uncertain/accepted dispatch by its exact correlation marker; absence from a bounded search is not rejection evidence.

**Serving verification means workflow success plus the intended frontend deployments serving the configured domains.** It matches selected source SHA, run, attempt, and deployment URL against the recorded outcomes. Reused build SHAs may legitimately differ. An unchanged staging app is compared with its most recent prior recorded successful deployment; missing baseline evidence remains incomplete. Every workflow app is considered even if the operator skipped monitoring it. Missing mappings, skipped required targets, missing/conflicting records, unknown identities, and unresolved all-domain aliases cannot produce a successful verification. Backend evidence remains workflow-only.

Verification outcomes are `waiting`, `workflow-failed`, `incomplete`, `mismatch`, and `serving`. A watch waits through a serving mismatch until convergence or timeout; incomplete evidence exits explicitly so the operator can repair configuration or investigate. The console can keep refreshing observations and offers diagnosis. No new health probes, observation window, error-rate monitoring, database restoration or automatic rollback is included. Existing workflow checks still contribute to workflow success.

## Machine interface and errors

Every JSON result is a single object:

```json
{
  "schemaVersion": 1,
  "command": "status",
  "ok": false,
  "partial": true,
  "observedAt": "2026-09-23T12:00:00.000Z",
  "data": { "rows": [] },
  "errors": [{ "code": "FORBIDDEN", "message": "...", "hint": "...", "details": {} }],
  "warnings": []
}
```

Watches produce newline-delimited objects using the same envelope. A terminal watch failure emits an error envelope after its final observed state. Successful data remains on stdout; progress, retries and diagnostics go to stderr. `--debug` adds request timings and stack traces. Tokens registered by the CLI and common GitHub token formats are redacted; provider bodies and request headers are not logged wholesale.

Agents must check the process exit status and `ok`/`partial`; `ok: true` means the query succeeded, not that every deployment it describes succeeded. For verification also inspect `data.outcome` and the exit code; readable evidence can still show a mismatch or incomplete verification. For example, a history query can successfully return failed deployments.

| Exit | Meaning |
|---|---|
| 0 | Command succeeded; a watched workflow finished successfully |
| 1 | Provider, network, authentication, or unexpected failure |
| 2 | Invalid input/configuration, missing explicit `--yes`, or failed deployment gate |
| 3 | Partial results or incomplete serving verification; mappings/evidence are missing or sources could not be read |
| 4 | Watched workflow completed unsuccessfully |
| 5 | Watch timed out; the workflow may still be running |
| 6 | Single verification did not establish serving (waiting or mismatch) |
| 130 | Interrupted; remote work continues |

Read requests have a 30-second timeout and at most two retries for transient network/server/rate-limit failures. Long rate-limit waits are reported instead of blocking indefinitely. HTTP errors retain provider, endpoint, status and request IDs where available. Unknown options and inapplicable flags fail explicitly. API errors never turn into empty successful inventories or assumed artifact cache misses.

## Records and evidence

The workflows persist one GitHub deployment record per app and run attempt, using task `ops-record`. Payloads include selected SHA, actual build SHA when known, input hash, artifact ID/name, tarball checksum when verified, source build run, reuse status, deployment outcome, health suite outcome, actor and deployment URL. These records do not expire with the 90-day build artifacts, although repository administrators can delete them.

The final record job runs after failures as well as successes and tries to record every app. Any persistence failure is logged and fails that job. A force-cancelled workflow or GitHub outage can still leave missing records; workflow history remains visible independently. `unchanged` is distinct from `skipped`, failed deployment and failed build. Aggregate smoke-test results are labeled as recorded suite outcomes, not per-app live probes. Convex evidence comes from workflow records, not a live backend version API.

Vercel deployments carry explicit ops metadata linking their selected source, original build, artifact hash and GitHub run/attempt. Current serving state comes from domain aliases, not whichever deployment was created most recently. Missing metadata cannot establish release identity or successful serving verification. Artifact archive digests returned by GitHub differ from the inner tarball checksum; the CLI keeps those separate. If an artifact name is rebuilt with a new ID, old provenance is not attributed to the replacement bytes.

## Local verification

```sh
bun run test:ops
bun run typecheck:ops
bun run --cwd packages/ops lint
```

The tests include scripted console journeys (navigation, confirmation, save-before-write and resume), exact serving identity and unchanged-app baselines, workflow tag-resolution gates, mocked provider errors/pagination, subprocess CLI integration, dispatch-to-watch completion, partial results, timeout/failure exits, and audit recording after partial deployment. They do not deploy infrastructure. Shared CI runs this suite when the checked-out source contains the CLI. Real end-to-end deployment testing additionally requires the new workflows on GitHub and correctly configured GitHub environments and provider secrets.
