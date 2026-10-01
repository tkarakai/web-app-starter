# Guided deployment setup

Run `bun run deploy:setup --check` for read-only JSON status (exit 0 when complete, 2 when
work remains). Run `bun run deploy:setup` in a terminal to provision and configure services,
or resume an interrupted setup. It creates cloud resources and updates provider settings;
review the repository, teams and project list shown before proceeding.

Start these human steps early:

- Create accounts and choose billing at [Vercel](https://vercel.com/dashboard) and
  [Convex](https://dashboard.convex.dev). Install GitHub and Vercel CLIs and the app's pinned
  Node/Bun dependencies. Use `bun run ops auth login github`, `vercel`, or `convex` to sign in.
- Arrange access to your DNS provider and decide staging/production hostnames. The wizard
  prints provider-specific DNS and ownership records and rechecks them when you continue.
- Verify an email-sending domain at [Resend](https://resend.com/domains). Hosted authentication
  needs working email delivery. Select a production environment reviewer in GitHub; provider
  plan restrictions are not bypassed.

The wizard derives web, admin and exactly one landing from installed app packages. It creates
separate staging and production Vercel projects, without a Git connection. If `apps/landing`
exists it is selected; otherwise `apps/landing-static` is selected. Static landing projects have
different names and IDs, root `apps/landing-static`, framework Other and output `out`; they
never reuse the primary landing project. GitHub Actions performs all deployments.

Vercel project settings and Convex projects are read back before proceeding. Existing projects
are reused; conflicting settings stop with a precise remedy. Convex uses a separate project's
production deployment for each environment. The wizard sets computed cross-app URLs and
backend origins, creates GitHub environments, and stores IDs/keys under the names expected by
CD. It adds required CI checks and PR review protection without replacing existing branch
access/reviewer settings. Review existing required checks when removing an app: stale required
checks are never deleted automatically. Read-only inspection requires the same installed-app CI contexts as setup, including both landing checks when both apps remain installed.

## Credentials and resuming

There are two kinds of provider credentials:

- A [Vercel access token](https://vercel.com/account/tokens), scoped to the selected team,
  is used to configure projects and saved as the app repository's `VERCEL_TOKEN` Actions secret.
- A Convex **team access token**, created in Team Settings → Access Tokens, lets this setup
  session create projects and deployment keys. Its numeric team ID is shown there. It is not
  stored locally or in GitHub. The generated **production deployment keys** are stored as
  `CONVEX_DEPLOY_KEY` in the corresponding GitHub `staging` and `production` environments.

Enter credentials only at the hidden terminal prompts. Values go to APIs in memory or to
`gh secret set`/`convex env set` through stdin. They never enter the public resume file, process
arguments or setup logs. Provider error bodies are suppressed because they can echo inputs.
Existing backend auth secrets and email credentials are retained. On resume, the authenticated Convex CLI runs from `packages/backend` for all environment reads and writes against the explicitly selected deployment;
existing GitHub deployment secrets are neither retrieved nor rotated.

Public progress lives in git-ignored `.deploy-setup.json`. Keep it to resume project IDs, domains
and the staging request. Public files are replaced atomically using exclusive, unique same-directory temporary files with cleanup on failure; abandoned temporary files do not prevent resumption. `ops.config.json` receives the same mappings. Rerunning queries live
resources before creating anything. A saved mapping is not proof that its provider credentials
still work; `--check` labels local-only evidence and checks secret names without decrypting them.

If interrupted immediately after creating a Convex key but before storing it, recover that key
from the provider step if available, or revoke the orphan in the Convex dashboard before resuming.
A provider write may have succeeded when a network response was lost; inspect the named resource
before retrying any failed write.

## Staging and production

A new repository with no deployment credentials skips automatic staging deployment with a
setup notice. Explicit dispatches and partial configurations fail with missing credential names.
Interrupted setup and reruns have no skip exception: partial credentials fail visibly. Existing fully
configured apps need no opt-in variable; legacy `DEPLOY_SETUP_STATE` values are ignored. Production's existing dispatch gates remain.

The final step asks to deploy the default branch's immutable commit through `ops` and waits for
serving verification. `bun run deploy:setup --prove` resumes the saved request rather than
repeating provisioning or dispatching another deployment while its configuration remains unchanged.
Saved requests bind proof to the selected topology, staging domains, project/backend mappings,
repository and team. Saved successful proof is checked against current `ops.config.json` mappings
and reverified for serving through `ops verify`; workflow success alone is insufficient. Changed
configuration or legacy unbound evidence requires explicit local authorization for a new proof.
Declining preserves the saved request and dispatches nothing. If dispatch failed ambiguously, inspect
Actions/`ops` using the saved request ID; do not delete the request and retry blindly. After a
confirmed failed/cancelled run is diagnosed, preserve its evidence and remove only `request` and
`proof` from the public state to authorize a fresh proof on the next run. Production is never
deployed by setup.

The app's deployment callers must already be committed on its configured default branch. For a
non-main default branch, update app-owned CD push triggers and environment branch policies as
well. Initial DNS verification, provisioning and a staging deployment require real accounts;
unit/provider-fixture tests do not establish that an app is live.

API references: [Vercel project creation](https://vercel.com/docs/rest-api/projects/create-a-new-project),
[Convex Management API](https://docs.convex.dev/management-api/overview),
[Convex project creation](https://docs.convex.dev/management-api/create-project),
[Convex deploy-key creation](https://docs.convex.dev/management-api/create-deploy-key).
