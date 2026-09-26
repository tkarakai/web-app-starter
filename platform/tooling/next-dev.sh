#!/bin/bash
#
# Run `next dev` for one app on its port from app.config.ts. Each app's
# package.json `dev` script calls this, so the port lives in one place.
#
# Usage (from an app directory, as `bun run dev` does):
#   ../../platform/tooling/next-dev.sh <app> [extra next dev flags...]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -lt 1 ]; then
    echo "Usage: next-dev.sh <app> [next dev flags...]" >&2
    exit 2
fi

app="$1"
shift

port=$("$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/app-config.ts" port "$app")
exec next dev --port "$port" "$@"
