#!/usr/bin/env bash
# Stop the local target: Floci and everything it started (ECS task containers,
# the ECR registry and its image volume) and the local Convex backend with its
# data. This is a full reset: the next local-up.sh starts from nothing.
#
#   infra/aws/local/local-down.sh
set -euo pipefail
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${LOCAL_DIR}/../scripts/common.sh"
require_cmd docker

parse_common_args --env local
export COMPOSE_PROJECT_NAME="${PROJECT_NAME}-aws-local"

# Containers Floci started itself carry the `floci` label and join its network;
# they are not part of the Compose project, so remove them (and their volumes)
# first or the network cannot be removed.
started="$(docker ps -aq --filter "network=${COMPOSE_PROJECT_NAME}" --filter label=floci 2>/dev/null || true)"
volumes=""
if [[ -n "$started" ]]; then
  # $started is a whitespace-separated list of container IDs.
  # shellcheck disable=SC2086
  volumes="$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' $started | xargs)"
  log "Removing $(wc -w <<<"$started" | tr -d ' ') container(s) Floci started"
  # shellcheck disable=SC2086
  docker rm -f $started >/dev/null
fi

if [[ -f "${LOCAL_STATE_DIR}/convex-logs.pid" ]]; then
  kill "$(cat "${LOCAL_STATE_DIR}/convex-logs.pid")" 2>/dev/null || true
fi
docker compose -f "${LOCAL_DIR}/compose.yaml" down --remove-orphans --volumes
rm -rf "$LOCAL_STATE_DIR"

for volume in $volumes; do
  docker volume rm "$volume" >/dev/null 2>&1 && log "Removed volume ${volume}" || true
done
log "Local AWS stopped"
