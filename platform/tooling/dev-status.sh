#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="$PROJECT_DIR/.dev-pids"
CONVEX_STATE_DIR="$HOME/.convex/anonymous-convex-backend-state"
source "$SCRIPT_DIR/dev-dashboard.sh"

# ============================================================
# HELPER FUNCTIONS
# ============================================================

get_deployment_name() {
    for env_file in "$PROJECT_DIR/packages/backend/.env.local" "$PROJECT_DIR/.env.local"; do
        if [ -f "$env_file" ]; then
            local result=$(grep "^CONVEX_DEPLOYMENT=" "$env_file" 2>/dev/null | sed 's/CONVEX_DEPLOYMENT=//' | sed 's/ #.*//' | sed 's/anonymous://')
            if [ -n "$result" ]; then
                echo "$result"
                return
            fi
        fi
    done
}

get_convex_ports() {
    local deployment_name="$1"
    local config_file="$CONVEX_STATE_DIR/$deployment_name/config.json"
    if [ -f "$config_file" ]; then
        local cloud_port=$(grep -o '"cloud":[0-9]*' "$config_file" | grep -o '[0-9]*')
        local site_port=$(grep -o '"site":[0-9]*' "$config_file" | grep -o '[0-9]*')
        echo "$cloud_port $site_port"
    fi
}

# Get app URL from its log file
get_app_url() {
    local app_name="$1"
    local log_file="$PROJECT_DIR/.next-${app_name}.log"
    if [ -f "$log_file" ]; then
        grep -o 'http://localhost:[0-9]*' "$log_file" | head -1
    fi
}

# Get PID for a service name from the PID file
get_pid() {
    local name="$1"
    if [ -f "$PID_FILE" ]; then
        grep "^${name}:" "$PID_FILE" 2>/dev/null | cut -d':' -f2
    fi
}

# Check if a PID is alive
is_running() {
    local pid="$1"
    [ -n "$pid" ] && "$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/dev-processes.ts" running "*" "$pid"
}

# ============================================================
# CHECK IF ANYTHING IS RUNNING
# ============================================================

ANY_RUNNING=false
if [ -f "$PID_FILE" ]; then
    while IFS= read -r line; do
        pid=$(echo "$line" | cut -d':' -f2)
        if is_running "$pid"; then
            ANY_RUNNING=true
            break
        fi
    done < "$PID_FILE"
fi

if [ "$ANY_RUNNING" = false ]; then
    echo ""
    echo -e "  ${YELLOW}No dev services running.${NC}"
    echo -e "  Start with: ${BLUE}bun run dev${NC}"
    echo ""
    exit 0
fi


# ============================================================
# DISPLAY
# ============================================================

# Rows are collected first so every column can be sized to its widest value.
# Parallel arrays (bash 3.2 compatible): a leading blank line, then the cells.
ROW_GAP=(); ROW_NAME=(); ROW_STATUS=(); ROW_STATUS_COLOR=(); ROW_URL=(); ROW_URL_COLOR=(); ROW_PID=()

add_row() {
    ROW_GAP+=("$1"); ROW_NAME+=("$2"); ROW_STATUS+=("$3"); ROW_STATUS_COLOR+=("$4")
    ROW_URL+=("$5"); ROW_URL_COLOR+=("$6"); ROW_PID+=("$7")
}

# Longest displayed values before truncation. A URL with nothing after it is
# never cut (it is a copy target); only cells that a later column follows are.
MAX_SERVICE_WIDTH=24
MAX_URL_WIDTH=40
STATUS_WIDTH=6

# widest MIN MAX value... : the longest value, within [MIN, MAX]
widest() {
    local width="$1" max="$2" value
    shift 2
    for value in "$@"; do
        [ "${#value}" -gt "$width" ] && width="${#value}"
    done
    [ "$width" -gt "$max" ] && width="$max"
    echo "$width"
}

# fit TEXT WIDTH : TEXT cut to WIDTH, ending in "..." when it was too long
fit() {
    local text="$1" width="$2"
    if [ "${#text}" -gt "$width" ]; then
        text="${text:0:$((width - 3))}..."
    fi
    printf '%s' "$text"
}

