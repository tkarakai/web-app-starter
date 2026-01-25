#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env.local"
PID_FILE="$PROJECT_DIR/.dev-pids"
CONVEX_STATE_DIR="$HOME/.convex/anonymous-convex-backend-state"

echo -e "${BLUE}  Starting Development Environment...${NC}"

cd "$PROJECT_DIR"

# ============================================================
# ENSURE LOCAL DEPENDENCIES (worktree isolation)
# ============================================================
# This checks for symlinked node_modules and other directories
# that should be local to this worktree. Symlinks cause issues
# with test runners and concurrent development.
"$SCRIPT_DIR/ensure-local-deps.sh" --quiet

# ============================================================
# ENSURE BRANCH TRACKING (push protection)
# ============================================================
# Warns if the branch tracks a differently-named remote branch.
# Also installs a pre-push hook as a safety net.
# This script never modifies git config - only informs the user.
"$SCRIPT_DIR/ensure-branch-tracking.sh"

# Function to get deployment name from .env.local
get_deployment_name() {
    if [ -f "$ENV_FILE" ]; then
        grep "^CONVEX_DEPLOYMENT=" "$ENV_FILE" 2>/dev/null | sed 's/CONVEX_DEPLOYMENT=//' | sed 's/ #.*//' | sed 's/anonymous://'
    fi
}

# Function to update a single env variable in .env.local
update_env_var() {
    local var_name="$1"
    local var_value="$2"
    local temp_file=$(mktemp)
    local found=false

    if [ -f "$ENV_FILE" ]; then
        while IFS= read -r line || [ -n "$line" ]; do
            if [[ "$line" =~ ^${var_name}= ]]; then
                echo "${var_name}=${var_value}"
                found=true
            else
                echo "$line"
            fi
        done < "$ENV_FILE" > "$temp_file"
    fi

    if [ "$found" = false ]; then
        echo "${var_name}=${var_value}" >> "$temp_file"
    fi

    mv "$temp_file" "$ENV_FILE"
}

# Function to extract local Dashboard URL from Convex log
extract_dashboard_url() {
    local log_file="$1"
    grep -o 'http://127\.0\.0\.1:[0-9]*/?d=[^ ]*' "$log_file" | head -1
}

# Function to get ports from Convex config
get_convex_ports() {
    local deployment_name="$1"
    local config_file="$CONVEX_STATE_DIR/$deployment_name/config.json"

    if [ -f "$config_file" ]; then
        local cloud_port=$(cat "$config_file" | grep -o '"cloud":[0-9]*' | grep -o '[0-9]*')
        local site_port=$(cat "$config_file" | grep -o '"site":[0-9]*' | grep -o '[0-9]*')
        echo "$cloud_port $site_port"
    fi
}

# Function to update .env.local with correct URLs
update_env_urls() {
    local cloud_port="$1"
    local site_port="$2"

    local cloud_url="http://127.0.0.1:$cloud_port"
    local site_url="http://127.0.0.1:$site_port"

    local temp_file=$(mktemp)

    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" =~ ^NEXT_PUBLIC_CONVEX_URL= ]]; then
            echo "NEXT_PUBLIC_CONVEX_URL=$cloud_url"
        elif [[ "$line" =~ ^NEXT_PUBLIC_CONVEX_SITE_URL= ]]; then
            echo "NEXT_PUBLIC_CONVEX_SITE_URL=$site_url"
        else
            echo "$line"
        fi
    done < "$ENV_FILE" > "$temp_file"

    if ! grep -q "^NEXT_PUBLIC_CONVEX_URL=" "$temp_file"; then
        echo "NEXT_PUBLIC_CONVEX_URL=$cloud_url" >> "$temp_file"
    fi

    if ! grep -q "^NEXT_PUBLIC_CONVEX_SITE_URL=" "$temp_file"; then
        echo "NEXT_PUBLIC_CONVEX_SITE_URL=$site_url" >> "$temp_file"
    fi

    mv "$temp_file" "$ENV_FILE"
}

# ============================================================
# PRE-FLIGHT CHECKS
# ============================================================
echo ""

