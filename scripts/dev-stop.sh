#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.dev-pids"

echo -e "${BLUE}  Stopping Development Environment...${NC}"
echo ""

stopped_something=false

# Function to recursively get all descendant PIDs
get_descendants() {
    local pid=$1
    local children=$(pgrep -P $pid 2>/dev/null)
    for child in $children; do
        echo $child
        get_descendants $child
    done
}

# Function to kill process and all its descendants
kill_pid() {
    local pid=$1
    local name=$2

    if kill -0 $pid 2>/dev/null; then
        local proc_name=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")

        # Get all descendant PIDs first
        local descendants=$(get_descendants $pid)

        # Kill all descendants
        for desc_pid in $descendants; do
            kill $desc_pid 2>/dev/null || true
        done

        # Then kill the main process
        kill $pid 2>/dev/null || true
        sleep 0.5

        # Force kill any survivors
        for desc_pid in $descendants; do
            if kill -0 $desc_pid 2>/dev/null; then
                kill -9 $desc_pid 2>/dev/null || true
            fi
        done
        if kill -0 $pid 2>/dev/null; then
            kill -9 $pid 2>/dev/null || true
        fi

        echo -e "${GREEN}✔ Stopped $name (PID: $pid, process: $proc_name)${NC}"
        stopped_something=true
        return 0
    else
        echo -e "  ${YELLOW}$name (PID: $pid) - already stopped${NC}"
        return 1
    fi
}

# Stop processes from PID file
if [ -f "$PID_FILE" ]; then
    echo -e "${YELLOW}Tracked processes:${NC}"

    while IFS= read -r line; do
        name=$(echo "$line" | cut -d':' -f1)
        pid=$(echo "$line" | cut -d':' -f2)
        if [ -n "$pid" ]; then
            kill_pid "$pid" "$name"
        fi
    done < "$PID_FILE"

    rm -f "$PID_FILE"
else
    echo -e "${YELLOW}No tracked processes found (.dev-pids not present)${NC}"
fi

# Clean up any orphaned Convex backend processes
ORPHANED_CONVEX=$(pgrep -f "convex-local-backend" 2>/dev/null || true)
if [ -n "$ORPHANED_CONVEX" ]; then
    echo ""
    echo -e "${YELLOW}Cleaning up orphaned Convex processes:${NC}"
    for pid in $ORPHANED_CONVEX; do
        if kill -0 $pid 2>/dev/null; then
            kill $pid 2>/dev/null || true
            sleep 0.3
            if kill -0 $pid 2>/dev/null; then
                kill -9 $pid 2>/dev/null || true
            fi
            echo -e "${GREEN}✔ Stopped orphaned convex-local-backend (PID: $pid)${NC}"
            stopped_something=true
        fi
    done
fi

# Clean up log files (per-app logs)
rm -f "$PROJECT_DIR/.convex-dev.log" 2>/dev/null
rm -f "$PROJECT_DIR/.next-web.log" 2>/dev/null
rm -f "$PROJECT_DIR/.next-admin.log" 2>/dev/null
rm -f "$PROJECT_DIR/.next-landing.log" 2>/dev/null
# Legacy single-app log
rm -f "$PROJECT_DIR/.next-dev.log" 2>/dev/null

echo ""
if [ "$stopped_something" = true ]; then
    echo -e "${GREEN}Development environment stopped${NC}"
else
    echo -e "${YELLOW}Nothing to stop${NC}"
fi
