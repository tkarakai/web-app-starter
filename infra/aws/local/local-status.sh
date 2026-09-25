#!/usr/bin/env bash
# Show the state of the local target: its containers, the commit deployed and
# the URLs to open. Read-only; exits non-zero when the target isn't running.
#
#   infra/aws/local/local-status.sh
set -euo pipefail
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${LOCAL_DIR}/../scripts/common.sh"
require_cmd docker
require_cmd aws

parse_common_args --env local
export COMPOSE_PROJECT_NAME="${PROJECT_NAME}-aws-local"

echo "Containers:"
# The Compose services (Floci, Convex, which shares Floci's network namespace)
# and the containers Floci started on its network (ECS tasks, ECR registry).
containers="$( {
  docker ps --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" --format '{{.Names}}\t{{.Status}}'
  docker ps --filter "network=${COMPOSE_PROJECT_NAME}" --filter label=floci --format '{{.Names}}\t{{.Status}}'
} 2>/dev/null | sort -u | sed 's/^/  /' || true)"
if [[ -z "$containers" ]]; then
  echo "  none: the local target is not running (bun run aws:local:up)"
  exit 1
fi
echo "$containers"

if ! curl -fsS -o /dev/null "${FLOCI_ENDPOINT}/_floci/health" 2>/dev/null; then
  echo
  echo "Floci is not answering on ${FLOCI_ENDPOINT}"
  exit 1
fi

apps="$(stack_name apps)"
web_tag="$(cf_output "$apps" WebImageTag)"
admin_tag="$(cf_output "$apps" AdminImageTag)"
echo
echo "Deployed:"
if [[ -z "$web_tag" ]]; then
  echo "  nothing yet (the apps stack doesn't exist)"
else
  echo "  web    ${web_tag:0:12}"
  echo "  admin  ${admin_tag:0:12}"
fi

read -r convex_url _ <<<"$(convex_urls)"
echo
echo "URLs:"
echo "  web       $(cf_output "$(stack_name network)" WebUrl)"
echo "  admin     $(cf_output "$(stack_name network)" AdminUrl)"
echo "  landing   $(cf_output "$(stack_name landing)" LandingUrl)"
echo "  convex    ${convex_url}"
echo "  floci UI  ${FLOCI_ENDPOINT}/_floci/ui"
echo
echo "Checks: bun run aws:local:check    Convex logs: bun run aws:local:logs"