# Check if we already have processes running from THIS project
HAS_RUNNING_PROCESSES=false
if [ -f "$PID_FILE" ]; then
    RUNNING_PIDS=""
    while IFS= read -r line; do
        name=$(echo "$line" | cut -d':' -f1)
        pid=$(echo "$line" | cut -d':' -f2)
        if [ -n "$pid" ] && kill -0 $pid 2>/dev/null; then
            RUNNING_PIDS="$RUNNING_PIDS  $name: $pid\n"
            HAS_RUNNING_PROCESSES=true
        fi
    done < "$PID_FILE"

    if [ "$HAS_RUNNING_PROCESSES" = true ]; then
        # Non-interactive mode (CI/Playwright) - auto-stop existing processes
        if [ ! -t 0 ]; then
            echo -e "${YELLOW}Non-interactive mode: stopping existing processes...${NC}"
            "$SCRIPT_DIR/dev-stop.sh"
            echo ""
        else
            echo -e "${YELLOW}Already running processes found:${NC}"
            echo -e "$RUNNING_PIDS"
            echo ""
            echo -e "  ${YELLOW}Options:${NC}"
            echo -e "    [s] Stop them and start fresh"
            echo -e "    [q] Quit and leave them running"
            echo ""
            read -p "Choice [s/Q]: " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Ss]$ ]]; then
                echo ""
                echo -e "${YELLOW}Stopping existing processes...${NC}"
                "$SCRIPT_DIR/dev-stop.sh"
                echo ""
            else
                echo -e "${YELLOW}Aborted. Use 'bun dev:stop' to stop running processes.${NC}"
                exit 0
            fi
        fi
    else
        # PID file exists but processes aren't running - clean it up
        rm -f "$PID_FILE"
    fi
fi


# ============================================================
# START CONVEX
# ============================================================
echo -e "${GREEN}▶ Starting Convex (anonymous mode)...${NC}"

CONVEX_AGENT_MODE=anonymous CONVEX_VERBOSE=1 npx convex dev > "$PROJECT_DIR/.convex-dev.log" 2>&1 &
CONVEX_PID=$!
echo "convex:$CONVEX_PID" > "$PID_FILE"

MAX_WAIT=30
WAITED=0
CONVEX_READY=false

while [ $WAITED -lt $MAX_WAIT ]; do
    sleep 1
    WAITED=$((WAITED + 1))

    if ! kill -0 $CONVEX_PID 2>/dev/null; then
        printf "\n"
        echo -e "${RED}✖ Convex process exited${NC}"
        echo -e "${RED}  Log output:${NC}"
        cat "$PROJECT_DIR/.convex-dev.log"
        echo ""
        echo -e "${YELLOW}  Tip: Use 'bun dev:stop' to stop any running instances.${NC}"
        rm -f "$PID_FILE"
        exit 1
    fi

    if grep -q "Convex functions ready" "$PROJECT_DIR/.convex-dev.log" 2>/dev/null; then
        CONVEX_READY=true
        break
    fi

    printf "\r${YELLOW}  Waiting for Convex to initialize... %ds${NC}" $WAITED
done

printf "\n"

if [ "$CONVEX_READY" = false ]; then
    echo -e "${RED}✖ Timeout waiting for Convex to start${NC}"
    echo -e "${RED}  Log output:${NC}"
    cat "$PROJECT_DIR/.convex-dev.log"
    echo ""
    echo -e "${YELLOW}  Tip: Use 'bun dev:stop' to stop any running instances.${NC}"
    kill $CONVEX_PID 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
fi

# Read the actual ports Convex is using and update .env.local
DEPLOYMENT_NAME=$(get_deployment_name)
CLOUD_PORT=""
SITE_PORT=""
DASHBOARD_URL=""

if [ -n "$DEPLOYMENT_NAME" ]; then
    PORTS=$(get_convex_ports "$DEPLOYMENT_NAME")
    if [ -n "$PORTS" ]; then
        CLOUD_PORT=$(echo $PORTS | cut -d' ' -f1)
        SITE_PORT=$(echo $PORTS | cut -d' ' -f2)
        update_env_urls "$CLOUD_PORT" "$SITE_PORT"
    fi
fi

# Extract Dashboard URL from Convex output
DASHBOARD_URL=$(extract_dashboard_url "$PROJECT_DIR/.convex-dev.log")

echo -e "${GREEN}✔ Convex ready (PID: $CONVEX_PID)${NC}"
echo -e "  ${BLUE}Deployment:${NC} $DEPLOYMENT_NAME"
echo -e "  ${BLUE}Convex URL:${NC} http://127.0.0.1:$CLOUD_PORT"
echo -e "  ${BLUE}Site URL:${NC}   http://127.0.0.1:$SITE_PORT"
if [ -n "$DASHBOARD_URL" ]; then
    echo -e "  ${BLUE}Dashboard:${NC}  $DASHBOARD_URL"
