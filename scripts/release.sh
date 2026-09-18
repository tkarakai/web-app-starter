#!/usr/bin/env bash
#
# Cut a starter release: verify, bump, promote the changelog, tag.
#
# Usage: ./scripts/release.sh 1.2.0
#        ./scripts/release.sh 1.2.0 --dry-run
#        ./scripts/release.sh 1.2.0 --allow-branch   # tag from a non-main branch
#
# Enforces the policy in VERSIONING.md:
#   - clean working tree
#   - on main (unless --allow-branch)
#   - version strictly greater than the latest existing tag
#   - CHANGELOG.md has an "## [Unreleased]" section with content to promote,
#     including an "### Action required" section for every major
#
# The push is deliberately NOT automated. Run it yourself when you are ready:
#   git push origin main --follow-tags

set -euo pipefail

VERSION="${1:-}"
DRY_RUN=false
ALLOW_BRANCH=false

for arg in "${@:2}"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --allow-branch) ALLOW_BRANCH=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

die() { echo "release: $*" >&2; exit 1; }

[[ -n "$VERSION" ]] || die "usage: ./scripts/release.sh <version> [--dry-run] [--allow-branch]"
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
# python3, not sed: BSD sed silently no-ops on the GNU `0,/re/` address, so the
# bump appeared to succeed while leaving the version untouched.
VERSION="$VERSION" python3 -c '
import json, os, re
version = os.environ["VERSION"]
src = open("package.json").read()
new, n = re.subn(r"\"version\":\s*\"[^\"]*\"", f"\"version\": \"{version}\"", src, count=1)
assert n == 1, "package.json has no version field"
assert json.loads(new)["version"] == version, "rewrite produced the wrong version"
open("package.json", "w").write(new)
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
