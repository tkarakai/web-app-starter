#!/usr/bin/env bash
# Deploy the infrastructure stacks (network, registry, landing).
# The apps stack is deployed by deploy-app-services.sh, which supplies image tags.
#
#   deploy-stacks.sh --env <local|staging|production> [--profile <p>] [--no-execute-changeset]
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd jq

parse_common_args "$@"
NO_EXECUTE=false
for arg in ${REST[@]+"${REST[@]}"}; do
  case "$arg" in
    --no-execute-changeset) NO_EXECUTE=true ;;
    *) die "Unknown argument: $arg" ;;
  esac
done

for stack in "${INFRA_STACKS[@]}"; do
  deploy_stack "$stack" "$NO_EXECUTE"
done

log "Infrastructure stacks deployed for env=${ENV}"
