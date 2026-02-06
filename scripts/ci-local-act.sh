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
ARTIFACTS_DIR="$PROJECT_DIR/.act-artifacts"

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

# Prepare artifacts directory (clear previous run)
rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR"

# Build act command with volume mounts for caching
# Note: Multiple --container-options don't accumulate, must combine in one
# - act-bun-cache: Package cache (node_modules)
# - act-playwright-cache: Playwright browser binaries
# - act-toolcache: Bun/Node installations (at custom path to avoid act's internal mount)
# - artifacts dir: Host directory to extract reports into, from containers
# Note: /opt/hostedtoolcache is managed by act internally, so we use /opt/act-toolcache instead
CACHE_VOLUMES="-v act-bun-cache:/root/.bun -v act-playwright-cache:/root/.cache/ms-playwright -v act-toolcache:/opt/act-toolcache -v $ARTIFACTS_DIR:/act-artifacts"
ACT_ARGS=(-W "$WORKFLOW")
ACT_ARGS+=(--container-options "$CACHE_VOLUMES")
ACT_ARGS+=(--env "RUNNER_TOOL_CACHE=/opt/act-toolcache")
# Set ACT_LOCAL var for job-level conditionals (env.ACT only works in steps)
ACT_ARGS+=(--var "ACT_LOCAL=true")
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
    # Add extra space for skip icon (⏭️) which renders narrower than ✅/❌
    local icon_pad=""
    [[ "$icon" == "⏭️" ]] && icon_pad=" "
    echo -e "${BLUE}│${NC} ${icon}${icon_pad} ${content}$(printf '%*s' "$padding" '') ${BLUE}│${NC}"
}

# Get list of all expected jobs from workflow with their stages
# act -l format: Stage  Job ID  Job name  Workflow name  Workflow file  Events
# Store as: "stage|job_id|job_name" entries separated by newlines
EXPECTED_JOBS=""
while IFS= read -r line; do
    stage=$(echo "$line" | awk '{print $1}')
    job_id=$(echo "$line" | awk '{print $2}')
    # Extract job name: fields 3+ until we hit "CI" (workflow name column)
    job_name=$(echo "$line" | awk '{
        name = ""
        for (i = 3; i <= NF; i++) {
            if ($i == "CI" && $(i+1) ~ /\.yml$/) break
            name = (name == "" ? $i : name " " $i)
        }
        print name
    }')
    if [ -n "$job_id" ] && [ "$job_id" != "Job" ]; then
        EXPECTED_JOBS="$EXPECTED_JOBS
$stage|$job_id|$job_name"
    fi
done < <(act -W "$WORKFLOW" -l 2>/dev/null | tail -n +2)

# Helper to look up job_id from job_name (exact match on field 3)
get_job_id() {
    local job_name_to_find="$1"
    echo "$EXPECTED_JOBS" | awk -F'|' -v name="$job_name_to_find" '$3 == name {print $2; exit}'
}

# Helper to get stage for a job name (exact match on field 3)
get_job_stage() {
    local job_name_to_find="$1"
    echo "$EXPECTED_JOBS" | awk -F'|' -v name="$job_name_to_find" '$3 == name {print $1; exit}'
}

# Extract job results from log (parse before cleanup)
# Log lines look like: "[CI/Lint] 🏁  Job succeeded"
# We extract "Lint" (job_name) and look up job_id
FAILED=false
JOB_COUNT=0
JOB_RESULTS=""
SEEN_JOB_IDS=""
while IFS= read -r line; do
    if [[ "$line" =~ "🏁  Job succeeded" ]] || [[ "$line" =~ "🏁  Job failed" ]] || \
       [[ "$line" =~ "was skipped" ]] || [[ "$line" =~ "Skipping job" ]] || [[ "$line" =~ "skipped due to" ]]; then
        # Extract job name from [CI/Job Name] prefix
        job_name=$(echo "$line" | sed 's/\[CI\///' | sed 's/\].*//' | sed 's/^ *//' | sed 's/ *$//')
        [ -z "$job_name" ] && continue

        # Look up job_id and stage
        job_id=$(get_job_id "$job_name")
        [ -z "$job_id" ] && continue
        stage=$(get_job_stage "$job_name")

        # Determine status icon
        if [[ "$line" =~ "🏁  Job succeeded" ]]; then
            icon="✅"
        elif [[ "$line" =~ "🏁  Job failed" ]]; then
            icon="❌"
            FAILED=true
        else
            icon="⏭️"
        fi

        # Store: stage|job_id|job_name|icon
        JOB_RESULTS="$JOB_RESULTS
