# Upgrading a business app from the starter

This guide is for a **business app** — a repository that was cloned from
web-app-starter and then diverged — that wants to take a newer starter release.

The general mechanism is git. You merge a starter tag into your app, resolve
conflicts once, and run the health check. The starter generally ships source rather than published packages. See [`VERSIONING.md`](./VERSIONING.md) for what the
version numbers promise and [`CHANGELOG.md`](./CHANGELOG.md) for each release.

**First release:** this revision prepares `v1.0.0`. It becomes available only once
its tag is published on `main`. Verify availability
with the discovery commands below. Until then, record the exact starter source
commit in bootstrap notes; preparation is not publication or application adoption.

The standalone `apps/demo` also demonstrates one package-based upgrade:
`@web-app-starter/starter-sidebar-policy`, consumed from immutable local package artifacts.
Its normal dashboard, editable UI and business behavior remain application-owned.
[`apps/demo/README.md`](../apps/demo/README.md) describes the executable
ownership contract and its limits. `bun run test:starter-rehearsal` tests an upgrade
on a copy without live services. Other starter areas still use merge-by-tag.

## Three separate responsibilities

Releasing starter code, changing an application, and deploying it are separate
jobs. They have different owners and outputs. A release is not an application
upgrade, and an application upgrade is not a deployment.

### 1. Starter releases: prepare an update others can adopt

- **Purpose:** provide a known version and explain how to adopt it.
- **Owner:** starter maintainers.
- **Inputs:** reviewed starter changes, supported starting versions, regression
  tests and a customized demonstration application.
- **Outputs:** an immutable release, affected areas, security urgency, required
  migrations/codemods (or an explicit statement that none are needed), verification
  commands and upgrade-rehearsal results.
- **Boundary:** publishing a release cannot edit a business application's files
  or deploy it. Package contents must not depend on application-owned code.
- **Example:** maintainers fix non-finite sidebar widths, build package `1.0.1`,
  declare the supported `1.0.0` starting version and regression action, then run
  the demo rehearsal. The fixture catalogue and CI evidence record this result.
  These local package versions are not published starter git tags.

### 2. Application upgrade PRs: adopt an update deliberately

- **Purpose:** make a starter release work with one application's customizations.
- **Owner:** the application team.
- **Inputs:** the release, current baseline, ownership manifest, application source
  and application-specific tests.
- **Outputs:** a reviewed code-change PR, updated dependency/baseline, completed
  required actions and verification evidence for that exact application source.
- **Boundary:** application code is never automatically replaced by a package
  payload. Consumed code must match its known baseline. Editable copies need a
  separate supported copy/update contract; they cannot silently become managed.
- **Example:** the Northstar demo discovers `1.0.1`, reviews a plan, replaces only
  its consumed sidebar package and runs regression tests, dispatch tests, types
  and build. Its customized UI, freight ordering and logo remain unchanged. The
  application team reviews and merges that change through its normal process.

### 3. Operations deployment: deploy the approved application

- **Purpose:** make an approved application revision available in an environment.
- **Owner:** application operators under the existing deployment approvals.
- **Inputs:** the merged application commit, deployment configuration and relevant
  upgrade/migration evidence.
- **Outputs:** staging/production deployments and deployment records. An operations
  view may show available starter releases, applications behind those releases,
  security urgency and upgrade readiness.
- **Boundary:** operations may consume evidence, but must not rewrite application
  source or perform hidden migrations during deployment. Any required migration
  must be explicit, reviewed and separately evidenced.
- **Example:** after the demo-shaped application's upgrade PR is approved and
  merged, operations deploys that resulting commit through the ordinary staging
  and production path. Merely finding a newer starter release does not trigger
  source edits or deployment. This revision adds no operations integration.

### Code ownership is a separate distinction

