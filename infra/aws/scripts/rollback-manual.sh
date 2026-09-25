#!/usr/bin/env bash
# Roll an environment back to an earlier commit.
#
#   [CONVEX_DEPLOY_KEY=...] rollback-manual.sh --env <local|staging|production> --sha <commit> [--profile <p>]
#
# web/admin go back to the images built from that commit. They are normally
# still in the registry (tags are immutable and kept by the lifecycle policy),
# so nothing is rebuilt; an image that has aged out is rebuilt from the commit.
# Convex functions and landing are redeployed from the commit, exactly as
# cd-rollback.yml does. Schema changes are not undone: a rollback across a
# schema change needs the procedure in docs/convex-migrations.md.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd git

parse_common_args "$@"
[[ ${#REST[@]} -eq 0 ]] || die "Unknown argument: ${REST[0]}"
[[ -n "$SHA" ]] || die "Missing --sha <commit to roll back to>"
SHA="$(resolve_sha "$SHA")"

COMMON=(--env "$ENV")
while IFS= read -r a; do COMMON+=("$a"); done < <(profile_args)
WITH_SHA=("${COMMON[@]}" --sha "$SHA")

log "Rolling ${ENV} back to ${SHA:0:12}"

log "Step 1/5: images for ${SHA:0:12}"
"$SCRIPT_DIR/build-push-images.sh" "${WITH_SHA[@]}" --force

log "Step 2/5: Convex functions"
"$SCRIPT_DIR/deploy-convex.sh" "${WITH_SHA[@]}"

log "Step 3/5: web and admin"
"$SCRIPT_DIR/deploy-app-services.sh" "${WITH_SHA[@]}" --exact

log "Step 4/5: landing"
"$SCRIPT_DIR/deploy-landing.sh" "${WITH_SHA[@]}"

log "Step 5/5: smoke checks"
"$SCRIPT_DIR/smoke-check.sh" "${COMMON[@]}"

log "Rolled ${ENV} back to ${SHA:0:12}"
