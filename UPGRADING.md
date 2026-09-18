# Upgrading a business app from the starter

This guide is for a **business app** — a repository that was cloned from
web-app-starter and then diverged — that wants to take a newer starter release.

The mechanism is git. You merge a starter tag into your app, resolve conflicts once,
and run the health check. There is no package to bump; the starter ships source you
own. See [`VERSIONING.md`](./VERSIONING.md) for what the version numbers promise and
[`CHANGELOG.md`](./CHANGELOG.md) for what each release contains.

---

## One-time setup

If your app was cloned from the starter, `origin` probably still points at the
starter. Repoint `origin` at your own repository and add the starter as `upstream`:

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

### 4. Health check

```bash
bun install          # always, after any merge that touched bun.lock or package.json
bun run ci:quick     # lint, typecheck, unit + component + backend tests, builds
```

`ci:quick` skips E2E. Run the full `bun run ci` before you merge the upgrade branch
to your `main`.

### 5. Record and land

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

**Resolution: keep your branding, take the starter's surrounding change.** In practice
this means resolving in favour of *your* side for the string and *their* side for
structure. When both changed on the same line, take their line and re-apply your
string to it.

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
objects.

**Resolution: keep both sides**, exactly as with `schema.ts`. Then verify no locale
was left short:

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

1. `git fetch upstream --tags`, read `.starter-version`, list intermediate versions.
2. Read every `CHANGELOG.md` **Action required** section between the current version
   and the target. Treat them as tasks, not as background reading.
3. `git merge <tag>` on a fresh branch. Never rebase. Never merge `upstream/main`.
4. For each conflicted file, check it against [Known conflict hotspots](#known-conflict-hotspots)
   and apply the prescribed resolution. Do not invent a resolution for a file that is
   on the list.
5. For files not on the list: the general rule is **take the starter's side in
   platform code** (`packages/`, `scripts/`, `.github/`) and **your side in app code**
   (`apps/*/src/app`, `apps/*/src/components` for anything you wrote).
6. `bun install`, then `bun run ci:quick`. Do not report success on a merge you have
   not health-checked.
7. Update `.starter-version` and commit.

**Do not** resolve a conflict by deleting the side you did not write. If you cannot
tell which side is correct, keep both and let the type checker adjudicate.

**Do not** run `bun test` bare — use `bun run test`.
