#!/usr/bin/env bash
# Build the web and admin images for a commit and push them to the registry stack.
#
#   build-push-images.sh --env <local|staging|production> [--sha <commit>] [--profile <p>] [--app web|admin] [--force]
#
# Images are tagged by commit SHA and the repositories are immutable, so a tag
# that already exists is never rebuilt. Without --force, an app whose image
# inputs are unchanged since the deployed image is skipped (see image_tag_for).
# The image is built from `git archive` of the commit, never the working tree.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd jq
require_cmd git
require_cmd docker

parse_common_args "$@"
APPS=(web admin)
FORCE=false
set -- ${REST[@]+"${REST[@]}"}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APPS=("${2:-}"); shift ;;
    --force) FORCE=true ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done
SHA="$(resolve_sha "${SHA:-HEAD}")"

ARCH="$(get_param_from_file "$(param_file "$ENV" apps)" CpuArchitecture)"
case "$ARCH" in
  ARM64) PLATFORM=linux/arm64 ;;
  X86_64) PLATFORM=linux/amd64 ;;
  *) die "Unknown CpuArchitecture in params/${ENV}/apps.json: ${ARCH}" ;;
esac

TMP_DIR=""
cleanup() { [[ -n "$TMP_DIR" ]] && rm -rf "$TMP_DIR"; return 0; }
trap cleanup EXIT

LOGGED_IN=""
login() {
  local registry="${1%%/*}"
  [[ "$LOGGED_IN" == "$registry" ]] && return
  log "Logging in to ${registry}"
  aws_cli ecr get-login-password | docker login --username AWS --password-stdin "$registry" >/dev/null
  LOGGED_IN="$registry"
}

for app in "${APPS[@]}"; do
  if [[ "$FORCE" == true ]]; then
    tag="$SHA"
  else
    tag="$(image_tag_for "$app" "$SHA")"
  fi
  if [[ "$tag" != "$SHA" ]]; then
    log "${app}: image inputs unchanged since ${tag:0:12}; reusing it"
    continue
  fi
  if image_exists "$app" "$tag"; then
    log "${app}: image ${tag:0:12} already in the registry"
    continue
  fi

  repo="$(repository_uri "$app")"
  if [[ -z "$TMP_DIR" ]]; then
    TMP_DIR="$(mktemp -d)"
    log "Exporting ${SHA:0:12} to a clean build context"
    git -C "$REPO_ROOT" archive "$SHA" | tar -x -C "$TMP_DIR"
  fi

  log "${app}: building ${repo}:${tag} for ${PLATFORM}"
  docker build \
    --platform "$PLATFORM" \
    -f "$TMP_DIR/infra/aws/docker/next-app.Dockerfile" \
    --build-arg APP="$app" \
    --build-arg GIT_SHA="$SHA" \
    --build-arg GIT_BRANCH="$(git -C "$REPO_ROOT" name-rev --name-only --refs='refs/heads/*' "$SHA" 2>/dev/null | sed 's/[~^].*//' || true)" \
    --build-arg DEPLOY_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -t "${repo}:${tag}" \
    "$TMP_DIR"

  login "$repo"
  log "${app}: pushing ${repo}:${tag}"
  docker push "${repo}:${tag}"
done

log "Images ready for env=${ENV} sha=${SHA:0:12}"
