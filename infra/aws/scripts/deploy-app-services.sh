#!/usr/bin/env bash
# Point the web and admin ECS services at the images for a commit.
#
#   deploy-app-services.sh --env <local|staging|production> [--sha <commit>] [--profile <p>]
#                          [--exact | --web-tag <tag> --admin-tag <tag>]
#
# Deploys the apps stack with new image tags; CloudFormation rolls the services
# and waits for them to stabilise (the circuit breaker rolls back a bad deploy).
# By default an app whose image inputs are unchanged keeps its deployed image;
# --exact requires the image built from exactly this commit (used by rollback);
# --web-tag/--admin-tag deploy given tags (used by promotion).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd jq
require_cmd git

parse_common_args "$@"
EXACT=false
WEB_TAG=""
ADMIN_TAG=""
set -- ${REST[@]+"${REST[@]}"}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --exact) EXACT=true ;;
    --web-tag) WEB_TAG="${2:-}"; shift ;;
    --admin-tag) ADMIN_TAG="${2:-}"; shift ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done
SHA="$(resolve_sha "${SHA:-HEAD}")"

if [[ -n "$WEB_TAG" || -n "$ADMIN_TAG" ]]; then
  [[ -n "$WEB_TAG" && -n "$ADMIN_TAG" ]] || die "--web-tag and --admin-tag go together"
elif [[ "$EXACT" == true ]]; then
  WEB_TAG="$SHA"
  ADMIN_TAG="$SHA"
else
  WEB_TAG="$(image_tag_for web "$SHA")"
  ADMIN_TAG="$(image_tag_for admin "$SHA")"
fi
image_exists web "$WEB_TAG" || die "No web image ${WEB_TAG:0:12} in the registry; run build-push-images.sh first"
image_exists admin "$ADMIN_TAG" || die "No admin image ${ADMIN_TAG:0:12} in the registry; run build-push-images.sh first"

read -r CONVEX_URL CONVEX_SITE_URL <<<"$(convex_urls)"

log "web=${WEB_TAG:0:12} admin=${ADMIN_TAG:0:12} convex=${CONVEX_URL}"
deploy_stack apps false \
  "WebImageTag=${WEB_TAG}" \
  "AdminImageTag=${ADMIN_TAG}" \
  "ConvexUrl=${CONVEX_URL}" \
  "ConvexSiteUrl=${CONVEX_SITE_URL}"

log "App services deployed for env=${ENV}"
