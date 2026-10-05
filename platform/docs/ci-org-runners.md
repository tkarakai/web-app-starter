# One prepared worker pool for several apps in a GitHub organization

Use this option when several **private** starter apps belong to one GitHub organization and you
want one machine-wide limit for local CI. One installed `starter-workers` manager polls only the
repositories you add, prepares app dependencies, and launches a fresh container for each job.
It registers single-job runners in a selected-repository organization runner group. With the
default concurrency of one, jobs from all included apps share one capacity budget.

Organization registration by itself does not accelerate CI: a native persistent organization
runner would still perform the workflow's dependency and browser setup. Preparation and fresh
containers come from this manager. The [single-repository setup](ci-workers.md) remains available.

## Create a private runner group

1. Move the apps into **one GitHub organization** and adopt this platform version's CI workflows
   on their default branches. The manager refuses repositories outside the organization.
2. As an organization owner, open **Settings → Actions → Runner groups**. Create a group with
   **Selected repositories** access. Select only the private apps for this pool, leave public
   access disabled, and do not put other runners in the group. See [GitHub's group guide](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access).
   If you add workflow restrictions, include the diagnostic and every directly defined CI
   workflow that needs the pool, then test every app again.
3. Find its numeric ID in organization settings or with:

   ```sh
   gh api /orgs/ORG/actions/runner-groups --jq '.runner_groups[] | {id,name,visibility}'
   ```

The manager checks group membership and authenticated repository identity before admission.
GitHub's group policy is an additional restriction, not the only job authorization check.

## Prepare the machine and credential

Follow the Docker, Node, Bun and disk requirements in [local workers](ci-workers.md#set-up-workers-before-enabling-routing).
Start with concurrency one. Docker Desktop's engine memory limit still covers all Docker work;
the manager's CPU, memory, concurrency and image budget now apply across its apps.

Create one dedicated fine-grained PAT for this organization, limited to the selected private
repositories. Grant **Self-hosted runners: read/write** at organization scope and **Actions:
read**, **Contents: read** and **Pull requests: read** on those repositories. Metadata read is
included. Organization permission allows [JIT runner registration](https://docs.github.com/en/rest/actions/self-hosted-runners#create-configuration-for-a-just-in-time-runner-for-an-organization).
Use an organization owner account with the required effective access. Your ordinary `gh` login
separately needs permission to dispatch checks and change repository variables. Record token
expiry and enter the manager token only at the hidden prompt.

This credential has broader authority than a repository-only token. Review every added app.
Keep it outside worker containers; a host compromise could still affect all selected apps.
Workers have no Docker socket, host mounts or manager token, but share the Linux kernel. Do not
admit hostile public workloads.

## Install once and add apps

From a reviewed checkout of the **first** app's default branch, choose a dedicated state
directory and run:

```sh
STARTER_WORKERS_HOME="$HOME/.local/share/starter-workers-org" \
  bun run ci:workers:setup --org ORG --runner-group-id GROUP_ID --token-expires YYYY-MM-DD
```

The checkout's `origin` supplies the first repository. Setup validates group access, prepares
that app's committed source and installs one service. Normal CI routing stays unchanged. Use
the installed command's **absolute** path: `~/.local/bin/starter-workers` may point to another
installation on the Mac.

For another selected app that has adopted the supporting workflows:

```sh
"$HOME/.local/share/starter-workers-org/starter-workers" org add --repo ORG/SECOND_APP
```

`org add` validates group membership and API access without changing GitHub routing. App
dependency seeds and branch/PR scopes remain repository-specific; compatible tool images can
be reused in this pool. Do not repeat `ci:workers:setup` from another app in the same state
directory.

## Certify and enable each app

From **each** app's reviewed checkout, replace `ORG/APP` below:

```sh
"$HOME/.local/share/starter-workers-org/starter-workers" check --repo ORG/APP --install
"$HOME/.local/share/starter-workers-org/starter-workers" check --repo ORG/APP --github
gh run list --repo ORG/APP --workflow ci-verify.yml
gh run watch RUN_ID --repo ORG/APP --exit-status
"$HOME/.local/share/starter-workers-org/starter-workers" check --repo ORG/APP --github --run RUN_ID
"$HOME/.local/share/starter-workers-org/starter-workers" enable --repo ORG/APP
```

The diagnostic must pass both fresh workers before `enable` sets that app's
`PLATFORM_CI_WORKER_POOL` variable. Repeat for every app and confirm a normal CI run passes.
Remove the old `PLATFORM_CI_RUNNER` variable before enabling this prepared pool. Summary,
Security and deployment jobs retain their existing routing. Platform-update verification and
publication have separate role-specific worker setup; adding an app here does not move them.

## Operate and return to hosted CI

- `status`, `pause --drain`, `resume`, `config set concurrency`, `cleanup` and service control
  affect the **whole** pool. Raise concurrency only after observing Docker's global budget.
  Run `refresh --repo ORG/APP` from that app's checkout.
- Before taking the Mac offline, run `hosted --repo ORG/APP` for **every enabled app**, then
  `pause --drain` and `service stop`. Already queued jobs keep their old labels; cancel and
  re-run them in Actions to move them to hosted execution. There is no automatic fallback.
- For a manager update, drain and stop the service, use `update --from .` from a reviewed
  checkout containing the new manager, then check and certify apps before returning routing.
- To remove one app, return it to hosted routing, drain and stop the service, run
  `org remove --repo ORG/APP`, then remove it from the runner group's selected repositories.
  Start the service for remaining apps. To uninstall the whole pool, return every app to
  hosted routing, drain, stop, `uninstall`, and revoke the organization token.

The private starter maintainer repository's Lab and Release workflows use
`STARTER_MAINTAINER_RUNNER`, not this app CI pool. Moving that repository into the organization
does not automatically make its jobs eligible for the prepared manager.
