#!/usr/bin/env bash
#
# Run GitHub Actions CI workflow locally using act.
#
# Usage: ./scripts/ci-local-act.sh [options]
#
# Options:
#   -j, --job <name>    Run only a specific job (e.g., lint, test-unit, build)
#   -q, --quiet         Suppress step output, show only job status
#   -o, --offline       Offline mode (skip image pulls, use cached actions)
#   -l, --list          List available jobs
#   -h, --help          Show this help
#
# Examples:
#   ./scripts/ci-local-act.sh              # Run all CI jobs (first run populates caches)
#   ./scripts/ci-local-act.sh -j lint      # Run only lint job
#   ./scripts/ci-local-act.sh -q           # Quiet mode with summary
#   ./scripts/ci-local-act.sh -o           # Offline mode (requires prior online run)
#
# =============================================================================
# OFFLINE MODE
# =============================================================================
# This script enables offline CI execution by using Docker volumes to persist:
#   - Bun binary and package cache (act-bun-cache -> /root/.bun)
#   - Playwright browser binaries (act-playwright-cache -> /root/.cache/ms-playwright)
#   - Node.js installations (act-toolcache -> /opt/act-toolcache)
#
# First run (online): Downloads and installs all tools to Docker volumes
# Subsequent runs: Uses cached tools from volumes (works offline)
#
# The workflow (.github/workflows/ci.yml) uses conditional steps based on env.ACT
# to differentiate between standard and cache-aware setups.
#
# When adding new tools that download from the internet, follow the pattern in
# ci.yml (see "Setup Bun" vs "Setup Bun (act)" steps).
#
# See CLAUDE.md "Offline CI Mode (act)" for full documentation.
# =============================================================================
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORKFLOW=".github/workflows/ci.yml"
LOG_FILE="$PROJECT_DIR/.act-output.log"

# Table width settings
TABLE_WIDTH=62

# Parse arguments
QUIET=false
JOB=""
LIST=false
OFFLINE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -j|--job)
            JOB="$2"
            shift 2
            ;;
        -q|--quiet)
            QUIET=true
            shift
            ;;
        -o|--offline)
            OFFLINE=true
            shift
            ;;
        -l|--list)
            LIST=true
            shift
            ;;
        -h|--help)
            head -20 "$0" | tail -18 | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

cd "$PROJECT_DIR"

# List jobs if requested
if [ "$LIST" = true ]; then
    echo -e "${BLUE}Available jobs in $WORKFLOW:${NC}"
    act -W "$WORKFLOW" -l | tail -n +2 | while read -r line; do
        job=$(echo "$line" | awk '{print $2}')
        name=$(echo "$line" | awk '{$1=$2=""; print $0}' | sed 's/^ *//')
        echo -e "  ${CYAN}$job${NC} - $name"
    done
    exit 0
fi

# Build act command with volume mounts for caching
# Note: Multiple --container-options don't accumulate, must combine in one
# - act-bun-cache: Package cache (node_modules)
# - act-playwright-cache: Playwright browser binaries
# - act-toolcache: Bun/Node installations (at custom path to avoid act's internal mount)
# Note: /opt/hostedtoolcache is managed by act internally, so we use /opt/act-toolcache instead
CACHE_VOLUMES="-v act-bun-cache:/root/.bun -v act-playwright-cache:/root/.cache/ms-playwright -v act-toolcache:/opt/act-toolcache"
ACT_ARGS=(-W "$WORKFLOW")
ACT_ARGS+=(--container-options "$CACHE_VOLUMES")
ACT_ARGS+=(--env "RUNNER_TOOL_CACHE=/opt/act-toolcache")
if [ -n "$JOB" ]; then
    ACT_ARGS+=(-j "$JOB")
fi
if [ "$OFFLINE" = true ]; then
    ACT_ARGS+=(--pull=false --action-offline-mode)
fi
ACT_CMD="act ${ACT_ARGS[*]}"

# Print header
echo ""
echo -e "${BLUE}┌──────────────────────────────────────────────────────────────┐${NC}"
echo -e "${BLUE}│${NC}              ${BOLD}Running GitHub Actions CI locally${NC}               ${BLUE}│${NC}"
echo -e "${BLUE}└──────────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${CYAN}Workflow:${NC} $WORKFLOW"
[ -n "$JOB" ] && echo -e "${CYAN}Job:${NC} $JOB"
echo -e "${CYAN}Command:${NC} $ACT_CMD"
echo ""

START_TIME=$(date +%s)

# Run act and capture output
if [ "$QUIET" = true ]; then
    echo -e "${YELLOW}Running in quiet mode...${NC}"
    echo ""
    act "${ACT_ARGS[@]}" 2>&1 | tee "$LOG_FILE" | grep -E '(⭐ Run Main|✅  Success|❌  Failure|🏁  Job)' || true
else
    act "${ACT_ARGS[@]}" 2>&1 | tee "$LOG_FILE" || true
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECS=$((DURATION % 60))

# Helper to print a table row with proper alignment
print_row() {
    local content="$1"
    local icon="$2"
    local max_content=$((TABLE_WIDTH - 6))  # 6 = 2 border + 2 space + 2 icon width
    if [ ${#content} -gt $max_content ]; then
        content="${content:0:$max_content}"
    fi
    local padding=$((max_content - ${#content}))
    echo -e "${BLUE}│${NC} ${content}$(printf '%*s' "$padding" '') ${icon} ${BLUE}│${NC}"
}

# Parse results and show summary
echo ""
echo -e "${BLUE}┌─────────────────────────────────────────────────────────────┐${NC}"
echo -e "${BLUE}│${NC}                          ${BOLD}Summary${NC}                            ${BLUE}│${NC}"
echo -e "${BLUE}├─────────────────────────────────────────────────────────────┤${NC}"

# Extract job results from log
FAILED=false
JOB_COUNT=0
while IFS= read -r line; do
    if [[ "$line" =~ "🏁  Job succeeded" ]]; then
        job=$(echo "$line" | sed 's/\[//' | sed 's/\].*//' | sed 's/^ *//' | sed 's/ *$//')
        print_row "$job" "✅"
        JOB_COUNT=$((JOB_COUNT + 1))
    elif [[ "$line" =~ "🏁  Job failed" ]]; then
        job=$(echo "$line" | sed 's/\[//' | sed 's/\].*//' | sed 's/^ *//' | sed 's/ *$//')
        print_row "$job" "❌"
        FAILED=true
        JOB_COUNT=$((JOB_COUNT + 1))
    fi
done < "$LOG_FILE"

if [ $JOB_COUNT -eq 0 ]; then
    print_row "No jobs completed" "⚠️"
fi

echo -e "${BLUE}├─────────────────────────────────────────────────────────────┤${NC}"
echo -e "${BLUE}│${NC} ${DIM}Duration: ${MINUTES}m ${SECS}s${NC}$(printf '%*s' "$((TABLE_WIDTH - 16 - ${#MINUTES} - ${#SECS}))" '') ${BLUE}│${NC}"
echo -e "${BLUE}└─────────────────────────────────────────────────────────────┘${NC}"
echo ""

# Clean up log file
rm -f "$LOG_FILE"

if [ "$FAILED" = true ]; then
    echo -e "${RED}Some jobs failed. Check output above for details.${NC}"
    exit 1
else
    echo -e "${GREEN}All jobs passed!${NC}"
    exit 0
fi