$stage|$job_id|$job_name|$icon"
        SEEN_JOB_IDS="$SEEN_JOB_IDS|$job_id"
        JOB_COUNT=$((JOB_COUNT + 1))
    fi
done < "$LOG_FILE"

# Add any jobs that didn't run (not found in log) as skipped
while IFS='|' read -r stage job_id job_name; do
    [ -z "$job_id" ] && continue
    # Skip jobs with unexpanded matrix variables (act doesn't support matrix)
    [[ "$job_name" == *'${{ matrix.'* ]] && continue
    if [[ "$SEEN_JOB_IDS" != *"|$job_id"* ]]; then
        JOB_RESULTS="$JOB_RESULTS
$stage|$job_id|$job_name|⏭️"
        JOB_COUNT=$((JOB_COUNT + 1))
    fi
done <<< "$EXPECTED_JOBS"

# Extract per-job logs from the main log file
# act output lines are prefixed with [CI/Job Name] (job name can have spaces)
# We'll save all lines for each job to a separate log file using job_id
extract_job_logs() {
    local log_file="$1"
    local artifacts_dir="$2"
    local current_job_id=""
    local current_log_file=""
    # Track which jobs we've seen to avoid clearing logs on interleaved output
    local seen_jobs=""

    while IFS= read -r line; do
        # Extract job name from lines like "[CI/Backend Tests (Convex)] ⭐ Run..."
        # Note: no ^ anchor because act output may have ANSI color codes at start
        if [[ "$line" =~ \[CI/([^\]]+)\] ]]; then
            # Trim trailing whitespace (act pads job names for alignment)
            job_name=$(echo "${BASH_REMATCH[1]}" | sed 's/ *$//')
            # Look up job_id
            job_id=$(get_job_id "$job_name")
            if [ -n "$job_id" ]; then
                current_job_id="$job_id"
                current_log_file="$artifacts_dir/$job_id/console.log"

                # Create job directory and clear log only on first encounter
                if [[ "$seen_jobs" != *"|$job_id|"* ]]; then
                    mkdir -p "$artifacts_dir/$job_id"
                    > "$current_log_file"
                    seen_jobs="$seen_jobs|$job_id|"
                fi

                # Append line to job's log
                echo "$line" >> "$current_log_file"
            fi
        elif [ -n "$current_job_id" ] && [ -n "$current_log_file" ]; then
            # Continuation line (no job prefix) - append to current job's log
            echo "$line" >> "$current_log_file"
        fi
    done < "$log_file"
}

# Extract and save per-job logs
extract_job_logs "$LOG_FILE" "$ARTIFACTS_DIR"

# Clean up log file
rm -f "$LOG_FILE"

# Show Summary table
echo ""
echo -e "${BLUE}┌─────────────────────────────────────────────────────────────┐${NC}"
echo -e "${BLUE}│${NC}                          ${BOLD}Summary${NC}                            ${BLUE}│${NC}"
echo -e "${BLUE}├─────────────────────────────────────────────────────────────┤${NC}"

if [ $JOB_COUNT -eq 0 ]; then
    print_row "No jobs completed" "⚠️"
