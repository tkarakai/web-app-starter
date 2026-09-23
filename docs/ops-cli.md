# Ops CLI

The ops CLI joins GitHub workflow runs, CI statuses, artifacts and deployment records with the deployments currently serving Vercel domains. It also dispatches staging, production and rollback workflows and follows their progress.

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

When the config file is missing or has invalid/incomplete local settings, any interactive command except `help` and `setup` first explains the issues and offers guided setup or repair before contacting either provider. Accepting runs setup and then resumes the original command; declining continues without setup. Cancelling setup before saving stops the original command. Complete configuration files do not trigger a prompt. Repair copies valid recognized fields into a draft and offers them as defaults, including intentional skips. Invalid fields are re-entered or selected. Explicit “track all domains” is saved as `"domain": null`; an omitted hostname is an unresolved setup choice. Remote project access and domain aliases are checked during the wizard; authentication/provider failures are reported, not treated as permission to erase settings. If JSON cannot be parsed, setup explains that it must rebuild the file rather than guessing its contents. The original remains unchanged until the operator reviews and saves; concurrent edits are detected before replacement. Credential fields are never copied into a repaired config. JSON and piped commands never prompt or launch setup. Ordinary setup instructions and prompts use stdout; errors use stderr. `auth status`, `teams`, and `projects` support `--json` and work independently of the other provider's authentication. `setup` and `auth login` require a terminal; with `--json` or redirected input they return `INTERACTIVE_REQUIRED` with commands for a human to run. An error from one provider does not hide the other's auth status. CLI subprocess failures retain diagnostics; HTTP status/request IDs are retained when the provider CLI exposes them. CLI calls have a 30-second process timeout; Vercel may perform its own retries within that window.

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
bun run ops
bun run ops status --env staging --watch
bun run ops runs --active
bun run ops runs --active --watch
bun run ops watch 123456789
bun run ops logs 123456789
bun run ops history --env production --since 2026-09-01
bun run ops builds --app web
bun run ops candidates --to production
bun run ops inspect FULL_SHA --to production
bun run ops diff production FULL_SHA
```

`status` shows current domain targets, up to five active GitHub runs, and the latest recorded backend deployment outcomes. `runs --active` includes queued, waiting, pending, requested and in-progress workflows, with current jobs/steps. GitHub downloadable job logs are available after completion; `logs` fetches failed-job logs through `gh`. While a run is active, use its step status or the GitHub URL.

Tables shorten SHAs for readability. `--json` retains full SHAs, provider IDs, timestamps, URLs, job steps and evidence. Timestamps are UTC. Watches refresh every ten seconds by default, with `--interval` and `--timeout` overrides. Ctrl-C stops watching; it does not cancel GitHub work.

`history` also includes timestamped deployment tags, so older releases remain visible before the new per-app records exist. Tags describe what a workflow reported and are not proof of per-app health.

`--limit` bounds the history window before local app/date filtering. GitHub artifacts and ops records are separate bounded catalogs, so absence of a correlation is **unknown**, not proof that nothing was built. Candidate artifact summaries search the newest 1,000 artifacts and staging records; `inspect` performs exact artifact-name lookups. An unchanged app can legitimately have no build record at a newer SHA. Larger history windows use API pagination. No persistent cache substitutes stale data on provider failures.

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
bun run ops deploy FULL_SHA --to production --yes --watch
```

Manual staging dispatch tests the selected source SHA and forces all apps to resolve/deploy, ensuring an explicit staging trial of the release. Push-triggered staging remains selective. Source checkout and workflow code are distinct: build/deploy actions come from the workflow commit even when deploying older application source.

Production dispatch requires an exact staging tag and successful `ci/gate-passed`. These checks are repeated by the workflow. `inspect` uses recorded target-environment input hashes for the selected commit to report artifact reuse and expiry. Without that evidence it reports `resolve-at-deploy`, even if another environment has an artifact for the app. Reuse depends on matching build-input hashes, not a per-app operator setting; the workflow recomputes those hashes using current target configuration. Missing/expired artifacts may be rebuilt. Landing resolves a separate production artifact. Availability does not mean an attestation has been cryptographically verified by this CLI.

A successful dispatch response is acceptance, not deployment success. Every CLI dispatch has a unique `requestId` embedded in the workflow run title. `--watch` uses this exact ID, avoiding accidental attachment to another operator's run. If connection loss makes acceptance uncertain, the error includes the request ID and workflow URL. Check for that run before retrying: write requests are never automatically retried.

Rollback uses the existing rebuild/reuse-and-redeploy workflow, including backend functions and migrations; it does not restore database contents:

```sh
bun run ops rollback PREVIOUS_FULL_SHA --to staging --dry-run
bun run ops rollback PREVIOUS_FULL_SHA --to staging --yes --watch
```

Rollback requires an exact prior deployment tag for the chosen environment. The workflow now fails if that evidence cannot be checked. Before a production rollback, inspect the source/migrations and compatibility with current data.

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

Agents must check the process exit status and `ok`/`partial`; `ok: true` means the query succeeded, not that every deployment it describes succeeded. For example, a history query can successfully return failed deployments.

| Exit | Meaning |
|---|---|
| 0 | Command succeeded; a watched workflow finished successfully |
| 1 | Provider, network, authentication, or unexpected failure |
| 2 | Invalid input/configuration, missing explicit `--yes`, or failed deployment gate |
| 3 | Partial results; project mappings are missing or some providers/resources or comparison bases could not be read |
| 4 | Watched workflow completed unsuccessfully |
| 5 | Watch timed out; the workflow may still be running |
| 130 | Interrupted; remote work continues |

Read requests have a 30-second timeout and at most two retries for transient network/server/rate-limit failures. Long rate-limit waits are reported instead of blocking indefinitely. HTTP errors retain provider, endpoint, status and request IDs where available. Unknown options and inapplicable flags fail explicitly. API errors never turn into empty successful inventories or assumed artifact cache misses.

## Records and evidence

The workflows persist one GitHub deployment record per app and run attempt, using task `ops-record`. Payloads include selected SHA, actual build SHA when known, input hash, artifact ID/name, tarball checksum when verified, source build run, reuse status, deployment outcome, health suite outcome, actor and deployment URL. These records do not expire with the 90-day build artifacts, although repository administrators can delete them.

The final record job runs after failures as well as successes and tries to record every app. Any persistence failure is logged and fails that job. A force-cancelled workflow or GitHub outage can still leave missing records; workflow history remains visible independently. `unchanged` is distinct from `skipped`, failed deployment and failed build. Aggregate smoke-test results are labeled as recorded suite outcomes, not per-app live probes. Convex evidence comes from workflow records, not a live backend version API.

Vercel deployments carry explicit ops metadata linking their selected source, original build, artifact hash and GitHub run/attempt. Current serving state comes from domain aliases, not whichever deployment was created most recently. Legacy deployments without this metadata retain unknown identity. Artifact archive digests returned by GitHub differ from the inner tarball checksum; the CLI keeps those separate. If an artifact name is rebuilt with a new ID, old provenance is not attributed to the replacement bytes.

## Local verification

```sh
bun run test:ops
bun run typecheck:ops
bun run --cwd packages/ops lint
```

The tests include mocked provider errors/pagination, subprocess CLI integration, dispatch-to-watch completion, partial results, timeout/failure exits, and audit recording after partial deployment. They do not deploy infrastructure. Shared CI runs this suite when the checked-out source contains the CLI. Real end-to-end deployment testing additionally requires the new workflows on GitHub and correctly configured GitHub environments and provider secrets.