fi

# ============================================================
# SETUP BETTER AUTH (if needed)
# ============================================================
echo ""
echo -e "${GREEN}▶ Checking Better Auth configuration...${NC}"

# Check if BETTER_AUTH_SECRET is set
AUTH_SECRET_SET=false
if bunx convex env get BETTER_AUTH_SECRET > /dev/null 2>&1; then
    EXISTING_SECRET=$(bunx convex env get BETTER_AUTH_SECRET 2>/dev/null)
    if [ -n "$EXISTING_SECRET" ] && [ "$EXISTING_SECRET" != "undefined" ]; then
        AUTH_SECRET_SET=true
    fi
fi

if [ "$AUTH_SECRET_SET" = false ]; then
    echo -e "  ${YELLOW}Generating BETTER_AUTH_SECRET...${NC}"
    NEW_SECRET=$(openssl rand -base64 32)
    bunx convex env set BETTER_AUTH_SECRET "$NEW_SECRET" > /dev/null 2>&1
    echo -e "  ${GREEN}✔${NC} BETTER_AUTH_SECRET configured"
else
    echo -e "  ${GREEN}✔${NC} BETTER_AUTH_SECRET already set"
fi

# SITE_URL will be set after Next.js starts with the actual port

# ============================================================
# START NEXT.JS
# ============================================================
echo ""
echo -e "${GREEN}▶ Starting Next.js...${NC}"
bunx next dev > "$PROJECT_DIR/.next-dev.log" 2>&1 &
NEXT_PID=$!
echo "next:$NEXT_PID" >> "$PID_FILE"

MAX_WAIT=30
WAITED=0
NEXT_READY=false

while [ $WAITED -lt $MAX_WAIT ]; do
    sleep 1
    WAITED=$((WAITED + 1))

    if ! kill -0 $NEXT_PID 2>/dev/null; then
        printf "\n"
        echo -e "${RED}✖ Next.js process exited${NC}"
        echo -e "${RED}  Log output:${NC}"
        cat "$PROJECT_DIR/.next-dev.log"
        exit 1
    fi

    if grep -q "Ready in" "$PROJECT_DIR/.next-dev.log" 2>/dev/null || \
       grep -q "Local:" "$PROJECT_DIR/.next-dev.log" 2>/dev/null; then
        NEXT_READY=true
        break
    fi

    printf "\r${YELLOW}  Waiting for Next.js to start... %ds${NC}" $WAITED
done

printf "\n"

if [ "$NEXT_READY" = false ]; then
    echo -e "${RED}✖ Timeout waiting for Next.js to start${NC}"
    echo -e "${RED}  Log output:${NC}"
    cat "$PROJECT_DIR/.next-dev.log"
    exit 1
fi

NEXT_URL=$(grep -o 'http://localhost:[0-9]*' "$PROJECT_DIR/.next-dev.log" | head -1)
if [ -z "$NEXT_URL" ]; then
    NEXT_URL="http://localhost:3000"
fi

# Update NEXT_PUBLIC_SITE_URL with the actual port
NEXT_PORT=$(echo "$NEXT_URL" | grep -o '[0-9]*$')
if [ -n "$NEXT_PORT" ]; then
    update_env_var "NEXT_PUBLIC_SITE_URL" "http://localhost:$NEXT_PORT"
    # Always sync Convex SITE_URL with actual Next.js port
    bunx convex env set SITE_URL "http://localhost:$NEXT_PORT" > /dev/null 2>&1
fi

echo -e "${GREEN}✔ Next.js ready (PID: $NEXT_PID)${NC}"
echo -e "  ${BLUE}App URL:${NC}    $NEXT_URL"
echo -e "  ${GREEN}✔${NC} SITE_URL synced to Convex"

# ============================================================
# SUMMARY
# ============================================================
echo ""
echo -e "${GREEN}  Development Environment Ready!${NC}"
echo ""
echo -e "  ${YELLOW}Logs:${NC}"
echo -e "    Convex:  tail -f .convex-dev.log"
echo -e "    Next.js: tail -f .next-dev.log"
echo ""
echo -e "  ${YELLOW}Stop with:${NC} bun dev:stop"
echo ""