else
    current_stage=""
    # Sort by stage (field 1), then by job_id (field 2)
    # Format: "stage|job_id|job_name|icon"
    echo "$JOB_RESULTS" | sort -t'|' -k1,1n -k2,2 | while IFS= read -r result; do
        [ -z "$result" ] && continue
        stage=$(echo "$result" | cut -d'|' -f1)
        job_id=$(echo "$result" | cut -d'|' -f2)
        job_name=$(echo "$result" | cut -d'|' -f3)
        icon=$(echo "$result" | cut -d'|' -f4)

        # Show stage header when stage changes (display as 1-indexed)
        if [ -n "$stage" ] && [ "$stage" != "$current_stage" ]; then
            current_stage="$stage"
            display_stage=$((stage + 1))
            echo -e "${BLUE}│${NC} ${DIM}── Stage $display_stage ──${NC}$(printf '%*s' "$((TABLE_WIDTH - 15 - ${#display_stage}))" '') ${BLUE}│${NC}"
        fi

        print_row "$job_name" "$icon"
    done
fi

echo -e "${BLUE}├─────────────────────────────────────────────────────────────┤${NC}"
echo -e "${BLUE}│${NC} ${DIM}Duration: ${MINUTES}m ${SECS}s${NC}$(printf '%*s' "$((TABLE_WIDTH - 16 - ${#MINUTES} - ${#SECS}))" '') ${BLUE}│${NC}"
echo -e "${BLUE}└─────────────────────────────────────────────────────────────┘${NC}"

# Display job reports (step summaries, artifacts, and logs) in same order as summary
# Format: "stage|job_id|job_name|icon"
echo "$JOB_RESULTS" | sort -t'|' -k1,1n -k2,2 | while IFS= read -r result; do
    [ -z "$result" ] && continue

    job_id=$(echo "$result" | cut -d'|' -f2)
    job_name=$(echo "$result" | cut -d'|' -f3)
    icon=$(echo "$result" | cut -d'|' -f4)
    job_dir="$ARTIFACTS_DIR/$job_id"

    has_summary=false
    has_artifacts=false
    has_logs=false
    [ -f "$job_dir/step-summary.md" ] && [ -s "$job_dir/step-summary.md" ] && has_summary=true
    [ -d "$job_dir/artifacts" ] && [ "$(ls -A "$job_dir/artifacts" 2>/dev/null)" ] && has_artifacts=true
    [ -f "$job_dir/console.log" ] && [ -s "$job_dir/console.log" ] && has_logs=true

    # Skip jobs with no outputs
    if [ "$has_summary" = false ] && [ "$has_artifacts" = false ] && [ "$has_logs" = false ]; then
        continue
    fi

    # Print job header with status icon
    echo ""
    echo -e "${icon} ${BLUE}${BOLD}$job_name${NC}"

    # Step Summary sub-section
    if [ "$has_summary" = true ]; then
        echo ""
        echo -e "  ${BOLD}Step Summary${NC}"
        echo ""
        # Indent the summary content
        sed 's/^/    /' "$job_dir/step-summary.md"
    fi

    # Artifacts sub-section
    if [ "$has_artifacts" = true ]; then
        echo ""
        echo -e "  ${BOLD}Artifacts${NC}"
        echo ""
        for artifact in "$job_dir/artifacts"/*/; do
            [ -d "$artifact" ] || continue
            artifact_name=$(basename "$artifact")
            # Check for index.html for HTML reports
            if [ -f "$artifact/index.html" ]; then
                echo -e "    ${DIM}• $artifact_name: .act-artifacts/$job_id/artifacts/$artifact_name/index.html${NC}"
            else
                echo -e "    ${DIM}• $artifact_name: .act-artifacts/$job_id/artifacts/$artifact_name/${NC}"
            fi
        done
    fi

    # Console logs sub-section
    if [ "$has_logs" = true ]; then
        echo ""
        echo -e "  ${BOLD}Console Log${NC}"
        echo -e "    ${DIM}• .act-artifacts/$job_id/console.log${NC}"
    fi
done

echo ""
if [ "$FAILED" = true ]; then
    echo -e "${RED}Some jobs failed. Check output above for details.${NC}"
    exit 1
else
    echo -e "${GREEN}All jobs passed!${NC}"
    exit 0
fi
