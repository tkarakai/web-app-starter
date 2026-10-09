# PR-first adoption and repository workflow

Start adoption and ordinary app work on a task branch. Open a draft PR early and keep app
commits off the default branch unless the owner explicitly authorizes that individual exception.
Authors may update PRs; an owner or independent reviewer decides the merge. Explicit per-PR
owner authorization may permit an agent to merge after all required evidence passes. Bootstrap
never grants automatic or standing merge authority.

## Empty and existing repositories

Create an empty target GitHub repository first and authenticate `gh`. Clone an actually
published starter release, install its pinned dependencies, then run:

```sh
bun run adopt --repo owner/app --name 'My App' --bootstrap --updates deferred --yes
```

Adoption verifies the target through GitHub and Git before changing files. A failed repository
or remote query stops; it is never treated as an empty repository. `--bootstrap` creates an
empty local root commit and `bootstrap/adopt-my-app`, imports the verified starter onto that
branch and applies adoption there. It performs no remote push. Its output gives the exact,
separate commands to push only the empty base to the target default branch, commit/review the
adoption, push the task branch, and open a draft PR against that default branch. Use those
commands; pushing the adoption head to the default branch would bypass its review.

For an existing repository, create the adoption branch before importing the release and follow
[existing-repository adoption](../README.md#existing-repositories). Adoption refuses to edit on
the live default branch. `--allow-default-branch` is an explicit owner-authorized bypass that
prints its review consequence; it is never implied by `--yes`. Detached existing-release
checkouts get a task branch. A repository with other branches but a missing default branch
needs the owner to choose its default before adoption; it is not an empty target.

## Inspect live readiness

```sh
bun run platform:setup-repository --repo owner/app --check --json
```

This command is read-only. It reads actual GitHub repository settings, classic protection,
effective active rulesets including inherited organization rules and their bypass authority,
PR check publishers, the E2E repository variable and the app-owned owner policy. Workflow files
or saved intent alone cannot prove enforcement. It reports each control and whether GitHub
can enforce it:

| Result | Meaning |
| --- | --- |
| `enforced` | Live PR, history, freshness and required-check controls match the selected owner policy; merge/deletion and auto-merge settings are verified. E2E enforcement is reported separately. |
| `policy-only` | A private Free owner plan and unsupported protection APIs are positively verified. The workflow remains a documented team policy. |
| `incomplete` | Settings or discovered contexts are missing, contradictory, malformed or unavailable. Authentication/API ambiguity fails closed. |

The inventory includes default branch, sole squash merge, head deletion, PR requirement,
linear history, approval count and stale-review dismissal, administrators/bypass authority,
strict up-to-date checks, installed app completion contexts, Security Complete, public CodeQL,
E2E policy and named maintenance authority. Inspect the per-control results and reasons rather
than assuming an overall status means E2E is enabled. `off` still requires full local E2E before
merge; GitHub does not enforce that choice.

On private Free, deployment still verifies its immutable selected commit with E2E. That gate
does not prevent direct pushes or unsafe PR merges. Use independent review and explicit owner
merge authority, or choose a plan/visibility supporting protection. Unknown access errors are
not proof that protection is unsupported. [GitHub documents protection availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## First-PR discovery and consented setup

1. Push the minimum base deliberately, then the adoption branch and open the draft PR using
   adoption's exact commands. Draft PRs run non-E2E checks and remain reviewable.
2. Once CI publishes check contexts, resume setup with the actual PR number:

   ```sh
   bun run platform:setup-repository --repo owner/app --discover-pr 1 \
     --approvals 1 --dismiss-stale-reviews --yes
   ```

   Choose the approval count deliberately; `--keep-stale-reviews` is an explicit alternative.
   The command verifies contexts against the PR head/merge and their Actions/CodeQL publishers,
   stores public discovery in `.github/repository-workflow.json`, and shows the requested changes
   before owner consent. Missing/ambiguous contexts remain pending. Rerun the same command to
   resume; check mode never saves or mutates settings.
3. Setup adds or strengthens a dedicated supplemental default-branch ruleset, keeping existing
   classic protections, inherited rules, stronger approvals, restrictions and custom callers.
   It selects squash-only/deletion settings. `--e2e always|on-demand|off` and
   `--disable-auto-merge` are separate explicit choices; existing credentials and unrelated
   permissions are preserved. Without explicit setup consent, the helper does not write remote
   settings. Commit the public policy/discovery on the task branch and review it in the PR.
4. Run `CI=true bun run ci` locally with E2E. Follow the live
   [ready/label process](ci-github.md#e2e-on-pull-requests): ready the draft for `always`, or add
   `run-e2e` for `on-demand`. Check final-head required hosted CI, then obtain independent review
   and the owner/reviewer merge decision.

Resuming discovers live contexts again; a saved PR number or policy is not proof that current
settings or publishers are valid. Run the read-only check after setup and before relying on it.
Deployment setup uses the same repository controls and consent boundary, while deployment
accounts, domains and immutable commit serving proof remain separate work.

## Maintenance and credentials

Auto-merge is off for bootstrap and feature PRs. Do not enable a blanket agent exception.
The shipped Renovate preset and self-hosted workflow require review, including eligible
patch/minor dependency PRs. Existing credentials are preserved; they are not a merge grant.

A platform updater may arm squash auto-merge only for an existing mechanically eligible
verified update, under an owner-reviewed record naming its exact GitHub App bot login, App ID,
`kind: "platform-update"` and `policy: "patch"` or `"minor"`. The caller must explicitly select
that policy and `auto-merge: true`; the repository must separately permit auto-merge. Owners
must review and commit this policy on the default branch before it can authorize delivery.
No feature PR, major, migration, environment gate, advisory-review gate or draft qualifies.

Use the [repository-only updater App](setup-updates.md#dedicated-updater-app) rather than a
personal token for this authority. Its normal write grants stay limited to Contents, Pull
requests, Workflows and Issues. For maintenance enforcement inspection, the owner may separately
approve **Administration, Checks and Variables read-only** for enforcement, PR-context and
policy inspection; setup never requests or escalates those grants automatically.
Write administration and unrelated grants are refused. The inline publisher reads committed
base policy and live classic/effective ruleset controls, checks exact discovered publishers and
requires strict E2E/check protection with no bypass authority. It executes no app/artifact
scripts with the write credential. Unknown scope, unavailable APIs or missing enforcement
visibly denies auto-merge while leaving the PR for review.

`--maintenance-bot 'exact-app[bot]'` is a read-only authorization probe. It also needs the active
credential to prove that exact repository-only App installation and the committed constrained
caller; an owner's PAT or a secret name cannot prove bot authority. Private Free and E2E `off`
always deny maintenance auto-merge. Preserve credentials on failure and repair only the
reported prerequisite with owner consent.
