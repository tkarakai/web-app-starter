# Set up automatic platform updates

Start with the [PR-first repository workflow](repository-workflow.md): draft adoption PR,
live enforcement inspection, resumable exact check discovery and owner-consented setup.
Protection, check names and merge authority must be verified before maintenance auto-merge;
workflow presence and deployment verification do not prevent direct pushes.

Adoption offers three choices. `bun run adopt --updates app --yes` explicitly authorises the
App setup described below; `--updates fallback --yes` authorises the limited token setup.
Interactive adoption explains the scope and asks before remote changes. Non-interactive adoption
without an explicit choice records **deferred**; it never treats `--yes` alone as permission to
configure update delivery. Local app development and manual upgrades work offline.

| Choice | What it does |
| --- | --- |
| App (recommended) | Repository-only App creates PRs, triggers their CI and can deliver workflow changes. GitHub asks you to authorise registration/installation. You still review and merge. |
| Built-in token | Enables Actions PR creation without an App. Workflow changes need a manual upgrade; PR CI may require owner approval. |
| Deferred | Pauses scheduled delivery until owner setup. Manual upgrades remain available. |

## Inspect first, including in existing apps

```sh
bun run platform:setup-updates --check
bun run platform:setup-updates --check --json
```

These commands are read-only. They show recorded intent separately from observed variables,
secret **presence**, PR-creation capability, local caller and readiness (`ready`, `blocked`,
`unknown`, `deferred`). An inaccessible API means **unknown**, not success. Status works without
administration access; some settings require an administrator to inspect. No stored key is read,
and its presence cannot prove validity. Only authenticated installation/token validation proves
that; even a previously validated App can later be revoked. Check its next workflow token-mint
result. Git author `platform-updater[bot]` is metadata, not the API identity.

