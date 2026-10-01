---
name: platform-upgrade
description: Take a published platform release in an adopted app or finish a draft platform update PR. Resolve the saved report's seam, patch, environment and migration gates, resume verification, and keep the installed baseline accurate. For app dependency updates use platform-deps.
---

# Finish a platform upgrade

Read `platform/UPGRADING.md`, the target release's Action required notes, and the update PR's
JSON/Markdown report. The report is the inventory of pending work; its immutable plan and
mutable state are validated by the tool. Never edit report JSON, invent a baseline, skip required
checks or mark a migration complete without deployment-specific evidence.

## Start from the right state

- In a draft update PR, check out its existing `platform-update/vX.Y.Z` branch. Before editing
  any files, run `bun run platform:upgrade --resume upgrade-report.json --relocate` to bind the
  CI report to this checkout. Use the PR's actual report path if different. Exit 2 means there
  are review items to resolve; it is expected for a draft. Do not make a second update branch.
- If `package.json` contains conflict markers, Bun cannot read its scripts. Before editing,
  relocate with `./platform/tooling/node-ts.sh platform/tooling/platform-upgrade.ts --resume
  upgrade-report.json --relocate` instead. This invokes the same dependency-free launcher.
  Use that command prefix until the package seam is valid JSON; then `bun run platform:upgrade`
  works again. A package-script error does not mean the saved upgrade must be replanned.
- For a new upgrade, start from a clean committed app and plan it with
  `bun run platform:upgrade --to vX.Y.Z --dry-run --report upgrade-report.json`. Select a real
  release, review the plan, then resume that report. A dry run's exit 0 is not verification.
- Without `.platform-base.json`, this is not a separated-platform upgrade. An existing fork
  needs its migration procedure; adoption must not be run over it to manufacture a baseline.
- If the installed version/commit does not match a published release, inspect its provenance.
  A pre-publication adoption or app merge commit needs the one-time source migration in
  `UPGRADING.md`; do not change the baseline record just to pass the automatic updater.

Use the target's Node major and exact Bun version. The launcher validates and runs the target
tool. Resume retains its pinned source, release metadata and ordered codemods. Do not change
source or target mid-plan; another source requires an explicit trust decision.

## Resolve the specific pending work

Keep app features, branding, ports, cookie prefix, locale overrides and optional-app choices.
Edit only the files named for review. Preserve platform hooks when merging a seam; inspect the
installed/app/target sections rather than blindly choosing one side. Platform files come from
the release; intentional exceptions must remain recorded `PLATFORM-PATCH` entries.

For each item, use its exact report ID and the actions documented in `UPGRADING.md`:

```sh
bun run platform:upgrade --resume upgrade-report.json \
  --resolve 'seam:app.config.ts' --action reviewed \
  --evidence 'Preserved our product identity and incorporated the target configuration change'
```

The example is a seam decision, not a blanket approval. Record evidence for the actual change.
The resolution command only records that item; run `--resume` again to continue.

- **Patches:** compare each patch with the release. Accept the release when it covers the need;
  otherwise choose `reapply-patch` and reapply it when the tool stops after source application.
  Unrecorded platform edits require a correct patch record/removal, a commit and a new plan.
- **Dependencies and env:** inspect the app's usage, preserve compatible higher versions, remove
  old env reads/declarations, and identify dynamic reads. Keep runtime values in deployment
  settings. Never put a secret value in a report, commit, command-line argument or PR.
- **Secrets and data:** use the environment and authorization already supplied by the user.
  If the deployment, required approval or access is missing, ask for that specific prerequisite
  and continue independent source work. Follow the migration's expand/copy/verify/contract
  procedure; pass its read-only completion status with `--migration-evidence`. The updater
  itself never performs data migration or deploys the app.
- **Advisories:** review the actual affected range and fixed version. A recorded decision cannot
  bypass contracts; a target still affected by a high/critical advisory cannot be certified.

For an unknown gate or stale-plan error, preserve the branch and read the diagnostic. Do not
force the report through. An unrelated fix, changed source or unexpected generated file may
require a new plan; retain the failed report as evidence and explain why the scope changed.

## Complete verification and the PR

Resume without `--defer-e2e`, using `CI=true bun run platform:upgrade --resume upgrade-report.json`
for reproducible browser verification (one worker and retries).
The tool repeats installation and all required checks after relocation. Use the project's
documented local Convex/E2E setup; local verification does not
require hosted deployment credentials. Failed checks or pending decisions leave the old
baseline in place. Do not weaken checks to make the update green.

The platform apps ship the instruction files generated by the pinned Next.js version, so
normal dev startup does not create platform-zone edits. App-owned guides remain yours.
If setup changes existing guides, inspect the diff; never delete custom instructions or weaken
the zone check to hide it. Report drift in platform-owned generated blocks to the maintainer.

Completion requires report outcome `verified`, stage `recorded`, the exact target commit in
`.platform-base.json`, and a passing final zone check. Inspect the diff for preserved app
behavior and include both report files, the baseline and regenerated lockfile in the ordinary
commit. Follow the app's before-push checks and update the existing branch without rebasing,
resetting or force-pushing. When pushing is authorized, wait for CI on that exact commit.

Keep a pending update in draft. Once local verification and applicable draft CI pass, update its
description with the resolved gates and evidence and mark it ready. Draft CI may skip browsers:
wait for the `ready_for_review` run on that exact head and require its E2E checks to pass too.
If that run does not start, inspect the app-owned caller triggers and the target's migration
notes; skipped browser jobs are not passing browser evidence. Merge or deploy only within the user's
authorization. Report the target, preserved app choices, verification results and anything
still awaiting an operator; do not describe a draft as an installed upgrade.

## Example task

“Finish the draft platform update PR. Keep our app name, teal branding, ports and cookie prefix;
incorporate the target's configuration change, run the complete verification, and push the
finished branch. Mark it ready after CI passes; do not merge.”