# cell TEXT WIDTH [COLOR] : TEXT in COLOR, padded with spaces (not colour codes) to WIDTH
cell() {
    local text
    text=$(fit "$1" "$2")
    printf '%b%s%b%*s' "${3:-}" "$text" "${3:+$NC}" $(($2 - ${#text})) ""
}

# rule WIDTH : a horizontal rule WIDTH characters wide
rule() {
    local i
    for ((i = 0; i < $1; i++)); do printf '─'; done
}

# Apps (in display order)
for app_name in landing web admin storybook; do
    pid=$(get_pid "next-${app_name}")
    if [ -n "$pid" ]; then
        url=$(get_app_url "$app_name")
        # Capitalize first letter (bash 3.2 compatible)
        display_name="$(echo "${app_name:0:1}" | tr '[:lower:]' '[:upper:]')${app_name:1}"
        if is_running "$pid"; then
            add_row "" "$display_name" "up" "$GREEN" "${url:-unknown}" "$BLUE" "$pid"
        else
            add_row "" "$display_name" "dead" "$RED" "-" "" "$pid"
        fi
    fi
done

# Convex backend
CONVEX_PID=$(get_pid "convex")
if [ -n "$CONVEX_PID" ]; then
    CLOUD_PORT=""
    SITE_PORT=""
    DEPLOYMENT_NAME=$(get_deployment_name)
    if [ -n "$DEPLOYMENT_NAME" ]; then
        PORTS=$(get_convex_ports "$DEPLOYMENT_NAME")
        if [ -n "$PORTS" ]; then
            CLOUD_PORT=$(echo $PORTS | cut -d' ' -f1)
            SITE_PORT=$(echo $PORTS | cut -d' ' -f2)
        fi
    fi

    if is_running "$CONVEX_PID"; then
        if [ -n "$CLOUD_PORT" ]; then
            add_row "gap" "Convex API" "up" "$GREEN" "http://127.0.0.1:$CLOUD_PORT" "$BLUE" "$CONVEX_PID"
        else
            add_row "gap" "Convex API" "up" "$GREEN" "unknown" "" "$CONVEX_PID"
        fi
        if [ -n "$SITE_PORT" ]; then
            add_row "" "Site API" "up" "$GREEN" "http://127.0.0.1:$SITE_PORT" "$BLUE" ""
        fi
        DASHBOARD_URL=$(get_dashboard_url)
        if [ -n "$DASHBOARD_URL" ]; then
            add_row "" "Convex UI" "" "$DIM" "$DASHBOARD_URL" "$BLUE" ""
        fi
    else
        add_row "gap" "Convex API" "dead" "$RED" "-" "" "$CONVEX_PID"
    fi
fi

SERVICE_WIDTH=$(widest 0 "$MAX_SERVICE_WIDTH" "SERVICE" "${ROW_NAME[@]}")
# URL cells that are the last value on their row do not count towards the width.
URL_CELLS=("URL")
for i in "${!ROW_URL[@]}"; do
    [ -n "${ROW_PID[$i]}" ] && URL_CELLS+=("${ROW_URL[$i]}")
done
URL_WIDTH=$(widest 0 "$MAX_URL_WIDTH" "${URL_CELLS[@]}")

echo ""
echo -e "${GREEN}  Development Environment Status${NC}"
echo ""

printf '  %s  %s  %s  %s\n' \
    "$(cell SERVICE "$SERVICE_WIDTH" "$YELLOW")" "$(cell STATUS "$STATUS_WIDTH" "$YELLOW")" \
    "$(cell URL "$URL_WIDTH" "$YELLOW")" "$(printf '%b%s%b' "$YELLOW" PID "$NC")"
printf '  %b%s  %s  %s  %s%b\n' "$YELLOW" \
    "$(rule "$SERVICE_WIDTH")" "$(rule "$STATUS_WIDTH")" "$(rule "$URL_WIDTH")" "─────" "$NC"

for i in "${!ROW_NAME[@]}"; do
    [ -n "${ROW_GAP[$i]}" ] && echo ""
    line="  $(cell "${ROW_NAME[$i]}" "$SERVICE_WIDTH")  $(cell "${ROW_STATUS[$i]}" "$STATUS_WIDTH" "${ROW_STATUS_COLOR[$i]}")  "
    if [ -n "${ROW_PID[$i]}" ]; then
        line+="$(cell "${ROW_URL[$i]}" "$URL_WIDTH" "${ROW_URL_COLOR[$i]}")  ${ROW_PID[$i]}"
    else
        line+="$(printf '%b%s%b' "${ROW_URL_COLOR[$i]}" "${ROW_URL[$i]}" "${ROW_URL_COLOR[$i]:+$NC}")"
    fi
    printf '%s\n' "$line"
done

# Logs
LOG_FILES=""
for app_name in landing web admin storybook; do
    pid=$(get_pid "next-${app_name}")
    if [ -n "$pid" ] && is_running "$pid"; then
        LOG_FILES="$LOG_FILES .next-${app_name}.log"
    fi
done
if [ -n "$CONVEX_PID" ] && is_running "$CONVEX_PID"; then
    LOG_FILES=".convex-dev.log$LOG_FILES"
fi
if [ -n "$LOG_FILES" ]; then
    echo ""
    echo -e "  ${YELLOW}Logs:${NC} tail -f ${LOG_FILES# }"
fi

echo ""
echo -e "  ${YELLOW}Stop with:${NC} bun dev:stop"
echo ""
