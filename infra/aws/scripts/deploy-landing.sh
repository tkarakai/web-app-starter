#!/usr/bin/env bash
# Build the static landing export for a commit and publish it to S3 + CloudFront.
#
#   deploy-landing.sh --env <local|staging|production> [--sha <commit>] [--profile <p>]
#
# landing is a static export, so unlike web/admin its URLs are inlined at build
# time and it is rebuilt per environment (see platform/docs/deployment-architecture.md).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd jq
require_cmd git
require_cmd bun

parse_common_args "$@"
[[ ${#REST[@]} -eq 0 ]] || die "Unknown argument: ${REST[0]}"
SHA="$(resolve_sha "${SHA:-HEAD}")"

LANDING_STACK="$(stack_name landing)"
BUCKET="$(require_output "$LANDING_STACK" LandingBucketName)"
DISTRIBUTION_ID="$(require_output "$LANDING_STACK" LandingCloudFrontDistributionId)"
LANDING_URL="$(require_output "$LANDING_STACK" LandingUrl)"
WEB_URL="$(require_output "$(stack_name network)" WebUrl)"
read -r _ CONVEX_SITE_URL <<<"$(convex_urls)"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
log "Exporting ${SHA:0:12} to a clean build root"
git -C "$REPO_ROOT" archive "$SHA" | tar -x -C "$TMP_DIR"

log "Building landing (site=${LANDING_URL} web=${WEB_URL})"
(
  cd "$TMP_DIR"
  bun install --frozen-lockfile >/dev/null
  NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_SITE_URL="$LANDING_URL" \
  NEXT_PUBLIC_WEB_APP_URL="$WEB_URL" \
  NEXT_PUBLIC_CONVEX_SITE_URL="$CONVEX_SITE_URL" \
  NEXT_PUBLIC_GIT_SHA="$SHA" \
  NEXT_PUBLIC_APP_NAME=landing \
    bun run --cwd apps/landing build
)
OUT="$TMP_DIR/apps/landing/out"
[[ -f "$OUT/index.html" ]] || die "Landing export not found at apps/landing/out"

# S3 behind CloudFront has no directory indexes: /en/ is the key "en/", not
# "en/index.html". Publish each page under its directory keys as well ("en/"
# and "en"), so directory URLs resolve on CloudFront and Floci alike without
# an edge function.
( cd "$OUT" && find . -mindepth 2 -name index.html ) | sed 's#^\./##; s#/index\.html$##' > "$TMP_DIR/dirs.txt"

log "Uploading hashed assets (immutable)"
aws_cli s3 sync "$OUT/_next" "s3://${BUCKET}/_next" \
  --cache-control "public, max-age=31536000, immutable" --only-show-errors
log "Uploading pages"
aws_cli s3 sync "$OUT" "s3://${BUCKET}" --exclude "_next/*" \
  --cache-control "public, max-age=0, must-revalidate" --only-show-errors
while IFS= read -r dir; do
  # put-object, not `s3 cp`: cp treats a key ending in "/" as a folder and
  # appends the file name.
  for key in "${dir}/" "${dir}"; do
    aws_cli s3api put-object --bucket "$BUCKET" --key "$key" --body "$OUT/${dir}/index.html" \
      --content-type "text/html; charset=utf-8" \
      --cache-control "public, max-age=0, must-revalidate" >/dev/null
  done
done < "$TMP_DIR/dirs.txt"

log "Removing objects no longer in the export"
EXPECTED="$TMP_DIR/expected.txt"
{
  ( cd "$OUT" && find . -type f | sed 's#^\./##' )
  sed 's#$#/#' "$TMP_DIR/dirs.txt"
  cat "$TMP_DIR/dirs.txt"
} > "$EXPECTED"
aws_cli s3api list-objects-v2 --bucket "$BUCKET" --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | { grep -v -e '^None$' -e '^$' || true; } | { grep -vxF -f "$EXPECTED" || true; } \
  | while IFS= read -r stale; do
      aws_cli s3 rm "s3://${BUCKET}/${stale}" --only-show-errors
    done

log "Invalidating CloudFront ${DISTRIBUTION_ID}"
INVALIDATION_ID="$(aws_cli cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" \
  --paths '/*' --query 'Invalidation.Id' --output text)"
aws_cli cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION_ID"

log "Landing deployed for env=${ENV}: ${LANDING_URL}"
