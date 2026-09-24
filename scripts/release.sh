#!/usr/bin/env bash
#
# Cut a starter release: verify, bump, promote the changelog, tag.
#
# Usage: ./scripts/release.sh 1.2.0
#        ./scripts/release.sh 1.2.0 --dry-run
#        ./scripts/release.sh 1.2.0 --allow-branch        # tag from a non-main branch
#        ./scripts/release.sh 1.2.0 --allow-unpublished   # tag off unpushed history
#
# Enforces the policy in VERSIONING.md:
#   - clean working tree
#   - on main (unless --allow-branch)
#   - HEAD is already on origin/main (unless --allow-unpublished)
#   - version strictly greater than the latest existing tag
#   - CHANGELOG.md has an "## [Unreleased]" section with content to promote,
#     including an "### Action required" section for every major
#
# On the published-history check: a release tag has to name a commit that is
# reachable from origin/main, because UPGRADING.md tells business apps to
# `git merge <tag>`. Tag a PR branch instead and the squash-merge leaves the tag
# pointing at commits that never land in main — a downstream merge then pulls that
# whole branch in as a parallel history. This has happened once; hence the check.
#
# A checkout with no `origin/main` (a throwaway clone used to rehearse an upgrade)
# skips the check automatically, which is the right place to cut practice tags.
#
# The push is deliberately NOT automated. Run it yourself when you are ready:
#   git push origin main --follow-tags

set -euo pipefail

VERSION="${1:-}"
DRY_RUN=false
ALLOW_BRANCH=false
ALLOW_UNPUBLISHED=false

for arg in "${@:2}"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --allow-branch) ALLOW_BRANCH=true ;;
    --allow-unpublished) ALLOW_UNPUBLISHED=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

die() { echo "release: $*" >&2; exit 1; }

[[ -n "$VERSION" ]] || die "usage: ./scripts/release.sh <version> [--dry-run] [--allow-branch] [--allow-unpublished]"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be MAJOR.MINOR.PATCH, got '$VERSION'"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TAG="v$VERSION"

# --- verify ----------------------------------------------------------------

[[ -z "$(git status --porcelain)" ]] || die "working tree is dirty; commit or discard first"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" && "$ALLOW_BRANCH" == false ]]; then
  die "on '$BRANCH', not main. Releases are cut from main (override: --allow-branch)"
fi

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists"

# HEAD must already be part of origin/main, so the tag survives a squash merge.
if git rev-parse -q --verify refs/remotes/origin/main >/dev/null; then
  git fetch -q origin main 2>/dev/null || echo "release: could not fetch origin/main, using the local copy" >&2
  if ! git merge-base --is-ancestor HEAD refs/remotes/origin/main; then
    if [[ "$ALLOW_UNPUBLISHED" == false ]]; then
      die "HEAD ($(git rev-parse --short HEAD)) is not reachable from origin/main.
       A tag here would not survive a squash merge: business apps merge tags, and
       the tagged commits would never reach main. Land the work on main first, then
       cut the tag from an up-to-date main.
       To rehearse a release, use a throwaway clone with no origin (override here:
       --allow-unpublished)"
    fi
    echo "release: WARNING HEAD is not on origin/main; tagging anyway (--allow-unpublished)" >&2
  fi
else
  echo "release: no origin/main — treating this as a throwaway checkout" >&2
fi

LATEST="$(git tag -l 'v*' --sort=-v:refname | head -n1)"
if [[ -n "$LATEST" ]]; then
  # sort -V puts the smaller first; the new version must not be <= the latest
  if [[ "$(printf '%s\n%s\n' "${LATEST#v}" "$VERSION" | sort -V | tail -n1)" != "$VERSION" \
     || "${LATEST#v}" == "$VERSION" ]]; then
    die "$VERSION does not come after the latest tag $LATEST"
  fi
fi

grep -q '^## \[Unreleased\]' CHANGELOG.md || die "CHANGELOG.md has no '## [Unreleased]' section"

UNRELEASED_BODY="$(awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md | tr -d '[:space:]')"
[[ -n "$UNRELEASED_BODY" ]] || die "CHANGELOG.md '## [Unreleased]' is empty — nothing to release"

MAJOR="${VERSION%%.*}"
PREV_MAJOR="${LATEST#v}"; PREV_MAJOR="${PREV_MAJOR%%.*}"
if [[ -n "$LATEST" && "$MAJOR" != "$PREV_MAJOR" ]]; then
  awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md \
    | grep -q '^### Action required' \
    || die "$VERSION is a major bump but '## [Unreleased]' has no '### Action required' section (VERSIONING.md)"
fi

echo "release: $TAG from $BRANCH — checks passed"
if [[ "$DRY_RUN" == true ]]; then
  echo "release: dry run, stopping before any change"
  exit 0
fi

# --- apply -----------------------------------------------------------------

TODAY="$(date +%Y-%m-%d)"
# `|| true`: under `set -o pipefail` a missing `origin` fails the whole pipeline,
# which would abort the release instead of falling through to the default below.
REPO_URL="$(git remote get-url origin 2>/dev/null | sed -e 's#git@github.com:#https://github.com/#' -e 's#\.git$##' || true)"
REPO_URL="${REPO_URL:-https://github.com/tkarakai/web-app-starter}"

# package.json version.
# node, not sed: BSD sed silently no-ops on the GNU `0,/re/` address, so the
# bump appeared to succeed while leaving the version untouched.
VERSION="$VERSION" node -e '
const fs = require("node:fs");
const assert = require("node:assert");
const version = process.env.VERSION;
const src = fs.readFileSync("package.json", "utf8");
const pattern = /"version":\s*"[^"]*"/;
assert(pattern.test(src), "package.json has no version field");
const next = src.replace(pattern, `"version": "${version}"`);
assert.equal(JSON.parse(next).version, version, "rewrite produced the wrong version");
fs.writeFileSync("package.json", next);
'

# promote Unreleased -> [VERSION] - DATE, and add a fresh empty Unreleased
tmp="$(mktemp)"
awk -v ver="$VERSION" -v today="$TODAY" '
  /^## \[Unreleased\]/ {
    print "## [Unreleased]"; print ""; print "## [" ver "] - " today
    next
  }
  { print }
' CHANGELOG.md > "$tmp"
mv "$tmp" CHANGELOG.md

# refresh the link definitions at the bottom
tmp="$(mktemp)"
grep -v '^\[Unreleased\]:' CHANGELOG.md | grep -v "^\[$VERSION\]:" > "$tmp"
{
  # keep the link definitions as their own block
  [[ -n "$(tail -n1 "$tmp")" ]] && echo "" || true
  echo "[Unreleased]: $REPO_URL/compare/$TAG...HEAD"
  if [[ -n "$LATEST" ]]; then
    echo "[$VERSION]: $REPO_URL/compare/$LATEST...$TAG"
  else
    echo "[$VERSION]: $REPO_URL/releases/tag/$TAG"
  fi
} >> "$tmp"
mv "$tmp" CHANGELOG.md

git add package.json CHANGELOG.md
git commit -m "chore(release): $TAG"
git tag -a "$TAG" -m "$TAG"

echo
echo "release: tagged $TAG"
echo "release: review with  git show $TAG"
echo "release: publish with git push origin $BRANCH --follow-tags"
