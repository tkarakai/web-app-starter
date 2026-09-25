#!/usr/bin/env bash
# Delete every stack of an environment, including its images and landing files,
# so nothing keeps billing. Meant for short-lived environments (a sandbox you
# bring up for a test session); refuses production.
#
#   destroy.sh --env <local|staging> [--profile <p>] [--yes] [--keep-bootstrap]
#
# Order is the reverse of deployment: apps, landing, registry, network, then
# bootstrap. The landing bucket and the ECR repositories are emptied first,
# because CloudFormation cannot delete a bucket or repository that holds objects.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd jq

parse_common_args "$@"
YES=false
KEEP_BOOTSTRAP=false
for arg in ${REST[@]+"${REST[@]}"}; do
  case "$arg" in
    --yes) YES=true ;;
    --keep-bootstrap) KEEP_BOOTSTRAP=true ;;
    *) die "Unknown argument: $arg" ;;
  esac
done
[[ "$ENV" != "production" ]] || die "destroy.sh refuses production; delete its stacks by hand if you really mean it"

if [[ "$YES" != true ]]; then
  printf 'Delete all %s-%s-* stacks, images and landing files in %s? Type the environment name: ' \
    "$PROJECT_NAME" "$ENV" "$REGION" >&2
  read -r answer
  [[ "$answer" == "$ENV" ]] || die "Not confirmed"
fi

stack_exists() {
  aws_cli cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1
}

delete_stack() {
  local name
  name="$(stack_name "$1")"
  if ! stack_exists "$name"; then
    log "${name}: not deployed"
    return
  fi
  log "Deleting ${name}"
  aws_cli cloudformation delete-stack --stack-name "$name"
  aws_cli cloudformation wait stack-delete-complete --stack-name "$name"
}

delete_stack apps

bucket="$(cf_output "$(stack_name landing)" LandingBucketName)"
if [[ -n "$bucket" ]]; then
  log "Emptying s3://${bucket} (all versions)"
  aws_cli s3 rm "s3://${bucket}" --recursive --only-show-errors || true
  # The bucket is versioned: delete the old versions and delete markers too.
  while :; do
    batch="$(aws_cli s3api list-object-versions --bucket "$bucket" --max-items 500 --output json \
      --query '{Objects: [Versions[].{Key:Key,VersionId:VersionId}, DeleteMarkers[].{Key:Key,VersionId:VersionId}][] }' 2>/dev/null || echo '{}')"
    [[ "$(jq '.Objects | length // 0' <<<"$batch")" -gt 0 ]] || break
    aws_cli s3api delete-objects --bucket "$bucket" --delete "$(jq -c '{Objects: .Objects, Quiet: true}' <<<"$batch")" >/dev/null
  done
fi
delete_stack landing

for app in web admin; do
  repo="${PROJECT_NAME}-${ENV}-${app}"
  if aws_cli ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1; then
    while :; do
      # batch-delete-image takes at most 100 image IDs per call.
      ids="$(aws_cli ecr list-images --repository-name "$repo" --max-items 100 --query 'imageIds' --output json)"
      [[ "$(jq 'length // 0' <<<"$ids")" -gt 0 ]] || break
      log "Deleting $(jq length <<<"$ids") image(s) from ${repo}"
      aws_cli ecr batch-delete-image --repository-name "$repo" --image-ids "$ids" >/dev/null
    done
  fi
done
delete_stack registry
delete_stack network
[[ "$KEEP_BOOTSTRAP" == true ]] || delete_stack bootstrap

log "Environment ${ENV} deleted"
