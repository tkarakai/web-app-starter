#!/bin/bash
# Shared by startup and status. Let Convex resolve the selected deployment's
# dashboard and verify it is running; its port and startup log format can change.
get_dashboard_url() {
    local dashboard_url
    dashboard_url=$(cd "$PROJECT_DIR/packages/backend" && bunx convex dashboard --no-open </dev/null 2>/dev/null) || return 0
    printf '%s\n' "$dashboard_url"
}
