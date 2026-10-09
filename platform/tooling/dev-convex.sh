#!/bin/bash
set -e

# This launcher is only for the anonymous backend owned by dev-start.sh.
# Small shared CI runners can deschedule a query for Convex's entire one-second
# wall-clock budget while Next compiles. Keep the limit bounded and overridable.
if [ "${CI:-}" = "true" ]; then
    export DATABASE_UDF_USER_TIMEOUT_SECONDS="${DATABASE_UDF_USER_TIMEOUT_SECONDS:-5}"
fi
export CONVEX_AGENT_MODE=anonymous
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
convex_bin=$("$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/local-dev-deps.ts" bin "$PWD" convex)
if [ -n "${CONVEX_LOCAL_BACKEND_VERSION:-}" ]; then
    exec node "$convex_bin" dev --tail-logs always --local-backend-version "$CONVEX_LOCAL_BACKEND_VERSION"
fi
# Scheduled local email delivery may overlap a source deployment. Keep its
# console inbox observable for development and E2E instead of dropping the event.
exec node "$convex_bin" dev --tail-logs always
