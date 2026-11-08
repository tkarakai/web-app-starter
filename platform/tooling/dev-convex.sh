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
backend_args=()
if [ -n "${PLATFORM_E2E_PORTS:-}" ]; then
    cloud_port=$("$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/e2e-ports.ts" cloud)
    site_port=$("$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/e2e-ports.ts" site)
    backend_args+=(--local-cloud-port "$cloud_port" --local-site-port "$site_port")
fi
if [ -n "${CONVEX_LOCAL_BACKEND_VERSION:-}" ]; then
    exec node "$convex_bin" dev "${backend_args[@]}" --local-backend-version "$CONVEX_LOCAL_BACKEND_VERSION"
fi
exec node "$convex_bin" dev "${backend_args[@]}"
