# Local CI workers for GitHub Actions

For **scheduled platform updates**, use the [update setup guide](setup-updates.md#choose-where-update-jobs-run):
`bun run platform:setup-updates --workers local --yes` manages two separate updater installations.
The ordinary CI setup below is a different routing choice.

Use this guide when you operate the machine that executes GitHub CI jobs. Developers who only
push code need the [pre-push guide](ci-pre-push.md); repository workflow policy and costs are in
[CI on GitHub Actions](ci-github.md).

The worker manager is a host background process that watches GitHub's queue, prepares local
Docker images, and launches a new container for each job. GitHub schedules the actual jobs and
records their results. The manager keeps its administrative credential outside worker containers.

Images are stored only in your Docker engine. There is no prepared-image registry to configure
or maintain. Buildx/BuildKit 0.13 or newer is required for multiple local exporters. Initial builds
download upstream Node images, GitHub runner/Bun/Convex releases, Playwright browsers and npm
packages. Warm jobs reuse those bytes locally.

## Set up workers before enabling routing

1. Use a **reviewed checkout** of your application's default branch for the setup sequence below.
   Installing a manager gives that checkout host-level authority. The supporting workflows must
   be adopted too. For another branch, follow [branch testing](#test-a-branch-before-enabling-normal-ci)
   and pass the same `--ref` to the local check and GitHub dispatch.
2. Install Node (the project's supported version), Bun, Git, GitHub CLI and Docker Desktop on
   macOS or Docker Engine on Linux. Start Docker with Linux containers. Run `docker info` and
   `gh auth status`. The manager records the Docker executable, context and Node executable;
   login services do not depend on your shell startup files. Use a local Unix-socket context.
3. Allocate at least 6 GiB to Docker and 12 GiB free disk for preparation. Start with one worker.
   Setup selects at most four CPU cores and eight GiB per worker, leaving two GiB engine memory
   spare. E2E concurrency needs observation on your machine; these are limits, not a throughput
   promise. The initial image budget is 40 GiB; adjust with `config set diskGiB`.
4. Create a dedicated fine-grained GitHub PAT restricted to this **private repository**:
   **Administration: read/write**, **Actions: read**, **Contents: read**, and **Pull requests: read**.
   Metadata read is included. Administration is needed for single-job runner registration;
   Pull requests read allows closed-PR cleanup. Obtain organization approval if required.
   Record the token's expiry. Your ordinary `gh` login separately authorizes dispatch and routing.
5. Run from anywhere inside the checkout:

   ```sh
   bun run ci:workers:setup --token-expires 2027-01-01
   ```

   Replace the sample expiry with the actual expiry. The repository is inferred from `origin`;
   `--repo owner/name` overrides it. Enter the dedicated PAT at the hidden prompt. Never put it
   in command arguments, workflow secrets, a Docker environment or repository files. macOS uses
   Keychain; Linux uses a mode-0600 file in the mode-0700 installation directory.
6. Add `~/.local/bin` to PATH if needed. Setup installs a copy outside the checkout under
   `~/.local/share/starter-workers`, prepares tools and dependencies, validates the runtime,
   and installs a launch agent (macOS) or user systemd service (Linux), starting it when a manager
   credential is configured. Preparation errors leave normal CI routing unchanged; rerun setup
   to resume. On Linux, inspect
   `loginctl show-user "$USER" -p Linger`; arrange user-service lingering if it must run logged out.
   On a Mac, start Docker at login and keep the machine awake while accepting jobs.
7. Run `starter-workers check --install`, then `starter-workers check --github`. Find the
   diagnostic run with `gh run list --workflow ci-verify.yml`, watch it with
   `gh run watch RUN_ID --exit-status`, and record its success with
   `starter-workers check --github --run RUN_ID`.
8. Run `starter-workers enable`. Only now do normal PR and push CI jobs, including summaries
   and Security, request your pool. Scheduled Security and jobs outside the manager's admitted
   events use the auxiliary route described below. Other developers just push code normally.

One installation owns one repository and persists a unique pool ID, independent of installations
on other machines. To select another state directory use
`STARTER_WORKERS_HOME` consistently; the installed command points to the most recently installed
pool. Organization-wide shared registration is not supported. Use dedicated CI hosts when
running code from people you do not trust; containers still share the Linux kernel.

## Separate starter-update installations

Use [guided updater setup](setup-updates.md#choose-where-update-jobs-run) for installation,
certification and routing changes. For custom callers and assignment/isolation constraints,
see [update delivery](update-delivery.md#self-hosted-linux-runners). The ordinary CI diagnostic,
`enable` and `hosted` commands in this guide do not configure updater routing.

## Keep every Actions job local

The prepared manager admits source-bound PR, push and manual CI jobs. It does not admit scheduled
Security, deployment orchestration, Renovate or updater coordination as ordinary CI. To run
those jobs locally, maintain a separate trusted Linux runner and set its **custom label** as
`PLATFORM_CI_AUX_RUNNER`. It must have the tools and network access required by those workflows;
it does not receive the manager's fresh-container or prepared-image isolation. Do not use the
manager's pool ID as the auxiliary label. The separate [update worker setup](setup-updates.md)
can route eligible updater jobs to its own prepared pools.

After adopting workflows with `PLATFORM_CI_LOCAL_ONLY` support on the default branch, configure
the auxiliary runner and opt into fail-closed routing **before** enabling the prepared pool:

```sh
gh variable set PLATFORM_CI_AUX_RUNNER --body YOUR_AUX_RUNNER_LABEL
gh variable set PLATFORM_CI_LOCAL_ONLY --body true
starter-workers enable
```

The repository variable `PLATFORM_CI_LOCAL_ONLY` controls workflow routing; it is separate from
the manager's `setup --local-only` option, which prepares images without a GitHub credential.
The manager's diagnostic must already have passed. `enable` still requires removing the old
`PLATFORM_CI_RUNNER` variable. With `PLATFORM_CI_LOCAL_ONLY=true`, a missing auxiliary label
requests the deliberately unmatched `starter-local-only-unconfigured` label; an offline local
runner leaves jobs queued. Neither condition selects a hosted runner. Check all workflow
selectors and any app-owned jobs when adopting this policy. A runner label is not a resource
limit: allocate enough host capacity for the auxiliary runner and prepared manager together.

`starter-workers hosted` restores the previous **prepared-pool** route; it deliberately leaves
the auxiliary and local-only variables intact. To intentionally allow hosted execution again,
delete `PLATFORM_CI_LOCAL_ONLY` and, if no longer needed, `PLATFORM_CI_AUX_RUNNER` with
`gh variable delete NAME`. Cancel and rerun already queued jobs after any routing change.

## Test a branch before enabling normal CI

For local Docker testing without a GitHub credential:

```sh
bun run ci:workers:setup --local-only
starter-workers check --install  # two fresh workers, browser/backend/network checks, offline install
starter-workers check --quick    # adds native CI without browser tests
starter-workers check --ci       # adds full native CI, including E2E
```

Checks use **committed HEAD**, or `--ref BRANCH`; uncommitted files and host directories are never
mounted in the worker. Commit changes before testing. Native CI inside the container does not
emulate GitHub orchestration or upload GitHub artifacts; the next diagnostic tests real scheduling.

On a private repository, import the dedicated token with `starter-workers auth replace`, then
`starter-workers service start`. Push the reviewed branch and run:

```sh
starter-workers check --ref your-branch --install
starter-workers check --github --ref your-branch
# Find RUN_ID in GitHub Actions, or: gh run list --workflow ci-verify.yml
# Wait: gh run watch RUN_ID --exit-status
starter-workers check --github --run RUN_ID
```

The diagnostic is an explicit mode of the existing `ci-verify.yml`, so its branch version can be
dispatched before merge. It does **not** pass full commit verification: the normal main-only
resolve, app/shared CI and **Verified** jobs are skipped. Two sequential GitHub jobs verify the
same image ID/runtime policy, absence of the preceding job's files, sandboxed Chromium, the
backend executable, and a frozen offline install at the requested source SHA. No repository
routing variable changes.

For developing the public starter itself, setup accepts `--public-branch your-branch` alongside
`--local-only` or the token prompt. That installation accepts only manual dispatches whose GitHub
branch matches the explicit branch; `enable` refuses public diagnostic pools. Fork PRs and automatic
public workloads are never admitted. Do not change that branch without reviewing its code.

Local checks and GitHub workers use the **same image preparation function and container launcher**.
A local proof binds the committed source SHA, immutable image ID and canonical runtime-policy hash
for 24 hours. Dispatch the same branch you locally checked; both diagnostic workers assert those
expected identities. Recording the run requires its unique local proof ID. Runtime-policy changes,
replacement images and a new local check invalidate earlier certification.
With the same branch, dependency inputs, architecture and tool revision they reuse the same local
immutable image ID. Every launch records image ID and a hash of its runtime policy in the private
`evidence/` directory; workflow steps also expose `STARTER_WORKER_IMAGE` and `STARTER_WORKER_RUNTIME`.
Fresh container IDs, addresses and one-job registration data naturally differ. GitHub-hosted
`ubuntu-latest` is a separate environment and is not claimed to be identical.

## Dependency reuse during development

The manager reads the exact source revision from authenticated GitHub run/job metadata and the
workflow's source label. No checked-out application code runs on the host. Git reads blobs from
a bare repository, with hooks disabled; builds use the installed fixed recipe.

| Change | Preparation |
|---|---|
| Ordinary source changes | Reuse prepared dependency image |
| Lockfile, package manifests, patches or local `file:` package bytes | Build one new seed |
| Node major, Bun or locked Playwright version | Build matching tools, then a seed |
| Repeated pushes to the same dependency-changing PR | Reuse that PR's seed |
| Merge to a trusted branch | Use the branch's separate seed scope |
| Job failure/cancellation | Delete the container and its private state |

The fingerprint covers the complete lockfile, manifests, local package/patch contents and immutable
tool image. The declared Node minimum minor participates in the tool profile; preparation validates
the actual runtime before promotion. Supported engine ranges are a whole major (`24.x`) or a
minimum minor within it (`>=24.21 <25`). Seed installation disables lifecycle scripts. Actual jobs run the frozen offline
install and postinstall against their own source. Jobs never export their modified caches as images.
Tools are exported once to both Docker and a private local OCI layout with matching filesystem layers
and configuration. Seed builds consume that layout by manifest digest, so cache eviction cannot
rerun tool installation under a retained image identity. Refresh downloads and dependency inputs
stay in separate temporary candidate directories. The tool pointer and dependency environment are
promoted together in the catalog only after disposable exact-source frozen offline validation.
The selected Convex backend is baked in and passed explicitly to the local backend launcher, so
normal starts do not discover/download another backend version each time. Keep the worker proxy
and tool variables in `turbo.json`'s `globalPassThroughEnv`; Turbo's strict environment filtering
otherwise removes them from builds and tests.

This recipe supports public npm packages, workspace dependencies and repository-local `file:`
packages. Custom `.npmrc`/`bunfig.toml`, Git dependencies and external tarball sources are rejected
with an explanation; do not solve that by copying credentials into the image. Add a reviewed recipe
and credential separation before enabling private package registries.

## Operate and maintain

```sh
starter-workers status              # Docker, last poll, active jobs, configuration, expiry warning
starter-workers status --watch
starter-workers images             # image IDs, scopes, creation and last-use times
starter-workers logs --follow       # manager log (Linux: also journalctl --user -u POOL -f)
starter-workers config set concurrency 2
starter-workers cleanup --dry-run
starter-workers cleanup
```

Keep Docker and the host available. The manager checks for compatible upstream tool refreshes daily
when idle; it validates replacements before promoting them. It does not upgrade your application's
lockfile. `starter-workers refresh` prepares/validates a refreshed environment for the committed
checkout immediately. If a refresh fails, inspect the error and fix it; an incompatible image is
never silently substituted. Runner security updates may require prompt operator action.

`starter-workers auth replace --token-expires YYYY-MM-DD` prompts for and validates a new dedicated
token before storing it and recording its expiry. Status warns within 14 days of
known expiry. Tokens do not renew automatically. Revoke the superseded token after checking access.
Keep Docker and the host OS patched too.

For a reviewed manager update, first `starter-workers pause --drain`, then
`starter-workers service stop`. From the reviewed checkout run `starter-workers update --from .`.
It builds and smoke-tests the new recipe before switching the installed manager; the previous
installation remains in `previous`. Run `starter-workers check --install`, then
`starter-workers service start` and `starter-workers resume`.

A failed/cancelled job loses its private overlay. On manager restart, abandoned containers/networks
and owned GitHub registrations are reconciled. Job diagnostic logs and launch evidence stay outside
workers and expire after seven days. Retention preserves the live service `manager.log`. Only this pool's labeled resources are touched.

## Image and layer cleanup

Idle daily cleanup retains active images plus the two newest environments in each branch scope.
Other unused environments expire after seven days. PR seeds can all expire after seven idle days,
and become eligible 48 hours after the PR closes, provided they have not been used within 24 hours.
Recent catalog use reserves a prepared image while its first container is being registered.
Last use comes from the manager catalog, rather than Docker's image creation timestamp. A conservative image-size budget can pause admission even
when layers are shared; adjust it after inspecting `docker system df` and `starter-workers images`.

Failed preparations remove their candidate tags and staging directories immediately. Cleanup also
collects orphan seed tags, abandoned candidate tags/directories and unused OCI layouts after a crash.
Retained environments and active workers protect their images and tool layouts. Old unreferenced
tool images and cached tool selections expire after seven days. Layouts occupy host disk in addition
to Docker storage; allow space for both. Legacy build/download staging is removed during cleanup.
BuildKit uses a pool-specific builder with a separate cache budget of approximately one third of the configured image budget, and cleanup
prunes old cache only in that builder. Deleting an image/tag releases layers only when nothing else
references them. Never use blanket `docker system prune` or `image prune -a` to operate this pool.

## Pause, return to hosted CI, or remove

`starter-workers pause --drain` waits for a fresh manager acknowledgement after pending admission
completes and all running work finishes. The manager must be running to acknowledge the pause.
Routing stays local; new jobs wait. `starter-workers resume` reopens admission.

Before taking the machine offline, run `starter-workers hosted`. It restores the previous routing
setting, refusing to overwrite a newer setting written by someone else. Already queued jobs do
not automatically move: cancel them in Actions and start fresh workflow runs. There is no cloud
fallback while the only manager is offline. To return, check the machine and rerun the diagnostic,
then `starter-workers enable`.

For removal: `hosted`, `pause --drain`, `service stop`, then `starter-workers uninstall`. Revoke
the GitHub token. Prepared images and the dedicated BuildKit builder are retained; inspect them
and remove only that pool's tags and builder if you want to reclaim everything. Other Docker
resources are untouched.

## Isolation and assignment checks

Workers run as UID 1001, without sudo, Docker access, host mounts or Linux capabilities. They use
private shared memory, explicit memory/CPU/PID limits, no-new-privileges and a Chromium-compatible
seccomp profile. A separate trusted namespace holder enforces outbound firewall rules; an HTTP(S)
proxy permits public traffic and refuses private/loopback/metadata destinations. Local application
servers communicate over the worker's own loopback. Raw external network connections and services
on your host are inaccessible. Workflows requiring Docker containers/services or private-network
services need a separate reviewed execution policy.

GitHub runner labels select a worker; they do not authorize an assignment. Before
starting each GitHub worker, the host copies its admitted repository ID/name,
run ID/attempt, source, event and ref into a root-owned file under `/opt/starter`.
The fixed `ACTIONS_RUNNER_HOOK_JOB_STARTED` shell hook uses an absolute Node
interpreter and validates the runner's default GitHub contexts and event payload
against that file. Job environment variables cannot supply the expected identity.
PR validation binds the event's head/base repository IDs and commits and handles
GitHub's merge SHA separately from the run's head SHA. Public diagnostic pools
accept only the configured reviewed branch's manual dispatch.

The runner downloads action metadata before this hook executes. A rejected hook
prevents action/container pre and main steps, but does not prevent those metadata
downloads. This system is intended for reviewed private-repository workflows and
an explicit reviewed public diagnostic branch; it offers no hostile public
multitenancy guarantee. See [GitHub's hook documentation](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts)
and [the runner's ordering](https://github.com/actions/runner/blob/v2.337.0/src/Runner.Worker/JobExtension.cs).

## Migrate from the retired Compose runner

Complete setup and certification before switching routing. If hosted jobs are available, stop the
old Compose project, remove its runner registrations, revoke its registration PAT, and delete
its dedicated cache volumes after identifying them with `docker volume ls`. If you require
[all-local routing](#keep-every-actions-job-local), first provide a reviewed auxiliary runner;
the old Compose runner can serve that role temporarily through `PLATFORM_CI_AUX_RUNNER` while
you replace it. Remove `PLATFORM_CI_RUNNER` before enabling the manager. Retire the old Compose
runner only after scheduled, deployment and updater paths have a working auxiliary route. Do
not reuse its writable volumes as image seeds. Other Docker resources are unaffected.

## References

Vendor contracts: [GitHub JIT runners](https://docs.github.com/en/rest/actions/self-hosted-runners#create-configuration-for-a-just-in-time-runner-for-a-repository),
[Docker run controls](https://docs.docker.com/reference/cli/docker/container/run/),
[Bun frozen/offline installs](https://bun.sh/docs/pm/cli/install), and
[Playwright sandbox profile](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json).
The shipped profile's attribution and modification notice are in
[THIRD_PARTY_NOTICES.md](../tooling/ci-workers/recipe/THIRD_PARTY_NOTICES.md).
It does not grant the worker a host capability.
