#!/bin/bash
# Shared by startup and status. Let Convex resolve the selected deployment's
# dashboard and verify it is running; its port and startup log format can change.
get_dashboard_url() {
    local dashboard_url convex_bin
    convex_bin=$("$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/local-dev-deps.ts" bin "$PROJECT_DIR/packages/backend" convex) || return 1
    dashboard_url=$(cd "$PROJECT_DIR/packages/backend" && "$SCRIPT_DIR/node-ts.sh" "$convex_bin" dashboard --no-open </dev/null 2>/dev/null) || return 0
    printf '%s\n' "$dashboard_url"
}
