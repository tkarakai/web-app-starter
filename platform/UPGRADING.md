# Upgrading the platform in your app

Apps adopted from a published v2 release use `bun run platform:upgrade`. The command creates
an ordinary update branch, takes platform files from the selected release, merges declared
seams against your installed version, and verifies your app before recording the new baseline.
Your app code, branding, messages and optional-app choices remain yours.

An agent can use the [`platform-upgrade` skill](agent-skills/platform-upgrade/SKILL.md) to
finish an update PR, resolve its saved report and complete verification.

The installed version, exact source commit and recorded patches live in `.platform-base.json`.
`platform/VERSION` describes the source currently in the checkout; during a pending upgrade
these can differ. The root package version is your app's version.

This command handles upgrades **between separated platform releases**. An older fork without
`.platform-base.json` needs the one-time v2 migration; do not invent a baseline or run adoption
over an existing app. Existing deployments with legacy platform tables must also complete
[the component data migration](docs/component-data-migration.md) before deploying v2.

For initial adoption into an existing repository, use [the existing-repository guide](README.md#existing-repositories). For a missing or invalid baseline, read this guide from the **target published tag**; the installed copy may predate the repair. Never invent a baseline or run adoption over an already adopted app.

## Apps adopted before the first published release

A checkout can say `2.0.0` without containing the published `v2.0.0` commit. Earlier adoption
versions recorded the checkout's `HEAD`, so adopting after merging starter source into an existing
repository could also record an app merge commit. Neither is a published-release baseline. The automatic
updater deliberately rejects these records; choosing a later target version does not fix them.

For an app already using the separated v2 layout, make a one-time, reviewed source migration
on a new branch, preferably rehearsed in a separate clone first:

1. Identify the actual starter source commit in the app's history. Compare its platform zone
   with the recorded baseline and current app; account for every local platform edit. Preserve
   the existing `.platform-base.json` until verification finishes. Do not rerun `adopt`.
2. Fetch the published `v2.0.0` from `tkarakai/web-app-starter`, record its full commit SHA,
   and merge that commit with `git merge --no-commit --no-ff FULL_RELEASE_SHA`. This procedure
   requires shared starter ancestry; unrelated source copies need a separately reviewed migration.
3. Review the entire diff and resolve conflicts. Take the release's platform zone, preserving
   intentional patches through the `platform-patch` contract. Preserve app guides, identity,
   messages, business code and removed optional apps. Review app-owned reference fixes below;
   a source merge also changes app-owned files, unlike the automatic updater. Set the desired
   `i18n.defaultLocale` explicitly and keep the landing's development scripts.
4. Write a **candidate** baseline outside the checkout with the release version, full release
   SHA and reviewed patches. Run `./platform/tooling/node-ts.sh platform/tooling/check-zone.ts
   --base-file /absolute/path/to/candidate-base.json`. Investigate each difference, including
   generated files accidentally committed inside platform directories.
5. Run `bun install` and every check listed in **Verify and recover**, including E2E. Review
   dependency floors and applicable environment/data-migration requirements in the release
   metadata. Configure separate static Vercel projects before deploying a static-only landing.
6. Only after those checks pass, copy the candidate record to `.platform-base.json`, rerun
   `bun run check:zone`, and commit the reviewed migration. Retain its verification evidence.

This establishes the first published baseline. Subsequent published versions use the normal
`platform:upgrade` flow. Never merely change the recorded version or commit to silence an error:
the record must describe the platform source actually installed and verified in the app.

## Plan and apply

Start with a clean, committed app checkout. Read the target release's
[Action required notes](CHANGELOG.md). Use the target's Node major and exact Bun version;
they are declared in `platform/releases/breaking-changes.json`. The launcher checks both before
running target code. `PLATFORM_UPGRADE_NODE` can name a different Node executable.

```sh
bun run platform:upgrade --to v2.1.3 --dry-run --report upgrade-report.json
bun run platform:upgrade --resume upgrade-report.json
```

The version above is an example; select an actually published release. A dry run writes only
the requested JSON report and its Markdown companion. It leaves app files, index, refs, branch,
lockfile and installed baseline unchanged. Temporary source checkouts are removed on exit.
Without `--report`, the command prints a temporary report path outside your checkout.

To plan and apply in one invocation:

```sh
bun run platform:upgrade --to v2.1.3 --non-interactive --report upgrade-report.json
```

All execution is non-interactive. The default trusted source is `tkarakai/web-app-starter`.
`--source owner/repo` explicitly chooses another trusted GitHub source; an explicit local Git
repository is supported for isolated rehearsals. The tool executes that source's code: this
is not a sandbox. It never changes remotes or overwrites tags. Release attachments must match
the committed metadata. Missing releases, unknown metadata and unsupported version expressions
stop the upgrade.

The installed launcher executes the **target commit's tool** from a temporary checkout. Skipping
releases runs each intermediate release's codemods, in order, using that release's implementation.
Completed codemods are checked and recorded; resuming does not blindly run them again.

## Read the result

Both reports contain installed/target identities, source changes, seam conflicts, patch decisions,
ordered codemods/migrations, environment references, dependency floors, advisories and checks.
The JSON also contains bounded base/app/target patch diffs and resume state. Keep the report pair
with the update PR; do not edit its JSON manually or put secret values in review evidence.

| Exit | Outcome | Meaning |
| --- | --- | --- |
| 0 | `planned` | Dry run completed; nothing is verified or installed |
| 0 | `unchanged` | Already at this release, with no planned changes |
| 0 | `verified` | All required checks passed and the installed baseline advanced |
| 2 | `needs-review` | A specific decision, source resolution or required check is pending |
| 1 | `failed` | Inspect the diagnostic and preserve the branch before recovery |

Apply creates `platform-update/vX.Y.Z`. It refuses to move an existing branch. Source changes
are staged only from the audited path list; you review and commit them normally. It never
commits, pushes, merges, deploys or changes remote data itself.

| Files | Upgrade behavior |
| --- | --- |
| `platform/`, nested `platform/`, and `platform-*` paths | Exact target bytes, modes and supported relative symlinks; obsolete files removed |
| Seams listed in the release manifest | Three-way merge: installed source, your app, target source |
| Other app files | Preserved, except declared codemods and dependency-floor changes |
| Optional app absent from your checkout | Remains absent |
| `bun.lock` | Regenerated by the pinned Bun version |
| `.platform-base.json` | Updated only after every required check and decision passes |

Conflicting seams retain labeled app/installed/target sections. Codemods and installation wait
for conflict resolution. App dependency floors can raise a lower compatible declaration and
root override, but never lower a higher version. Unprovable ranges and major differences need
review. Verification checks the actual installed dependency versions too. Root overrides are
checked across the consuming workspaces and their installed dependency graph, including isolated installs.
Package conflicts retain those minimums: both the seam and its dependency review need evidence,
and the resolved installed version must still pass verification afterward.

## Resume a draft from CI

The [update workflow](docs/update-delivery.md) can deliver a pending upgrade as a draft PR.
Check out its `platform-update/vX.Y.Z` branch and, before editing files, run
`bun run platform:upgrade --resume upgrade-report.json --relocate`. The tool checks the exact
draft tree, index, baseline and app history before binding the report to your checkout. It
preserves the immutable plan and completed codemods, then repeats installation and all checks.
Secret-configuration decisions need fresh evidence for this environment. Interrupted commands
and already-recorded upgrades cannot be relocated.

If `package.json` contains conflict markers, Bun cannot read its scripts (it may report
`Script not found "platform:upgrade"`). Run the same dependency-free launcher directly, before
editing the conflicted file:

```sh
./platform/tooling/node-ts.sh platform/tooling/platform-upgrade.ts \
  --resume upgrade-report.json --relocate
```

Use this command prefix for review operations until the package seam is valid JSON. Then the
usual `bun run platform:upgrade` command works again; keep the existing report and branch.

## Resolve one review item

Use the exact item ID in the report and explain the evidence for that one decision:

```sh
bun run platform:upgrade --resume upgrade-report.json \
  --resolve 'seam:app.config.ts' --action reviewed \
  --evidence 'Retained our branding and the target feature switch; reviewed the merged config'
bun run platform:upgrade --resume upgrade-report.json
```

The resolution command only records the decision. Resume performs the remaining work.
For a pre-apply gate, record the specific decision first, then resume to apply. If a patch must
be reapplied, the command stops after source application so you can reapply it to the target.
For a seam conflict, edit the named file, record its resolution, then resume. Only named review
files may change while an update is pending. Unrelated work requires a new plan.

| Item | Action and evidence |
| --- | --- |
| Recorded patch | `accept-release`, or `reapply-patch` followed by reapplying it with its `PLATFORM-PATCH:` marker |
| Unrecorded platform edit | Record/remove the patch, commit, and create a new plan; it cannot be acknowledged away |
| Seam conflict or dependency decision | `reviewed`, with the intended resolution; seams also permit `accept-release` |
| Removed/renamed env | `reviewed`; remove old reads/declarations from the named app files before verification |
| Dynamic env access | `reviewed`, identifying what the dynamic access reads |
| Required new secret | `secret-configured`, naming the environment where it is configured, never its value |
| High/critical advisory | `reviewed`; the target must also be outside the affected range and pass contracts |
| Row-changing migration | `migration-complete`, with deployment-specific completion evidence |

Optional new settings are listed in the report without requiring configuration before the
upgrade. Configure them before using the associated feature.
Removed or renamed settings and required new settings still trigger the applicable review gates.

Migration evidence is a saved read-only status JSON containing `deployment`, `phase: "complete"`,
`matches: true`, and a nonempty `tables` array whose entries have `matches: true`, `missing: 0`
and `mismatched: 0`. Pass it with `--migration-evidence PATH`. The report stores only its digest
and deployment URL. Follow the migration's instructions for expansion, backup, approval, copy,
verification and contract deployment. The upgrade command does not choose a deployment or run
those data-changing commands.

There is no blanket approval or ignore-checks option. Acknowledging an item records the human
review; it does not bypass source, dependency, advisory or contract verification.

## Verify and recover

Verification uses a separate candidate baseline, preserving the installed record throughout.
It checks zone/hooks, env references and resolved dependencies, then runs the app's root scripts
from the authoritative `UPGRADE_CHECKS` inventory in
[`tooling/ci-checks.ts`](tooling/ci-checks.ts), including shared-package coverage, startup
and both landing artifact variants. See [production artifact requirements](docs/testing.md#shared-ui-and-production-artifacts).
Before you run it, know what these scripts need:

- **`lint` runs with `--max-warnings 0`** in every workspace (since 2.1.0), so a warning in your
  own code fails verification. Fix them in a separate commit before planning: changing app files
  after planning invalidates the saved plan.
- **`build` needs `CONVEX_URL` and `CONVEX_SITE_URL`** (web and admin read them while collecting
  page data). In a checkout that has run `bun run dev` they come from each app's `.env.local`. In
  a fresh clone or worktree, export placeholders for the run, as `bun run ci` does, for example
  `CONVEX_URL=https://placeholder.convex.cloud CONVEX_SITE_URL=https://placeholder.convex.site`.
- **`test:e2e` starts the launcher's own local backend and servers on the ports in
  `app.config.ts`.** Stop a running `bun run dev` stack (or any process on those ports) first, or
  use `--defer-e2e` and let CI run the browsers on the draft PR.

Keep these scripts representative of your app. Missing scripts and changed tracked files during
a verification command are failures. Publishing/updater credentials are removed from child
processes, and known secret environment values are redacted from bounded command diagnostics.

`--defer-e2e` leaves E2E pending and the baseline unchanged. The update remains a draft. Resume
without that flag to run E2E and finalize; passing other checks is not an installed upgrade.
After final recording the zone check runs again. Normal app CI checks the installed baseline.
For an explicitly different public platform source, set `PLATFORM_SOURCE_REPOSITORY` in CI.

After a failed check, fix only the report's named review files and resume. A change to the source,
metadata, baseline or unrelated app files invalidates the saved plan. Preserve your work, inspect
the failure and create a new plan when its scope changes. Successful codemods remain recorded;
interrupted codemods are checked before retrying. An unexpected codemod/install write requires
inspection and replanning. Reports do not claim success after a failed or deferred check.

Before any data changes, abandon the unmerged update branch or revert the committed upgrade
with an ordinary new commit, including the baseline and lockfile. Your prior app commits remain
in history. After data changes, a source revert is not a data rollback: use the migration's
compatibility/recovery procedure and retain its expanded schema until recovery is verified.

The optional demo's sidebar-package rehearsal is a separate example:
`bun run test:starter-rehearsal`. It does not replace platform verification or prove a backend
migration. No upgrade command publishes a release or deploys your app.

## After merging or pulling an upgrade

After pulling or merging an upgrade that changes `bun.lock`, dependency manifests or workspace layout,
run `bun install --frozen-lockfile` in **each local checkout** before development or validation.
Installation and verification in an upgrade worktree or CI do not refresh another checkout's dependencies.

```sh
# In every existing developer checkout, after pulling the merged upgrade:
bun install --frozen-lockfile
bun run dev
```

A frozen install must leave the committed lockfile unchanged. If it fails, resolve the installation
or manifest/lockfile error before running development or validation. The launcher's frozen preflight
is a safeguard for a missed refresh; keep the explicit install in the normal upgrade/pull handoff.

## Reference-app fixes

App-owned pages are preserved by the updater. When taking the landing/locale fixes listed in the changelog:

- In a web locale-root page, await `params`, validate `locale` against `locales`, then ``redirect(`/${locale}/dashboard`)`` (use a template string in your code). Relative `redirect("dashboard")` loses the locale.
- Keep `dev:landing` wired to `./platform/tooling/dev-start.sh --app=landing`. The updater merges the root script seam; review customized script conflicts.
- Copied `qa/e2e/localization.spec.ts` tests in web and landing apps must use the app's configured `locales` and `loadMessages` catalogues, including overrides. Earlier reference tests hard-coded French and Arabic, which fail when those languages are removed. The release includes corrected reference tests.
