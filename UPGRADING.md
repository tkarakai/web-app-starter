# Upgrading a business app from the starter

This guide is for a **business app** — a repository that was cloned from
web-app-starter and then diverged — that wants to take a newer starter release.

The general mechanism is git. You merge a starter tag into your app, resolve
conflicts once, and run the health check. The starter generally ships source rather than published packages. See [`VERSIONING.md`](./VERSIONING.md) for what the
version numbers promise and [`CHANGELOG.md`](./CHANGELOG.md) for each release.

The standalone `apps/demo` also demonstrates one package-based upgrade:
`@repo/starter-sidebar-policy`, consumed from immutable local package artifacts.
Its normal dashboard, editable UI and business behavior remain application-owned.
[`docs/starter-upgrades.md`](./docs/starter-upgrades.md) describes the executable
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
[ownership table and transition rules](./docs/starter-upgrades.md#ownership-who-may-change-each-file).
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
git fetch upstream --tags
```

Verify you share history with the starter:

```bash
git merge-base HEAD upstream/main
```

If this prints a commit, the repositories share history and every upgrade below is an ordinary
merge. If it fails with "no merge base", your app was created by copying files rather
than by cloning — see [Apps with no shared history](#apps-with-no-shared-history).

Record which starter version you are on, so the next upgrade knows where to start:

```bash
echo "STARTER_VERSION=v1.0.0" > .starter-version
git add .starter-version && git commit -m "chore: record starter baseline v1.0.0"
```

---

## Upgrading

### 1. Find out what you are about to take

```bash
git fetch upstream --tags
git tag -l 'v*' --sort=-v:refname | head        # newest starter releases
cat .starter-version                            # where you are now
```

The `'v*'` filter is not decoration. The starter's deploy pipeline also pushes
`deploy/staging/...` and `deploy/production/...` tags — there are dozens of them and
they are not releases. A bare `git tag -l` buries the four tags you care about.

Read every `CHANGELOG.md` entry between your version and the target, not just the
target's. **Do the Action required items for each intermediate release**, even if you
are jumping several versions — they compose, they do not supersede each other.

### 2. Merge the tag, never the branch

```bash
git checkout -b chore/starter-v1.1.0
git merge v1.1.0
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

```bash
echo "STARTER_VERSION=v1.1.0" > .starter-version
git commit -am "chore: upgrade starter to v1.1.0"
git push -u origin chore/starter-v1.1.0
```

---

## Known conflict hotspots

These are the files where upstream and downstream both write. Each has a resolution
that is correct nearly every time — prefer it over reasoning from scratch.

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

### Branding strings

The starter's name appears as a string literal in ~29 files — auth pages, layouts,
sidebars, footers, `packages/backend/convex/auth.ts`, e2e specs, and all 15 locale
files under `packages/i18n/messages/`. Your app changed all of them on day one, so
every one of them conflicts whenever the starter edits the surrounding code.

**Resolution depends on what the starter changed on that line**, and the two cases
look identical in the conflict markers:

- **The starter changed code around the string** — take *their* line and re-apply
  *your* string to it. Keeping your side wholesale silently reverts their change.

  ```diff
  - <<<<<<< HEAD
  -   const base = "Northwind Fleet";
  -   =======
  -   const base = sanitizeIssuerLabel("Web App Starter");
  -   >>>>>>> v1.1.0
  +   const base = sanitizeIssuerLabel("Northwind Fleet");
  ```

  Here the starter added a sanitiser. Taking your own line back would have dropped
  it and left the security fix un-applied while CI stayed green.

- **The starter only changed wording** (`"… Administration"` → `"… Admin Console"`)
  — keep *yours*. Their copy is not better than your copy; it is just theirs.

When a fix changes code around a branded string, follow its **Action required**
notes and run the release's regression check. Inspect the merged expression as
well as the branding; compilation alone does not prove the fix survived.

Centralizing branding configuration remains planned work. Until it is implemented,
review these files explicitly rather than assuming branding is already isolated.

### `packages/backend/convex/schema.ts`

One file holds platform tables and app tables, so your new tables live beside ours.

**Resolution: keep both sides.** Conflicts here are almost always additive — the
starter added a platform table, you added a business table. Take both hunks, keep
your tables and theirs. Then:

```bash
bun run test:convex
```

If the starter's release notes mention a **schema migration**, a merge is not enough —
follow [`docs/convex-migrations.md`](./docs/convex-migrations.md) before deploying.

### `packages/i18n/messages/*.json`

15 locale files in a flat shared namespace; your keys and ours land in the same
objects. Expect all 15 to conflict at once whenever either side adds a key.

**Resolution: run the resolver. Do not hand-merge these, and do not "keep both
sides".**

```bash
./scripts/resolve-i18n-conflicts.py
```

It reads the three merge stages from git, merges the *parsed objects* key by key,
writes the result and `git add`s it. Additions from both sides are kept, a key only
one side changed takes that side's value, and a key both sides changed to different
values is left for you with its exact path printed. `--check` reports without
writing.

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
```

Keys are type-checked against `en.json`, so a dropped key in another locale fails
there rather than at runtime.

### `CLAUDE.md`, `.claude/commands/`, `README.md`

Your app rewrote these and the starter keeps editing them.

**Resolution: keep yours, then read the starter's diff for anything worth adopting:**

```bash
git diff HEAD...v1.1.0 -- CLAUDE.md
```

The starter's conventions sections (commands, directory structure, warnings) are
usually worth porting; its project overview is not.

### `packages/backend/convex/_generated/`

Committed, generated, and edited by both sides: adding any Convex function module
rewrites the sorted import list and the `fullApi` block here.

**Resolution: regenerate, do not hand-merge**, the same discipline as `bun.lock`:

```bash
cd packages/backend && bunx convex codegen
```

This needs `CONVEX_DEPLOYMENT` set. If you are merging without a deployment
configured, keeping both sides *is* correct for this file — it is two sorted lists,
and each side is adding its own entry to both. Verify with `bun run typecheck`, which
fails loudly if a module is listed but missing or missing but referenced. Never edit
it to fix a type error in your own code; fix the code.

### Root `package.json`, the `version` field

The starter's release commit bumps it, so every upgrade brings the starter's version
number into your app's `package.json`.

**Resolution: keep yours.** Your app's version is your app's. The starter version you
are on is recorded in `.starter-version`, which is the file `/upgrade-starter` and
the changelog both read. If you do not version your app separately, taking the
starter's number is harmless — just do it deliberately rather than by accident.

### `.env.example`, `.github/workflows/`, `turbo.json`

**Resolution: take the starter's side, then re-apply your app's additions.** These
are infrastructure files where the starter's version is the maintained one and your
changes are usually a small delta on top.

---

## Apps with no shared history

If `git merge-base` found nothing, your app was created by copying files. You can
still establish shared history:

```bash
git remote add upstream https://github.com/tkarakai/web-app-starter.git
git fetch upstream --tags
git merge v1.0.0 --allow-unrelated-histories
```

This first merge is large and mostly conflicts, because git has no idea which of
your files correspond to which of ours. Resolve it once — keeping your side wherever
the files are genuinely yours — and every subsequent upgrade behaves like a normal
merge.

---

## For coding agents

If you are an agent performing this upgrade, the procedure is:

1. `git fetch upstream --tags`, read `.starter-version`, list intermediate versions
   with `git tag -l 'v*' --sort=v:refname` (the `'v*'` filter matters — deploy tags
   outnumber release tags here by an order of magnitude).
2. Read every `CHANGELOG.md` **Action required** section between the current version
   and the target. Treat them as tasks, not as background reading. They compose
   across intermediate releases; a jump of three versions means doing all three sets,
   in order.
3. `git merge <tag>` on a fresh branch. Never rebase. Never merge `upstream/main`.
4. For each conflicted file, check it against [Known conflict hotspots](#known-conflict-hotspots)
   and apply the prescribed resolution. Do not invent a resolution for a file that is
   on the list. In particular: **run `./scripts/resolve-i18n-conflicts.py` for locale
   files rather than editing them**, and regenerate `bun.lock` rather than merging it.
5. For files not on the list, consult an app's ownership manifest first if it has
   one. Consumed starter code must match the declared release; editable UI
   and app-owned code must not be blindly overwritten. For legacy areas with no
   manifest, review starter changes in platform code (`packages/`, `scripts/`,
   `.github/`) and preserve business changes in app code. Path location alone is
   not permission to discard a downstream customization.
6. Do the action-required items, including running any codemod the release ships in
   `scripts/codemods/`.
7. `bun install`, then `bun run ci:quick`. Do not report success on a merge you have
   not health-checked.
8. Run each release's *done when* check literally, as written, and paste the output.
   They exist because the failure they catch is invisible otherwise.
9. Update `.starter-version` and commit.

**Do not** resolve a conflict by deleting the side you did not write. If you cannot
tell which side is correct, keep both and let the type checker adjudicate — except in
locale files, where keeping both sides produces invalid JSON; use the resolver.

**Do not** treat "merged with no conflicts" as "upgraded successfully". They are
unrelated. A rename in platform code breaks app code without ever conflicting with it.

**Do not** report an upgrade as done with action-required items outstanding. If one
cannot be completed, stop and say which and why.

**Do not** run `bun test` bare — use `bun run test`.

---

## What a real upgrade looked like

The reproducible example uses the actual demo dashboard, not a minimal test app.
Run it with `bun run test:starter-rehearsal`. It copies the demo and starts from
sidebar-policy package `1.0.0`; these are local package test versions, not starter
git release tags.

| Step | What happens | Observable result |
|---|---|---|
| Establish the baseline | Install historical package `1.0.0` in the app copy | Dispatch tests and typecheck pass. Two sidebar tests fail on invalid width input. |
| Discover and plan | Select the declared `1.0.1` upgrade | The plan lists package file hashes, affected area, urgency and required checks. |
| Apply | Replace only the known package payload | Lock status is `pending`; no success is claimed yet. |
| Verify | Run the sidebar regression action, business tests, types and production build | All pass; the invalid resize now uses the existing 16rem default. |
| Audit and compare | Check retained logs/output hashes and compare application source | Dashboard build exists; editable UI, business rules, tests, configuration and branding are unchanged. |

Evidence is written to `.ci-local-artifacts/starter-upgrade/report.json`, with
command logs and the built dashboard retained beside it. CI uploads this evidence.
A missing action, source change, local package edit or stale build prevents the
upgrade from being reported as verified.

This is the supported package workflow: prepare a release, review an application
change, then verify it against that application's behavior. It neither merges an
application PR nor deploys. Backend/schema/i18n upgrades still require the manual
release-specific work described earlier; this example does not claim to test them.