`.github/update-delivery.json` is an **app-owned, non-secret** record preserved on platform
replacement. It holds mode, repository/source, caller/settings pointers, setup status, last check,
public App identity when known, and pending owner actions. Worker intent and evidence are described
[below](#check-readiness-or-return-to-github-hosted-workers). Schedule, policy and auto-merge remain
in the caller rather than being duplicated in the record. `vars.PLATFORM_SOURCE_REPOSITORY` in
that caller is the live source override; the record's source is the default source. Commit the
record and caller, and keep the app's `AGENTS.md` pointing to them. A check never rewrites intent.

## Owner setup and consent

```sh
bun run platform:setup-updates --app --yes       # recommended guided setup
bun run platform:setup-updates --fallback --yes  # limited built-in token
bun run platform:setup-updates --defer --yes     # pause delivery; preserve credentials
```

Without `--yes`, a selected mode only records pending intent and prepares a guarded caller
locally. It prints the scope and resumable owner command. It does not change remote permissions
or create an App. `--repo owner/repo` selects the app explicitly, including offline. Complete remote
setup with the project's Node version and authenticated `gh` with the required repository access.
Do not give the scheduled updater administration access to configure itself.

The helper adds a missing caller and preserves existing schedule, policy, auto-merge and inputs.
For a standard older caller it adds only this delivery gate:

```yaml
if: ${{ vars.PLATFORM_UPDATE_DELIVERY == 'app' || vars.PLATFORM_UPDATE_DELIVERY == 'fallback' || (github.event_name == 'workflow_dispatch' && vars.PLATFORM_UPDATER_APP_ID != '') }}
```

Scheduled delivery is paused until owner setup sets `PLATFORM_UPDATE_DELIVERY=app` or `fallback`.
A manual dispatch with an existing App ID can validate its credentials while scheduling stays
paused. Existing custom job conditions are not overwritten: the helper records an owner action
and refuses activation until you incorporate the gate with your existing condition. Commit the
local guard to make it effective on GitHub. For an unguarded existing caller, disable **Update
platform** in Actions while repairing it; recording deferred intent alone cannot disable an old
remote caller. `--defer --yes` sets the remote mode to `deferred` without deleting credentials.

Remote failures (offline, missing administration access, organisation/enterprise policy, partial
credentials) record pending owner work and return exit 2. Adoption reports this without blocking
unrelated local development. Incomplete consented setup attempts to pause the delivery-mode gate; credentials and caller
customisations are preserved. If policy/access also prevents pausing, the summary explicitly
asks the owner to disable the workflow while repairing it. Offline deferred intent does not
assert that a remote schedule is paused. Check the record and settings before retrying.

## Dedicated updater App

`--app --yes` reuses the browser manifest helper. `--no-open` prints its **loopback** URL; open it
on the same machine or use an SSH tunnel for headless handoff. Leave the terminal running.

1. **Register.** GitHub asks you to confirm the App. The private manifest requests only Contents,
   Pull requests, Workflows and Issues write, with no webhook subscriptions.
2. **Install.** Choose **Only select repositories**, then this app repository only. Organisation
   approval may be required. The helper verifies actual installation scope and exact permissions,
   authenticates with the private key and mints/revokes a short-lived verification token.
   Named maintenance auto-merge additionally needs owner-approved Administration, Checks and
   Variables read-only for live inspection. The manifest does not request these; setup never
   expands an installation automatically. See [maintenance authority](repository-workflow.md#maintenance-and-credentials).
3. **Save.** ID goes to `PLATFORM_UPDATER_APP_ID`; key goes via `gh` stdin and GitHub's encrypted
   transport to `PLATFORM_UPDATER_PRIVATE_KEY`. The key never goes to a file, page, log or chat.
4. **Activate.** Successful guided validation saves the public identity and enables the caller's
   mode variable. Commit the caller/record, then manually run **Actions → Update platform**.
   Keep auto-merge off unless you deliberately change the caller.

Existing complete credentials are preserved, with validity reported unknown; setup does not
create another App or enable a paused schedule from presence alone. Run **Update platform**
manually, confirm token minting succeeds, then deliberately activate that existing identity:

```sh
gh variable set PLATFORM_UPDATE_DELIVERY --repo owner/repo --body app
bun run platform:setup-updates --app --yes
```

The second command records the existing live mode. Partial credentials require manual repair.
A registered App's public ID/URL are saved before secret storage, so interrupted setup can be
handed off safely. The session expires after 55 minutes. Inspect the saved App URL/settings,
finish installation and save the key manually through the encrypted secret command if needed;
never blindly register another App. If secret storage succeeded but ID storage failed, set the
saved public ID with `gh variable set PLATFORM_UPDATER_APP_ID --repo owner/repo --body ID`.
`--replace --yes` deliberately registers a replacement; it does not delete the previous App.

## Built-in token fallback

`--fallback --yes` explicitly consents to the repository-wide **Allow GitHub Actions to create
and approve pull requests** capability. This is not exclusive to the updater. The updater
**creates** PRs; it does not submit a review approval, change auto-merge intent, or deploy.
The helper reads existing workflow permissions, enables only that capability using GitHub's API,
preserves `default_workflow_permissions` (including restricted `read`), and reads back the result
before enabling delivery. Higher-level policy or insufficient access leaves setup pending with
`https://github.com/owner/repo/settings/actions` and an administrator action.

An existing App ID prevents switching implicitly. Remove that variable explicitly before
selecting fallback; setup preserves the private-key secret. Built-in-token PRs can create approval-required workflow runs on
`opened`, `synchronize` and `reopened`. An owner with write access can select **Approve workflows
to run** in the PR banner; inspect every required result before merging. Other token-triggered
events (such as labels) do not start CI. Approval of a workflow run, approval of a PR review, and
permission for Actions to create PRs are separate things. Enabling the PR switch does not remove
CI approval requirements or grant workflow-file delivery. See [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

See [update delivery](update-delivery.md) for truthful verification and existing-branch recovery.

## Choose where update jobs run

Use `bun run platform:setup-updates` for the guided choices, during adoption or later.
First choose whether to configure scheduled update PRs or defer them. Then choose where the
jobs run. Existing credentials, schedule, policy, auto-merge and worker routing are shown or
preserved unless you explicitly select a change. A fresh app uses **GitHub-hosted workers**.
“Automatic” means GitHub starts the configured weekday checks and may open an update PR;
it does not mean a local service upgrades your default branch or deploys your app.

| Worker choice | What you operate | What setup changes |
| --- | --- | --- |
| GitHub-hosted (default) | Nothing on your computer | Clears the two updater pool variables. Jobs then use the repository's auxiliary/legacy runner if set; otherwise they use hosted runners only when no other local route or explicit local-only guard remains. |
| Local Docker | A macOS or Linux host with Docker and two running worker services | Prepares images, tests both installations through GitHub, then sets both updater pool variables. |
| Preserve | Keep the existing arrangement | Leaves routing untouched, including custom or partly local setups. Unreadable settings remain unknown. |

```sh
bun run platform:setup-updates --check
bun run platform:setup-updates --workers local --yes
bun run platform:setup-updates --workers hosted --yes
```

`--workers` on its own changes only the worker choice, preserving delivery credentials and the
delivery-mode gate. Combine it with `--app`, `--fallback` or `--defer` to configure both choices.
Without `--yes`, it records pending intent only. Deferred delivery records a requested worker
choice for later; it does not install services. Adoption accepts `--update-workers hosted|local`;
omitting it preserves existing routing (GitHub-hosted in a new app with no local runner variables).

### Set up local workers

Use a **private** app repository. Commit and push adoption/setup files first, including the
platform-owned `.github/workflows/platform-update-workers-check.yml`, and check out the app's
default-branch tip. Setup tests committed source; only `.github/update-delivery.json` may be dirty.
On your Docker host, use the project's Node/Bun versions and authenticated `gh` with repository
administration access. See [local worker prerequisites](ci-workers.md) for Docker resources,
supported host configuration and ongoing operation.

`--workers local --yes` prepares two separate installations under
`~/.local/share/starter-updates/<repository-name-hash>/verify` and `deliver` and prints their absolute paths.
For each new installation, it asks at a **hidden terminal prompt** for a dedicated fine-grained
manager token selecting only this repository: **Administration: write** and **Actions, Contents,
Pull requests: read**. These manager credentials stay on the host, separate from the updater App
key stored in GitHub. Do not paste them in chat or command arguments. Keep both services and Docker
available whenever scheduled updates should run.

The verification installation runs release discovery and dependency/app checks. The delivery
installation uses a separate tools-only image to publish the prepared result. Each job runs in
a fresh disposable container. Setup reuses the existing worker manager and prepared-image system.
It does not reuse an ordinary CI installation for privileged update delivery.

Setup runs local checks, dispatches **Test platform update workers**, watches its three jobs, and
confirms the exact source, images, runtime settings, pools and run attempt. Only then does it set
`PLATFORM_UPDATE_RUNNER` and `PLATFORM_UPDATE_DELIVERY_RUNNER`. This diagnostic checks worker
routing, isolation and prepared dependencies; it does not test App authentication, create an
update PR, merge or deploy. Finish credential setup separately if pending, then manually run
**Update platform** to validate delivery.

If the test fails, is cancelled, remains queued, or setup is interrupted, previous routing stays
in place. Fix the host/service issue and repeat setup. For a stopped, incomplete installation,
setup validates the completion receipt against the installed command and service files, then
resumes installation when validation fails, preserving its credential and pool. It does not
replace an installation while its manager is running. If the same local proofs are still current,
resume the printed `--workers local --worker-run RUN_ID --yes` command after the test passes.
Proofs expire after 24 hours; source, image or runtime changes require a new test. A partial GitHub
settings failure attempts to restore both previous values; if restoration cannot be confirmed,
setup explicitly asks you to inspect both repository variables.

Already have the two updater installations? Select both explicitly:

```sh
bun run platform:setup-updates --workers local --yes \
  --verify-home /absolute/path/to/verification-installation \
  --deliver-home /absolute/path/to/delivery-installation
```

Printed recovery commands retain the supplied absolute home flags and diagnostic run ID when
known; use that command when resuming. The helper refuses a wrong repository, wrong role, shared pool,
paused service or public diagnostic installation. An older installed manager needs the normal
[pause, drain and update procedure](ci-workers.md); setup explains this without replacing an
installation behind a running service. Always use each installation's **absolute** `starter-workers`
command: the convenience command in `~/.local/bin` points to only the most recently installed one.

### Check readiness or return to GitHub-hosted workers

`--check` and `--check --json` show the recorded choice, observed routing/pools, worker readiness,
unknown host availability, last successful GitHub worker test (run, source, proof and check time)
and remaining actions, separately from credentials. The record retains the last successful test
through pending setup, offline retries, reconfiguration and a return to hosted routing. This is
historical evidence; it does not prove that your host is awake now. Inspect both service statuses.
Existing manually configured routing is preserved and reported unvalidated until tested.

`--workers hosted --yes` clears only the two updater routing variables. It preserves ordinary CI
worker routing, `PLATFORM_CI_AUX_RUNNER`, `PLATFORM_CI_LOCAL_ONLY`, credentials, schedule and
auto-merge. With [all-local routing](ci-workers.md#keep-every-actions-job-local), this choice
returns updater jobs to the auxiliary runner. If another local selector remains without an
auxiliary runner, jobs request the unmatched local-only label. Existing queued jobs retain their old labels:
finish or cancel them before stopping unused services. For each updater installation, run its
absolute `starter-workers pause --drain`, then `starter-workers service stop`. Setup does not stop
or uninstall services on your behalf. The update record contains non-secret worker intent and
test evidence; commit it with the other app setup files.
