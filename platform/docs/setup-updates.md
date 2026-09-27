# Set up automatic platform updates

From an adopted app, run:

```sh
bun run platform:setup-updates
```

You need the project's Node version, the GitHub CLI (`gh`) signed in, and administration access
to your app repository. `--repo owner/repo` selects it explicitly; otherwise the helper uses the
current repository. The [update workflow](update-delivery.md) must already be in your platform.

The helper preserves an existing app-owned update caller and adds the template if it is missing.
Review and commit that file. It opens a local setup page; `--no-open` prints its URL for you to
open yourself. Keep the terminal running through these steps:

1. **Create the App.** GitHub asks you to confirm its name. The registration presets a private
   App owned by the app repository's account or organisation, with Contents, Pull requests,
   Workflows and Issues write access. It has no webhook subscriptions.
2. **Install it.** Select **Only select repositories**, then choose this app repository only.
   The helper verifies that actual installation and its permissions, rather than trusting the
   browser's installation ID. Extra repositories or broader permissions must be corrected.
3. **Save configuration.** After verification, the helper stores the App ID in repository variable
   `PLATFORM_UPDATER_APP_ID` and its private key in Actions secret `PLATFORM_UPDATER_PRIVATE_KEY`
   using `gh`. The key travels through stdin to GitHub's encrypted secret transport and is never
   written to a local file, browser page or log. The helper closes after success or timeout.
4. **Run it.** After committing the caller, open **Actions → Update platform → Run workflow**.
   A release within policy becomes a verified PR or review draft; a major becomes an issue.

GitHub's registration handshake expires after one hour; the helper times out after 55 minutes.
If registration was created but setup was interrupted, inspect your GitHub App settings before
creating another App. You can finish manually using [the workflow's credential names and
permissions](update-delivery.md#credentials). Do not paste the key into chat or commit it.
If the key was stored but writing the ID failed, the helper prints the public App ID to set.

## Existing configuration

```sh
bun run platform:setup-updates --check
```

This reads only the App ID, presence of the secret, and local caller. It cannot read the stored
private key or certify that the key is valid; the workflow checks it when minting a token.
Ordinary setup preserves existing complete credentials. Partial settings stop with instructions.
`--replace` explicitly registers and installs a new App before replacing those two settings;
it does not delete the old GitHub App. Use it only when you intend that credential change.

## GitHub token fallback

```sh
bun run platform:setup-updates --fallback
```

Fallback installs or preserves the caller and reports the repository's Actions setting. Enable
**Allow GitHub Actions to create and approve pull requests** in repository Actions settings if
it is off; the helper does not silently change that permission. No App or secret is created.

Fallback PRs may need **Approve and run** for CI. Workflow-file changes become issues with a
manual upgrade command because `GITHUB_TOKEN` cannot push them. If an App ID is already present,
the helper refuses to switch modes implicitly: remove `PLATFORM_UPDATER_APP_ID` explicitly first.
It leaves the private key secret intact. See [update delivery](update-delivery.md) for review,
recovery and auto-merge rules.
