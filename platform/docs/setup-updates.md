# Set up automatic platform updates

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
public App identity when known, and pending owner actions. Schedule, policy and auto-merge remain
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
