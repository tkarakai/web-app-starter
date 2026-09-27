#!/bin/bash
set -e

# This launcher is only for the anonymous backend owned by dev-start.sh.
# Small shared CI runners can deschedule a query for Convex's entire one-second
# wall-clock budget while Next compiles. Keep the limit bounded and overridable.
if [ "${CI:-}" = "true" ]; then
    export DATABASE_UDF_USER_TIMEOUT_SECONDS="${DATABASE_UDF_USER_TIMEOUT_SECONDS:-5}"
fi
export CONVEX_AGENT_MODE=anonymous
exec npx convex dev