Within these responsibilities, files may be **consumed starter code**,
**application-owned**, **generated**, or eventually **intentionally vendored**
(editable starter copies with a supported origin/update contract). See the
[ownership table](../apps/demo/README.md#where-to-make-changes).
The sidebar policy is the only proven package boundary today. Backend schemas,
locale content and much shared UI still mix concerns; we do not claim otherwise.
Vendoring is not supported yet, and no demo file is labeled both managed and
editable. `bun run check:starter-ownership` validates the supported boundary.

---

## One-time setup

If your app was cloned from the starter, `origin` probably still points at the
starter. Create your own empty repository first, then repoint `origin` at it and
keep the starter as `upstream`:

```bash
git remote rename origin upstream          # if origin is still the starter
git remote add origin git@github.com:your-org/your-app.git
git push -u origin main
```

If your app already has its own `origin`, just add the remote:

```bash
git remote add upstream https://github.com/tkarakai/web-app-starter.git
git fetch upstream --no-tags 'refs/heads/main:refs/remotes/upstream/main' 'refs/tags/v*:refs/tags/starter/v*'
```

Verify you share history with the starter:

```bash
git merge-base HEAD upstream/main
```

If this prints a commit, the repositories share history and every upgrade below is an ordinary
merge. If it fails with "no merge base", your app was created by copying files rather
than by cloning — see [Apps with no shared history](#apps-with-no-shared-history).

Once a starter release exists, establish which release your app actually includes
before recording `.starter-version`. Resolve `refs/tags/starter/<tag>^{commit}`
with `git rev-parse` to obtain the exact target commit. Check its source history and required actions;
a merge base alone does not prove adoption. Use the verified tag below, not an
assumed first version:

```bash
printf 'STARTER_VERSION=%s\nSTARTER_COMMIT=%s\n' \
  "<verified-starter-release-tag>" "<verified-starter-commit>" > .starter-version
git add .starter-version && git commit -m "chore: record verified starter baseline"
```

---

## Upgrading

### 1. Find out what you are about to take

```bash
git fetch upstream --no-tags 'refs/heads/main:refs/remotes/upstream/main' 'refs/tags/v*:refs/tags/starter/v*'
git tag -l 'starter/v*' --sort=-v:refname | head        # newest starter releases
cat .starter-version                            # where you are now
```

Starter tags live locally under `starter/v*`, so an application can also have
its own `v1.0.0`. Fetch explicitly with `--no-tags` as above; never force-update
a previously fetched release tag. Deployment tags are excluded.

Read every `CHANGELOG.md` entry between your version and the target, not just the
target's. **Do the Action required items for each intermediate release**, even if you
are jumping several versions — they compose, they do not supersede each other.

### 2. Merge the tag, never the branch

```bash
git checkout -b chore/starter-v1.1.0
git merge refs/tags/starter/v1.1.0
```

**Merge, do not rebase.** Rebasing replays each of your commits onto the new starter
code, so a conflict in a file you touched 40 times is a conflict you resolve 40 times,
and it rewrites history your team has already pushed. A merge resolves each conflict
once.

**Merge the tag, not `upstream/main`.** A tag is a tested, changelogged point that
someone wrote upgrade notes for. `upstream/main` is whatever landed an hour ago.

### 3. Resolve conflicts

See [Known conflict hotspots](#known-conflict-hotspots) below — most of what you hit
is on that list and has a prescribed resolution.

### 4. Do the action-required items

Not after the health check — before it. Most of them exist precisely because the
merge alone leaves the tree broken, so running CI first just tells you something you
already know.

### 5. Health check

```bash
bun install          # always, after any merge that touched bun.lock or package.json
bun run ci:quick     # lint, typecheck, unit + component + backend tests, builds
```

`ci:quick` skips E2E. Run the full `bun run ci` before you merge the upgrade branch
to your `main`.

**`ci:quick` cannot check everything.** It runs against your working tree with no
Convex deployment, so anything that is only true after a deploy — a schema migration
having actually run, a new environment variable being set — is outside its reach.
Release notes separate the two: a *done when* that names a `bun run` command is a
merge-time check, and a *done when* that names `npx convex run` or a deployed URL is
a deploy-time check you owe before shipping, not before landing the branch.

**A merge without conflicts still needs verification.** For example, renaming a
starter API can break application code even when git can merge every file.
Read the release's required actions, then run type checks and behavior tests for
the application. Conflict counts do not show whether an upgrade works.

### 6. Record and land

Record source adoption only after all applicable source checks pass. List any
remaining deployment/migration actions in the PR; this baseline is not evidence
that those actions have run. Keep the upgrade PR and check results as evidence.

```bash
printf 'STARTER_VERSION=%s\nSTARTER_COMMIT=%s\n' \
  "v1.1.0" "$(git rev-parse refs/tags/starter/v1.1.0^{commit})" > .starter-version
git add .starter-version
git commit -am "chore: upgrade starter to v1.1.0"
git push -u origin chore/starter-v1.1.0
```

---

## Known conflict hotspots

These are areas where starter and application changes may overlap. Use the guidance
to structure review; file location alone does not determine the correct resolution.

### `bun.lock`

**Never hand-edit it, and never try to merge it.** Take either side wholesale and
regenerate:

```bash
git checkout --theirs bun.lock     # "theirs" = the starter's version
bun install                        # regenerates from the merged package.json files
git add bun.lock
```

The regenerated file is the only one that is actually correct; whichever side you
checked out is just a starting point `bun install` overwrites.

### Branding strings and `app.config.ts`

The product name, legal entity, local ports, auth cookie prefix, brand assets and
optional feature switches live in the root `app.config.ts`, which your app owns.
Starter code reads them from there, so a starter release that touches a page,
script or workflow no longer conflicts with your name, ports or cookie prefix.
Keep your values when `app.config.ts` itself conflicts; take any new settings the
release adds (validation names each missing one).

The product name is not a translation. Messages that mention it take it as the
`{productName}` argument, and no locale file contains it. If your locale files
still carry `common.appName` or your name in prose, move the name to
`identity.productName` and use `{productName}` in those messages.

Neither changing a translation nor editing the same file guarantees a merge
conflict. When edits do overlap, preserve application wording, required message
keys and interpolation parameters, and any accompanying code fixes. Follow the
locale merge procedure below and the release's action-required checks.

### `packages/backend/convex/schema.ts`

One file holds platform tables and app tables, so your new tables live beside ours.

**Resolution: review the schema changes on both sides.** Independent new tables
can usually be retained together. Edits to the same table, field, validator or index
need a deliberate combined definition and may require a data migration. Do not
blindly concatenate conflicting hunks. Then:

```bash
bun run test:convex
```

If the starter's release notes mention a **schema migration**, a merge is not enough —
follow [`platform/docs/convex-migrations.md`](./docs/convex-migrations.md) before deploying.

### `platform/packages/i18n/messages/*.json`

The 15 locale files are intentionally customizable. The starter expects its
message keys and interpolation parameters to remain available; business apps may
change translated values and add their own keys. The application team owns
keeping these files consistent and resolving overlaps during upgrades. Changes
to different keys can merge cleanly; conflicts are possible, not automatic.

**Resolution: use the resolver for conflicted locale files, then review its
decisions.** Manual resolution is also valid when the resulting JSON, required
keys and message parameters are checked. Do not blindly concatenate conflict
hunks with an editor's "keep both sides" action.

```bash
./platform/tooling/node-ts.sh platform/tooling/resolve-i18n-conflicts.ts
```

It reads the three merge stages from git, merges the *parsed objects* key by key,
writes the result and `git add`s it. Additions from both sides are kept, and a key
only one side changed takes that side's value. For conflicting values, it stages
your value, prints the exact key path and exits with status 1. Review each reported
key before committing; the staged file no longer appears as an unmerged file.
`--check` reports without writing or staging. Run through the wrapper directly so
an unresolved root `package.json` does not prevent the resolver from starting.

Delete/edit disagreements (including whole namespaces) also exit with status 1
and retain your side, including your deletion. They always need review. A zero
exit status only means there were no conflicting parsed values; it does not
validate the target release’s required message keys or ICU parameters.

**Why not "keep both sides" here.** It is the right instinct and it produces a file
that is not JSON. The closing brace of a namespace is usually *shared context* that
sits outside the conflict markers, so concatenating the two sides grafts their
bodies together:

```json
  "fleet": {
    "title": "Fleet",
    "depot": "Depot"        <- ours, never terminated
  "security": {             <- theirs, now nested inside ours
    "revoke": "Revoke"
  }
```

The resolver avoids this structural problem by merging parsed JSON values rather
than concatenating text.

Then verify:

```bash
bun run typecheck
bun run --cwd apps/web test
```

The catalog tests compare every supported locale with the merged `en.json` and
check ICU parameters. Typechecking alone does not validate all locale catalogs.
Also check the target release's required keys and parameters: deleting the same key
from English and every other locale would evade the current parity test.

### `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `docs/`, `README.md`

Agent instructions come in two layers:

- **Root `AGENTS.md` and `CLAUDE.md`** are your app's guide. They start from
  `platform/templates/` and are yours after that.
- **`platform/AGENTS.md`, `platform/docs/` and `platform/agent-skills/`** are the platform's
  usage guide and skills. They describe the installed platform version and belong to the release.

**Resolution: keep your root `AGENTS.md`, `CLAUDE.md` and `docs/`; take the release's
`platform/` directory as it is.** Your root `CLAUDE.md` should import both files:

```text
@AGENTS.md
@platform/AGENTS.md
```

and your root `AGENTS.md` should open with "Before any task, read `platform/AGENTS.md`."
Move any platform rules your root file still repeats out of it; `platform/AGENTS.md` now
carries them and stays current with each upgrade.

Take the release's `.claude/skills/platform-*` and `.agents/skills/platform-*` links as they
are; keep your own skills and commands. When you come from a release that kept its guides in
`docs/` and `docs/claude/`, delete those copies: they moved to `platform/docs/`.

### `packages/backend/convex/_generated/`

Committed, generated, and edited by both sides: adding any Convex function module
rewrites the sorted import list and the `fullApi` block here.

**Resolution: regenerate, do not hand-merge**, the same discipline as `bun.lock`:

```bash
cd packages/backend && bunx convex codegen
```

This needs the appropriate Convex deployment/configuration. If it is unavailable,
record regeneration as unfinished rather than claiming hand-merged generated code
is verified. After regeneration, run `bun run typecheck`. Never edit generated files
to fix a type error in application code; fix the source instead.

### Root `package.json`, the `version` field

The starter's release commit bumps it, so every upgrade brings the starter's version
number into your app's `package.json`.

**Resolution: keep yours.** Your app's version is your app's. The starter version you
are on is recorded in `.starter-version`, which is the file `/upgrade-starter` and
the changelog both read. If you do not version your app separately, taking the
starter's number is harmless — just do it deliberately rather than by accident.

### `.env.example`, `.github/workflows/`, `turbo.json`

**Resolution: review both changes.** Preserve application deployment targets,
environment choices and secrets references while adopting relevant starter fixes.
Do not replace business infrastructure just because the starter changed its own.

---

## Apps with no shared history

If `git merge-base` found nothing, your app was created by copying files. You can
still establish shared history:

```bash
git remote add upstream https://github.com/tkarakai/web-app-starter.git
git fetch upstream --no-tags 'refs/heads/main:refs/remotes/upstream/main' 'refs/tags/v*:refs/tags/starter/v*'
git merge refs/tags/starter/v1.0.0 --allow-unrelated-histories
```

This first merge is large and mostly conflicts, because git has no idea which of
your files correspond to which of ours. Resolve it once — keeping your side wherever
the files are genuinely yours — and every subsequent upgrade behaves like a normal
merge.

---

## For coding agents

If you are an agent performing this upgrade, the procedure is:

1. `git fetch upstream --no-tags 'refs/heads/main:refs/remotes/upstream/main' 'refs/tags/v*:refs/tags/starter/v*'`, read `.starter-version`, list intermediate versions
   with `git tag -l 'v*' --sort=v:refname` (the `'v*'` filter matters — deploy tags
   outnumber release tags here by an order of magnitude).
2. Read every `CHANGELOG.md` **Action required** section between the current version
   and the target. Treat them as tasks, not as background reading. They compose
   across intermediate releases; a jump of three versions means doing all three sets,
   in order.
3. `git merge refs/tags/starter/<tag>` on a fresh branch. Never rebase. Never merge `upstream/main`.
4. For each conflicted file, check it against [Known conflict hotspots](#known-conflict-hotspots)
   and review both sets of changes. For locale files, use the resolver where useful
   and inspect its reported disagreements; reviewed manual JSON
   resolution is supported. Regenerate `bun.lock` rather than hand-merging it.
5. For files not on the list, consult an app's ownership manifest first if it has
   one. Consumed starter code must match the declared release; editable UI
   and app-owned code must not be blindly overwritten. For legacy areas with no
   manifest, review starter changes in platform code (`packages/`, `platform/tooling/`,
   `.github/`) and preserve business changes in app code. Path location alone is
   not permission to discard a downstream customization.
6. Do the action-required items, including running any codemod the release ships in
   `platform/tooling/codemods/`.
7. `bun install`, then `bun run ci:quick`. Do not report success on a merge you have
   not health-checked.
8. Run each release's *done when* check literally, as written, and paste the output.
   They exist because the failure they catch is invisible otherwise.
9. Update `.starter-version` and commit.

**Do not** resolve a conflict by deleting the side you did not write, or by blindly
keeping both. Establish the intended combined behavior from the app requirements
and release notes, then verify it. Typechecking cannot decide ownership or detect
every lost behavior or data migration.

**Do not** treat "merged with no conflicts" as "upgraded successfully". They are
unrelated. A rename in platform code breaks app code without ever conflicting with it.

**Do not** report an upgrade as done with action-required items outstanding. If one
cannot be completed, stop and say which and why.

**Do not** run `bun test` bare — use `bun run test`.

---

## Verification evidence and limits

Locale merging has automated tests in `platform/tooling/tests/resolve-i18n-conflicts.test.ts`.
They use isolated Git repositories and include refusal paths and overlapping
application translations. Run them through `bun run test:dev-scripts`.

Earlier versions of this guide described an ad hoc, whole-source rehearsal using
practice tags named `v1.0.0` through `v2.0.0`. Those were not published releases,
and no repeatable fixture or retained CI evidence supports treating that narrative
as current release verification. A full customized-app source/schema migration
rehearsal remains follow-up work. The repeatable app rehearsal below covers one
package only.

### Upgrading a versioned starter package in the demo app

**What was tested.** The real demo dashboard (`apps/demo`), with its own branding,
freight rules and editable UI, is copied and started from sidebar-policy package
`1.0.0`. It is then upgraded to `1.0.1`. Run it yourself with
`bun run test:starter-rehearsal`. These are local package versions, not starter git
tags.

| Step | What happens | What you can check |
|---|---|---|
| Start from the old version | Install package `1.0.0` in the copy | Dispatch tests and typecheck pass. Two sidebar tests fail on an invalid width. |
| Find and plan the upgrade | Select the declared `1.0.1` release | The plan lists the package file hashes, affected area, urgency and required checks. |
| Apply | Replace only the package files | The lock file says `pending`; the upgrade is not reported as done yet. |
| Verify | Run the sidebar regression check, business tests, typecheck and production build | All pass; an invalid width now falls back to the 16rem default. |
| Audit and compare | Recheck the saved logs and output hashes, and compare app source | The dashboard builds; editable UI, business rules, tests, configuration and branding are unchanged. |

See [the demo rehearsal guide](../apps/demo/README.md#test-a-starter-upgrade)
for evidence locations. A skipped required check, a changed
source file, a locally edited package or an outdated build stops the upgrade
from being reported as verified.

This example covers one package only. It does not merge a PR or deploy anything,
and it does not test backend, schema or i18n changes. Those still use the
merge-by-tag steps above.
