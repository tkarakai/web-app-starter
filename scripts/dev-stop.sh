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

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Stopping Development Environment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

stopped_something=false

# Function to kill process and all its children
kill_pid() {
    local pid=$1
    local name=$2

    if kill -0 $pid 2>/dev/null; then
        local proc_name=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")

        # First, kill all child processes
        pkill -P $pid 2>/dev/null || true

        # Then kill the main process
        kill $pid 2>/dev/null || true
        sleep 0.5

        # Force kill if still running
        if kill -0 $pid 2>/dev/null; then
            pkill -9 -P $pid 2>/dev/null || true
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

# Stop processes from PID file only
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

# Clean up log files
rm -f "$PROJECT_DIR/.convex-dev.log" 2>/dev/null
rm -f "$PROJECT_DIR/.next-dev.log" 2>/dev/null

echo ""
if [ "$stopped_something" = true ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Development environment stopped${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
else
    echo -e "${YELLOW}Nothing to stop${NC}"
fi
