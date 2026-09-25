#!/usr/bin/env bash
# Full manual deployment of a commit to one environment.
#
#   [CONVEX_DEPLOY_KEY=...] deploy-manual.sh --env <local|staging|production> [--sha <commit>] [--profile <p>]
#       [--force] [--dry-run] [--replace-origins] [--promote-from <env> [--from-profile <p>]]
#
# Order mirrors the Vercel pipeline (cd-staging.yml): Convex first, so the new
# app code never runs against old functions, then the apps, then landing.
#   1 validate  2 infra stacks  3 images  4 Convex  5 web/admin  6 landing  7 smoke
#
#   --force            rebuild images even when their inputs are unchanged
#   --dry-run          stop after creating (not executing) the infra change sets
#   --replace-origins  make the AWS origins the only ones Convex allows (cutover)
#   --promote-from     run the images <env> runs (and tested) instead of building;
#                      the normal way to deploy production: --promote-from staging
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd git

parse_common_args "$@"
FORCE=false
DRY_RUN=false
CONVEX_ARGS=()
PROMOTE_ARGS=()
set -- ${REST[@]+"${REST[@]}"}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true ;;
    --dry-run) DRY_RUN=true ;;
    --replace-origins) CONVEX_ARGS+=(--replace-origins) ;;
    --promote-from) PROMOTE_ARGS+=(--from "${2:-}"); shift ;;
    --from-profile) PROMOTE_ARGS+=(--from-profile "${2:-}"); shift ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done
SHA="$(resolve_sha "${SHA:-HEAD}")"

COMMON=(--env "$ENV")
while IFS= read -r a; do COMMON+=("$a"); done < <(profile_args)
WITH_SHA=("${COMMON[@]}" --sha "$SHA")

log "Deploying ${SHA:0:12} to ${ENV}"

log "Step 1/7: validate"
"$SCRIPT_DIR/validate.sh" "${COMMON[@]}"

log "Step 2/7: infrastructure stacks"
if [[ "$DRY_RUN" == true ]]; then
  "$SCRIPT_DIR/deploy-stacks.sh" "${COMMON[@]}" --no-execute-changeset
  log "Dry run complete: change sets created, nothing executed"
  exit 0
fi
"$SCRIPT_DIR/deploy-stacks.sh" "${COMMON[@]}"

log "Step 3/7: images"
APP_ARGS=("${WITH_SHA[@]}")
if [[ ${#PROMOTE_ARGS[@]} -gt 0 ]]; then
  TAGS="$("$SCRIPT_DIR/promote-images.sh" "${WITH_SHA[@]}" "${PROMOTE_ARGS[@]}")"
  for pair in $TAGS; do
    case "$pair" in
      web=*) APP_ARGS+=(--web-tag "${pair#web=}") ;;
      admin=*) APP_ARGS+=(--admin-tag "${pair#admin=}") ;;
    esac
  done
else
  BUILD_ARGS=("${WITH_SHA[@]}")
  [[ "$FORCE" == true ]] && BUILD_ARGS+=(--force)
  "$SCRIPT_DIR/build-push-images.sh" "${BUILD_ARGS[@]}"
  [[ "$FORCE" == true ]] && APP_ARGS+=(--exact)
fi

log "Step 4/7: Convex"
"$SCRIPT_DIR/deploy-convex.sh" "${WITH_SHA[@]}" ${CONVEX_ARGS[@]+"${CONVEX_ARGS[@]}"}

log "Step 5/7: web and admin"
"$SCRIPT_DIR/deploy-app-services.sh" "${APP_ARGS[@]}"

log "Step 6/7: landing"
"$SCRIPT_DIR/deploy-landing.sh" "${WITH_SHA[@]}"

log "Step 7/7: smoke checks"
"$SCRIPT_DIR/smoke-check.sh" "${COMMON[@]}"

# Record the deploy as an annotated tag, as the Vercel pipeline does. Only
# commits already on origin/main are tagged: a deploy of a branch commit is a
# trial, and tags must never point at commits the squash merge will discard.
if [[ "$ENV" != "local" ]]; then
  git -C "$REPO_ROOT" fetch --quiet origin main || true
  if git -C "$REPO_ROOT" merge-base --is-ancestor "$SHA" origin/main 2>/dev/null; then
    TAG="deploy/aws/${ENV}/$(date -u +%Y-%m-%dT%H-%M-%SZ)/${SHA:0:12}"
    git -C "$REPO_ROOT" tag -a "$TAG" "$SHA" -m "Manual AWS ${ENV} deployment of ${SHA}"
    if git -C "$REPO_ROOT" push --quiet origin "$TAG"; then
      log "Pushed ${TAG}"
    else
      log "Tag ${TAG} created locally; push failed"
    fi
  else
    log "${SHA:0:12} is not on origin/main; not tagging this deploy"
  fi
fi

log "Deployed ${SHA:0:12} to ${ENV}"
