# Upgrading a business app from the starter

This guide is for a **business app** — a repository that was cloned from
web-app-starter and then diverged — that wants to take a newer starter release.

The general mechanism is git. You merge a starter tag into your app, resolve
conflicts once, and run the health check. There is no published package to bump;
the starter ships source. See [`VERSIONING.md`](./VERSIONING.md) for what the
version numbers promise and [`CHANGELOG.md`](./CHANGELOG.md) for each release.

**An executable narrow rail now exists:** the real `apps/demo` consumes a locked
sidebar-policy source bundle, with app-owned branding and dispatch behavior.
[`docs/foundation-canary.md`](./docs/foundation-canary.md) documents ownership,
enrollment, discovery, planning, actions and executable completion evidence.
`bun run test:foundation-canary` rehearses it without live services. This does not
replace the merge-by-tag process for other foundation areas or `.starter-version`.

Keep three planes separate. The **foundation release plane** publishes an
immutable release with its affected layers, security urgency, migrations,
codemods, verification commands and canary evidence. The **business-app upgrade
plane** takes it in the app's own **explicit upgrade PR**, preserving
application-owned code and passing the app's own checks. The **operations plane**
shows available releases, lagging apps, security urgency and upgrade readiness,
and only **after that PR lands** deploys the resulting commit through the normal
staging and production paths. The operations tool never rewrites application
source or runs hidden migrations during deployment. This tooling neither merges
nor deploys, and does not define the operator journey.

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

If this prints a commit, you are on the rail and every upgrade below is an ordinary
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

**A clean merge is not a safe upgrade.** The two are unrelated, and assuming
otherwise is the single most likely way to ship a broken upgrade. In the validation
run behind this guide, the major release merged with **zero conflicts** and left the
app failing `typecheck` in its own business code, because the starter had renamed a
property on a context object the app reads. Git had nothing to conflict about: the
starter never touched the app's file. The conflict count tells you how much *text*
overlapped. The changelog tells you what *broke*. Read the changelog.

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

When a release's fix lands on a branded line, its **Action required** section says so
and gives you a `grep` that proves you took it. Run that grep. It is the only thing
that distinguishes the two cases reliably, because a reverted fix compiles.

This is a known defect, not a fact of life — Phase 1 of the versioning strategy
replaces all 29 literals with one config value. Until then it is the single largest
source of conflict volume, and it is mechanical.

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

This is not a hypothetical. It is what happened on the first run of this guide, in
all 15 locales, and it is why the resolver exists.

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
still get on the rail:

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
   one. Consumed foundation must match the declared release; vendored/editable UI
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

The historical manual rehearsal described below used throwaway release tags; it
is not the automated canary or a list of currently published starter releases.
The reproducible CI evidence now lives in
[`docs/foundation-canary.md`](./docs/foundation-canary.md) and covers a narrower,
explicit contract rather than claiming to automate this whole historical exercise.

This guide was validated by building a business app on `v1.0.0` — rebranded across all
29 branding files, with its own Convex tables, its own Convex functions, its own i18n
namespace in all 15 locales, and its own `CLAUDE.md` — and then taking three releases.

| Release | Conflicts | Work beyond the merge | `ci:quick` |
|---------|-----------|----------------------|------------|
| `v1.0.1` patch — security fix in `@repo/edge-rate-limit` | 0 | none | green |
| `v1.1.0` minor — auth hardening + new platform table + new locale keys | 18 files | resolver for 15 locales; 3 by hand, all on the hotspot list | green |
| `v2.0.0` major — context property renamed, schema migration | **0** | codemod, then the migration at deploy time | green |

Three things that run is worth knowing about:

- **The minor was the noisy one, the major was the dangerous one.** `v1.1.0` produced
  18 conflicts and every one had a prescribed resolution. `v2.0.0` produced none and
  broke the build.
- **The i18n conflicts were unresolvable by hand at that volume** — 15 files, and the
  obvious resolution silently produced invalid JSON. That is what
  `scripts/resolve-i18n-conflicts.py` is for.
- **One conflict was a security fix disguised as a branding conflict.** The starter
  had wrapped the branded string in a sanitiser; taking the app's side of the line
  reverted the fix, compiled, and passed CI. Only the release's *done when* grep
  caught it.
