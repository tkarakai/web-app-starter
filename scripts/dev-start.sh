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
PID_FILE="$PROJECT_DIR/.dev-pids"
CONVEX_STATE_DIR="$HOME/.convex/anonymous-convex-backend-state"

# ============================================================
# PARSE ARGUMENTS
# ============================================================
# --ci          Non-interactive/foreground mode (for Playwright)
# --app=NAME    Start specific app(s): web, admin, landing (comma-separated)
# No --app flag means start all apps

NON_INTERACTIVE=false
FORCE_RESTART=false
SELECTED_APPS=""

for arg in "$@"; do
    case "$arg" in
        --ci)
            NON_INTERACTIVE=true
            ;;
        --restart)
            FORCE_RESTART=true
            ;;
        --app=*)
            SELECTED_APPS="${arg#--app=}"
            ;;
    esac
done

# Auto-detect CI environment
if [[ "$CI" == "true" ]] || [ ! -t 0 ]; then
    NON_INTERACTIVE=true
fi

# Determine which apps to start
START_WEB=false
START_ADMIN=false
START_LANDING=false
START_STORYBOOK=false
NEED_CONVEX=false

if [ -z "$SELECTED_APPS" ]; then
    # No --app flag: start everything
    START_WEB=true
    START_ADMIN=true
    START_LANDING=true
    START_STORYBOOK=true
    NEED_CONVEX=true
else
    # Parse comma-separated app names
    IFS=',' read -ra APP_LIST <<< "$SELECTED_APPS"
    for app in "${APP_LIST[@]}"; do
        case "$app" in
            web)
                START_WEB=true
                NEED_CONVEX=true
                ;;
            admin)
                START_ADMIN=true
                NEED_CONVEX=true
                ;;
            landing)
                START_LANDING=true
                NEED_CONVEX=true
                ;;
            storybook)
                START_STORYBOOK=true
                # Storybook showcase doesn't need Convex
                ;;
            *)
                echo -e "${RED}Unknown app: $app${NC}"
                echo "Available apps: web, admin, landing, storybook"
                exit 1
                ;;
        esac
    done
fi

if [ "$NON_INTERACTIVE" = true ]; then
    echo "[CI MODE] Running in non-interactive/foreground mode"
    echo "[CI MODE] Current directory: $(pwd)"
    echo "[CI MODE] Script directory: $SCRIPT_DIR"
    echo "[CI MODE] Project directory: $PROJECT_DIR"
    echo "[CI MODE] Apps: web=$START_WEB admin=$START_ADMIN landing=$START_LANDING storybook=$START_STORYBOOK convex=$NEED_CONVEX"
fi

echo -e "${BLUE}  Starting Development Environment...${NC}"

cd "$PROJECT_DIR"

# In CI mode, show environment info
if [ "$NON_INTERACTIVE" = true ]; then
    echo "[CI MODE] Environment check:"
    echo "  - bun version: $(bun --version 2>/dev/null || echo 'not found')"
    echo "  - node version: $(node --version 2>/dev/null || echo 'not found')"
    echo "  - npx version: $(npx --version 2>/dev/null || echo 'not found')"
    echo "  - HOME: $HOME"
    echo ""
fi

# ============================================================
# ENSURE LOCAL DEPENDENCIES (worktree isolation)
# ============================================================
if [ "$NON_INTERACTIVE" = false ]; then
    "$SCRIPT_DIR/ensure-local-deps.sh" --quiet
else
    echo "[CI MODE] Skipping ensure-local-deps.sh (not needed in CI)"
fi

# ============================================================
# ENSURE BRANCH TRACKING (push protection)
# ============================================================
if [ "$NON_INTERACTIVE" = false ]; then
    "$SCRIPT_DIR/ensure-branch-tracking.sh"
else
    echo "[CI MODE] Skipping ensure-branch-tracking.sh (not needed in CI)"
fi

# ============================================================
# HELPER FUNCTIONS
# ============================================================

# Get deployment name from packages/backend/.env.local or root .env.local
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

# Update a single env variable in a file
update_env_var() {
    local env_file="$1"
    local var_name="$2"
    local var_value="$3"
    local temp_file=$(mktemp)
    local found=false

    if [ -f "$env_file" ]; then
        while IFS= read -r line || [ -n "$line" ]; do
            if [[ "$line" =~ ^${var_name}= ]]; then
                echo "${var_name}=${var_value}"
                found=true
            else
                echo "$line"
            fi
        done < "$env_file" > "$temp_file"
    fi

    if [ "$found" = false ]; then
        echo "${var_name}=${var_value}" >> "$temp_file"
    fi

    mv "$temp_file" "$env_file"
}

# Extract local Dashboard URL from Convex log
extract_dashboard_url() {
    local log_file="$1"
    grep -o 'http://127\.0\.0\.1:[0-9]*/?d=[^ ]*' "$log_file" | head -1
}

# Get ports from Convex config
get_convex_ports() {
    local deployment_name="$1"
    local config_file="$CONVEX_STATE_DIR/$deployment_name/config.json"

    if [ -f "$config_file" ]; then
        local cloud_port=$(cat "$config_file" | grep -o '"cloud":[0-9]*' | grep -o '[0-9]*')
        local site_port=$(cat "$config_file" | grep -o '"site":[0-9]*' | grep -o '[0-9]*')
        echo "$cloud_port $site_port"
    fi
}

# Update Convex URLs in an app's .env.local
update_app_env_urls() {
    local env_file="$1"
    local cloud_port="$2"
    local site_port="$3"

    local cloud_url="http://127.0.0.1:$cloud_port"
    local site_url="http://127.0.0.1:$site_port"

    # Ensure file exists
    touch "$env_file"

    update_env_var "$env_file" "NEXT_PUBLIC_CONVEX_URL" "$cloud_url"
    update_env_var "$env_file" "NEXT_PUBLIC_CONVEX_SITE_URL" "$site_url"
}

# Check if esbuild binary is functional (Convex uses it to bundle functions)
check_esbuild() {
    local esbuild_bin=""

    # 1. Direct platform binary (classic node_modules layout)
    if [ -x "$PROJECT_DIR/node_modules/@esbuild/darwin-arm64/bin/esbuild" ]; then
        esbuild_bin="$PROJECT_DIR/node_modules/@esbuild/darwin-arm64/bin/esbuild"
    # 2. Bun's deduped layout: node_modules/.bun/@esbuild+darwin-arm64@*/...
    else
        local bun_esbuild
        bun_esbuild=$(ls "$PROJECT_DIR"/node_modules/.bun/@esbuild+darwin-arm64@*/node_modules/@esbuild/darwin-arm64/bin/esbuild 2>/dev/null | head -1)
        if [ -x "$bun_esbuild" ]; then
            esbuild_bin="$bun_esbuild"
        fi
    fi
    # 3. Wrapper script in .bin
    if [ -z "$esbuild_bin" ] && [ -x "$PROJECT_DIR/node_modules/.bin/esbuild" ]; then
        esbuild_bin="$PROJECT_DIR/node_modules/.bin/esbuild"
    fi

    if [ -z "$esbuild_bin" ]; then
        echo "missing"
        return
    fi

    # Run with a 3-second timeout — a working esbuild responds instantly.
    # Use a background process + watchdog kill instead of perl alarm, which
    # doesn't reliably terminate a hung binary after exec replaces perl.
    local tmpfile
    tmpfile=$(mktemp)
    "$esbuild_bin" --version > "$tmpfile" 2>/dev/null &
    local pid=$!
    (sleep 3 && kill "$pid" 2>/dev/null) &
    local watchdog=$!
    wait "$pid" 2>/dev/null
    local exit_code=$?
    kill "$watchdog" 2>/dev/null
    wait "$watchdog" 2>/dev/null

    local version
    version=$(cat "$tmpfile")
    rm -f "$tmpfile"

    if [ $exit_code -eq 0 ] && [ -n "$version" ]; then
        echo "$version"
    else
        echo "broken"
    fi
}

# Print esbuild fix instructions
print_esbuild_fix() {
    echo -e "${RED}  esbuild binary is missing or corrupted.${NC}"
    echo -e "${RED}  Convex uses esbuild to bundle functions — it will hang without a working binary.${NC}"
    echo ""
    echo -e "${YELLOW}  Fix: reinstall dependencies${NC}"
    echo -e "    rm -rf node_modules && bun install"
    echo ""
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
        if [ "$FORCE_RESTART" = true ] || [ ! -t 0 ]; then
            # --restart flag or non-interactive: auto-stop without prompting
            echo -e "${YELLOW}Stopping existing processes...${NC}"
            "$SCRIPT_DIR/dev-stop.sh"
            echo ""
        else
            echo -e "${YELLOW}Already running processes found:${NC}"
            echo -e "$RUNNING_PIDS"
            echo ""
            echo -e "  ${YELLOW}Options:${NC}"
            echo -e "    [q] Quit — leave them running, do nothing (default)"
            echo -e "    [r] Restart — stop them and start fresh"
            echo ""
            read -p "Choice [Q/r]: " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Rr]$ ]]; then
                echo ""
                echo -e "${YELLOW}Stopping existing processes...${NC}"
                "$SCRIPT_DIR/dev-stop.sh"
                echo ""
            else
                "$SCRIPT_DIR/dev-status.sh"
                exit 0
            fi
        fi
    else
        rm -f "$PID_FILE"
    fi
fi

# ============================================================
# CHECK FOR ORPHANED PROCESSES
# ============================================================
# Detect stale convex-local-backend or Next.js dev processes that aren't tracked
# in .dev-pids (e.g. from a crashed terminal or killed script).

kill_orphans() {
    local pids="$1"
    local label="$2"
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            local cmd=$(ps -p "$pid" -o args= 2>/dev/null | head -c 80)
            kill "$pid" 2>/dev/null || true
            sleep 0.3
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
            echo -e "  ${GREEN}✔ Killed $label (PID $pid): $cmd${NC}"
        fi
    done
}

ORPHAN_CONVEX=$(pgrep -f "convex-local-backend" 2>/dev/null || true)
ORPHAN_NEXT=$(pgrep -f "next dev" 2>/dev/null | while read pid; do
    # Only match Next.js processes rooted in this project
    ps -p "$pid" -o args= 2>/dev/null | grep -q "$PROJECT_DIR" && echo "$pid"
done || true)

if [ -n "$ORPHAN_CONVEX" ] || [ -n "$ORPHAN_NEXT" ]; then
    ORPHAN_COUNT=$(echo "$ORPHAN_CONVEX $ORPHAN_NEXT" | wc -w | tr -d ' ')
    echo -e "${YELLOW}⚠ Found $ORPHAN_COUNT orphaned dev process(es) (not tracked in .dev-pids):${NC}"
    for pid in $ORPHAN_CONVEX; do
        echo -e "  ${RED}convex-local-backend${NC} (PID $pid)"
    done
    for pid in $ORPHAN_NEXT; do
        cmd=$(ps -p "$pid" -o args= 2>/dev/null | head -c 80)
        echo -e "  ${RED}next dev${NC} (PID $pid): $cmd"
    done
    echo ""

    if [ ! -t 0 ]; then
        echo -e "${YELLOW}Non-interactive mode: killing orphaned processes...${NC}"
        kill_orphans "$ORPHAN_CONVEX" "convex-local-backend"
        kill_orphans "$ORPHAN_NEXT" "next dev"
        echo ""
    else
        read -p "Kill them? [Y/n]: " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            kill_orphans "$ORPHAN_CONVEX" "convex-local-backend"
            kill_orphans "$ORPHAN_NEXT" "next dev"
            echo ""
        fi
    fi
fi

# ============================================================
# START CONVEX (if needed)
# ============================================================
CLOUD_PORT=""
SITE_PORT=""

if [ "$NEED_CONVEX" = true ]; then
    # Pre-flight: verify esbuild works (Convex hangs if it's corrupted)
    ESBUILD_STATUS=$(check_esbuild)
    if [ "$ESBUILD_STATUS" = "missing" ] || [ "$ESBUILD_STATUS" = "broken" ]; then
        echo -e "${RED}✖ Pre-flight check failed${NC}"
        print_esbuild_fix
        exit 1
    fi

    echo -e "${GREEN}▶ Starting Convex (anonymous mode)...${NC}"

    # Convex runs from packages/backend/
    CONVEX_DIR="$PROJECT_DIR/packages/backend"

    if [ "$NON_INTERACTIVE" = true ]; then
        echo "[CI MODE] Convex state dir: $CONVEX_STATE_DIR"
        echo "[CI MODE] Starting: CONVEX_AGENT_MODE=anonymous CONVEX_VERBOSE=1 npx convex dev (from $CONVEX_DIR)"
        (cd "$CONVEX_DIR" && CONVEX_AGENT_MODE=anonymous CONVEX_VERBOSE=1 npx convex dev > "$PROJECT_DIR/.convex-dev.log" 2>&1) &
        CONVEX_PID=$!
        echo "[CI MODE] Convex process started with PID: $CONVEX_PID"
    else
        (cd "$CONVEX_DIR" && CONVEX_AGENT_MODE=anonymous npx convex dev > "$PROJECT_DIR/.convex-dev.log" 2>&1) &
        CONVEX_PID=$!
    fi
    echo "convex:$CONVEX_PID" > "$PID_FILE"

    MAX_WAIT=60
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

        if [ "$NON_INTERACTIVE" = true ] && [ $((WAITED % 5)) -eq 0 ]; then
            echo "[CI MODE] Waiting for Convex... ${WAITED}s elapsed"
            echo "[CI MODE] Last 5 lines of Convex log:"
            tail -5 "$PROJECT_DIR/.convex-dev.log" 2>/dev/null | sed 's/^/  /' || echo "  (no log yet)"
        else
            printf "\r${YELLOW}  Waiting for Convex to initialize... %ds${NC}" $WAITED
        fi
    done

    printf "\n"

    if [ "$CONVEX_READY" = false ]; then
        echo -e "${RED}✖ Timeout waiting for Convex to start${NC}"

        # Check if it got stuck on bundling (esbuild issue)
        if grep -q "Preparing Convex functions" "$PROJECT_DIR/.convex-dev.log" 2>/dev/null; then
            ESBUILD_STATUS=$(check_esbuild)
            if [ "$ESBUILD_STATUS" = "missing" ] || [ "$ESBUILD_STATUS" = "broken" ]; then
                echo ""
                print_esbuild_fix
            else
                echo -e "${RED}  Stuck bundling functions. Try: CONVEX_VERBOSE=1 npx convex dev${NC}"
            fi
        fi

        echo -e "${RED}  Log output:${NC}"
        cat "$PROJECT_DIR/.convex-dev.log"
        echo ""
        echo -e "${YELLOW}  Tip: Use 'bun dev:stop' to stop any running instances.${NC}"
        kill $CONVEX_PID 2>/dev/null || true
        rm -f "$PID_FILE"
        exit 1
    fi

    # Read the actual ports Convex is using
    DEPLOYMENT_NAME=$(get_deployment_name)

    if [ -n "$DEPLOYMENT_NAME" ]; then
        PORTS=$(get_convex_ports "$DEPLOYMENT_NAME")
        if [ -n "$PORTS" ]; then
            CLOUD_PORT=$(echo $PORTS | cut -d' ' -f1)
            SITE_PORT=$(echo $PORTS | cut -d' ' -f2)

            # Update .env.local for each app that needs Convex
            if [ "$START_WEB" = true ]; then
                update_app_env_urls "$PROJECT_DIR/apps/web/.env.local" "$CLOUD_PORT" "$SITE_PORT"
            fi
            if [ "$START_ADMIN" = true ]; then
                update_app_env_urls "$PROJECT_DIR/apps/admin/.env.local" "$CLOUD_PORT" "$SITE_PORT"
            fi
            if [ "$START_LANDING" = true ]; then
                update_app_env_urls "$PROJECT_DIR/apps/landing/.env.local" "$CLOUD_PORT" "$SITE_PORT"
            fi
        fi
    fi

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

    if [ "$NON_INTERACTIVE" = true ]; then
        echo "[CI MODE] Checking/setting BETTER_AUTH_SECRET..."
    fi

    AUTH_SECRET_SET=false
    if (cd "$CONVEX_DIR" && bunx convex env get BETTER_AUTH_SECRET > /dev/null 2>&1); then
        EXISTING_SECRET=$(cd "$CONVEX_DIR" && bunx convex env get BETTER_AUTH_SECRET 2>/dev/null)
        if [ -n "$EXISTING_SECRET" ] && [ "$EXISTING_SECRET" != "undefined" ]; then
            AUTH_SECRET_SET=true
        fi
    fi

    if [ "$AUTH_SECRET_SET" = false ]; then
        echo -e "  ${YELLOW}Generating BETTER_AUTH_SECRET...${NC}"
        NEW_SECRET=$(openssl rand -base64 32)
        if ! (cd "$CONVEX_DIR" && bunx convex env set BETTER_AUTH_SECRET "$NEW_SECRET" 2>&1); then
            echo -e "  ${RED}Failed to set BETTER_AUTH_SECRET${NC}"
            if [ "$NON_INTERACTIVE" = true ]; then
                echo "[CI MODE] This might be expected if Convex env commands aren't available"
            fi
        else
            echo -e "  ${GREEN}✔${NC} BETTER_AUTH_SECRET configured"
        fi
    else
        echo -e "  ${GREEN}✔${NC} BETTER_AUTH_SECRET already set"
    fi

    # ============================================================
    # SEED DEV USERS (admin + regular user for quick login)
    # ============================================================
    echo ""
    echo -e "${GREEN}▶ Seeding dev users...${NC}"
    if ! (cd "$CONVEX_DIR" && bunx convex env set DEV_SEED_ENABLED true 2>&1); then
        echo -e "  ${YELLOW}⚠${NC} Could not set DEV_SEED_ENABLED (non-fatal)"
    fi
    SEED_OUTPUT=$(cd "$CONVEX_DIR" && bunx convex run devSeed:seed 2>&1) || true
    if echo "$SEED_OUTPUT" | grep -q "Already seeded"; then
        echo -e "  ${GREEN}✔${NC} Dev users already exist"
    elif echo "$SEED_OUTPUT" | grep -q "Dev seed complete"; then
        echo -e "  ${GREEN}✔${NC} Dev users created (admin@admin.com / adminadmin, user@user.com / useruser)"
    else
        echo -e "  ${YELLOW}⚠${NC} Dev seed: ${SEED_OUTPUT:-no output} (non-fatal)"
    fi
else
    # Create PID file even if Convex isn't needed
    > "$PID_FILE"
fi

# ============================================================
# START NEXT.JS APPS
# ============================================================

find_available_port() {
    local preferred="$1"
    local port="$preferred"
    local max_port=$((preferred + 10))

    while [ "$port" -le "$max_port" ]; do
        if ! lsof -i :"$port" > /dev/null 2>&1; then
            echo "$port"
            return
        fi
        port=$((port + 1))
    done

    # Fallback: let the OS pick
    echo "0"
}

start_next_app() {
    local app_name="$1"
    local app_dir="$PROJECT_DIR/apps/$app_name"
    local log_file="$PROJECT_DIR/.next-${app_name}.log"
    local preferred_port="$2"

    echo ""
    echo -e "${GREEN}▶ Starting Next.js ($app_name)...${NC}"

    # Find an available port, starting from the preferred one
    local actual_port=$(find_available_port "$preferred_port")
    if [ "$actual_port" != "$preferred_port" ] && [ "$actual_port" != "0" ]; then
        echo -e "  ${YELLOW}Port $preferred_port in use, using $actual_port${NC}"
    fi

    (cd "$app_dir" && bunx next dev --turbopack --port "$actual_port" > "$log_file" 2>&1) &
    local next_pid=$!
    echo "next-${app_name}:$next_pid" >> "$PID_FILE"

    local max_wait=60
    local waited=0
    local next_ready=false

    while [ $waited -lt $max_wait ]; do
        sleep 1
        waited=$((waited + 1))

        if ! kill -0 $next_pid 2>/dev/null; then
            printf "\n"
            echo -e "${RED}✖ Next.js ($app_name) process exited${NC}"
            echo -e "${RED}  Log output:${NC}"
            cat "$log_file"
            exit 1
        fi

        if grep -q "Ready in" "$log_file" 2>/dev/null || \
           grep -q "Local:" "$log_file" 2>/dev/null; then
            next_ready=true
            break
        fi

        if [ "$NON_INTERACTIVE" = true ] && [ $((waited % 5)) -eq 0 ]; then
            echo "[CI MODE] Waiting for Next.js ($app_name)... ${waited}s elapsed"
            echo "[CI MODE] Last 5 lines of log:"
            tail -5 "$log_file" 2>/dev/null | sed 's/^/  /' || echo "  (no log yet)"
        else
            printf "\r${YELLOW}  Waiting for Next.js ($app_name) to start... %ds${NC}" $waited
        fi
    done

    printf "\n"

    if [ "$next_ready" = false ]; then
        echo -e "${RED}✖ Timeout waiting for Next.js ($app_name) to start${NC}"
        echo -e "${RED}  Log output:${NC}"
        cat "$log_file"
        exit 1
    fi

    # Read the actual URL/port from the log (Next.js reports it)
    local next_url=$(grep -o 'http://localhost:[0-9]*' "$log_file" | head -1)
    if [ -z "$next_url" ]; then
        next_url="http://localhost:$actual_port"
    fi

    local next_port=$(echo "$next_url" | grep -o '[0-9]*$')

    # Update NEXT_PUBLIC_SITE_URL for this app
    if [ -n "$next_port" ]; then
        update_env_var "$app_dir/.env.local" "NEXT_PUBLIC_SITE_URL" "http://localhost:$next_port"
    fi

    # Sync SITE_URL to Convex if this is the web app
    if [ "$app_name" = "web" ] && [ "$NEED_CONVEX" = true ] && [ -n "$next_port" ]; then
        (cd "$PROJECT_DIR/packages/backend" && bunx convex env set SITE_URL "http://localhost:$next_port" > /dev/null 2>&1) || true
        echo -e "  ${GREEN}✔${NC} SITE_URL synced to Convex"
    fi

    # Export the URL so callers can use it (e.g. to configure cross-app links)
    LAST_APP_URL="$next_url"

    echo -e "${GREEN}✔ Next.js ($app_name) ready (PID: $next_pid)${NC}"
    echo -e "  ${BLUE}App URL:${NC}    $next_url"
}

# Start apps in dependency order:
#   1. Web first (so we know its URL for cross-app links)
#   2. Admin
#   3. Landing last (needs WEB_APP_URL configured)
LAST_APP_URL=""
WEB_APP_URL=""
ADMIN_APP_URL=""
LANDING_APP_URL=""
APP_URLS=""  # Comma-separated list of all app URLs for Better Auth

if [ "$START_WEB" = true ]; then
    start_next_app "web" 3001
    WEB_APP_URL="$LAST_APP_URL"
    APP_URLS="$LAST_APP_URL"
fi

if [ "$START_ADMIN" = true ]; then
    start_next_app "admin" 3002
    ADMIN_APP_URL="$LAST_APP_URL"
    if [ -n "$APP_URLS" ]; then
        APP_URLS="$APP_URLS,$LAST_APP_URL"
    else
        APP_URLS="$LAST_APP_URL"
    fi
fi

if [ "$START_LANDING" = true ]; then
    # Ensure landing's .env.local has the web app URL for cross-app links
    touch "$PROJECT_DIR/apps/landing/.env.local"
    if [ -n "$WEB_APP_URL" ]; then
        update_env_var "$PROJECT_DIR/apps/landing/.env.local" "NEXT_PUBLIC_WEB_APP_URL" "$WEB_APP_URL"
        echo -e "  ${GREEN}✔${NC} NEXT_PUBLIC_WEB_APP_URL set to $WEB_APP_URL for landing"
    fi
    start_next_app "landing" 3000
    LANDING_APP_URL="$LAST_APP_URL"

    # Set the landing URL in the web app so auth pages can link back
    if [ "$START_WEB" = true ] && [ -n "$LANDING_APP_URL" ]; then
        update_env_var "$PROJECT_DIR/apps/web/.env.local" "NEXT_PUBLIC_LANDING_URL" "$LANDING_APP_URL"
        echo -e "  ${GREEN}✔${NC} NEXT_PUBLIC_LANDING_URL set to $LANDING_APP_URL for web"
    fi
fi

if [ "$START_STORYBOOK" = true ]; then
    start_next_app "storybook" 3003
fi

# ============================================================
# UPDATE BETTER AUTH WITH ALL APP URLS
# ============================================================
# Better Auth needs to know all the app origins that will authenticate
# Set SITE_URL to comma-separated list of all app URLs
if [ "$NEED_CONVEX" = true ] && [ -n "$APP_URLS" ]; then
    echo ""
    echo -e "${GREEN}▶ Updating Better Auth with app origins...${NC}"
    (cd "$PROJECT_DIR/packages/backend" && bunx convex env set SITE_URL "$APP_URLS" > /dev/null 2>&1) || true
    echo -e "  ${GREEN}✔${NC} SITE_URL set to: $APP_URLS"
fi

# In CI mode, show final env contents
if [ "$NON_INTERACTIVE" = true ]; then
    echo ""
    for app_name in web admin landing storybook; do
        local_env="$PROJECT_DIR/apps/$app_name/.env.local"
        if [ -f "$local_env" ]; then
            echo "[CI MODE] apps/$app_name/.env.local:"
            cat "$local_env" 2>/dev/null | sed 's/^/  /' || true
        fi
    done
fi

# ============================================================
# PRE-WARM PAGES (trigger first compilation so pages load instantly)
# ============================================================
echo ""
echo -e "${GREEN}▶ Pre-warming pages (first compile)...${NC}"

WARM_PIDS=()
WARM_LABELS=()

# Warm up each app by hitting the pages users actually visit first.
# Use -L to follow redirects (proxy redirects / → /sign-in for unauthed users)
# and --max-time to avoid hanging if something is wrong.
if [ "$START_WEB" = true ] && [ -n "$WEB_APP_URL" ]; then
    curl -sL --max-time 30 -o /dev/null "$WEB_APP_URL/sign-in" 2>/dev/null &
    WARM_PIDS+=($!)
    WARM_LABELS+=("web /sign-in")
fi
if [ "$START_ADMIN" = true ] && [ -n "$ADMIN_APP_URL" ]; then
    curl -sL --max-time 30 -o /dev/null "$ADMIN_APP_URL/sign-in" 2>/dev/null &
    WARM_PIDS+=($!)
    WARM_LABELS+=("admin /sign-in")
fi
if [ "$START_LANDING" = true ] && [ -n "$LANDING_APP_URL" ]; then
    curl -sL --max-time 30 -o /dev/null "$LANDING_APP_URL" 2>/dev/null &
    WARM_PIDS+=($!)
    WARM_LABELS+=("landing /")
fi

# Wait for all warm-up requests to complete
for i in "${!WARM_PIDS[@]}"; do
    pid=${WARM_PIDS[$i]}
    label=${WARM_LABELS[$i]}
    if wait "$pid" 2>/dev/null; then
        echo -e "  ${GREEN}✔${NC} $label"
    else
        echo -e "  ${YELLOW}⚠${NC} $label (timed out — will compile on first visit)"
    fi
done

# ============================================================
# SUMMARY (delegates to dev-status.sh for a single source of truth)
# ============================================================
"$SCRIPT_DIR/dev-status.sh"

# ============================================================
# FOREGROUND MODE (CI/Playwright)
# ============================================================
if [ "$NON_INTERACTIVE" = true ]; then
    echo "[CI MODE] Staying in foreground, streaming logs..."
    echo "[CI MODE] Press Ctrl+C to stop"
    echo ""

    cleanup() {
        echo ""
        echo "[CI MODE] Shutting down..."
        "$SCRIPT_DIR/dev-stop.sh"
        exit 0
    }

    trap cleanup SIGINT SIGTERM EXIT

    # Stream all log files
    LOG_FILES="$PROJECT_DIR/.convex-dev.log"
    [ "$START_LANDING" = true ] && LOG_FILES="$LOG_FILES $PROJECT_DIR/.next-landing.log"
    [ "$START_WEB" = true ] && LOG_FILES="$LOG_FILES $PROJECT_DIR/.next-web.log"
    [ "$START_ADMIN" = true ] && LOG_FILES="$LOG_FILES $PROJECT_DIR/.next-admin.log"
    [ "$START_STORYBOOK" = true ] && LOG_FILES="$LOG_FILES $PROJECT_DIR/.next-storybook.log"

    tail -f $LOG_FILES &
    TAIL_PID=$!

    # Wait for any child process to exit
    while true; do
        if [ "$NEED_CONVEX" = true ] && ! kill -0 $CONVEX_PID 2>/dev/null; then
            echo ""
            echo -e "${RED}[CI MODE] Convex process died unexpectedly${NC}"
            cat "$PROJECT_DIR/.convex-dev.log"
            kill $TAIL_PID 2>/dev/null || true
            exit 1
        fi
        # Check all Next.js PIDs from PID file
        if [ -f "$PID_FILE" ]; then
            while IFS= read -r line; do
                name=$(echo "$line" | cut -d':' -f1)
                pid=$(echo "$line" | cut -d':' -f2)
                if [[ "$name" == next-* ]] && ! kill -0 $pid 2>/dev/null; then
                    echo ""
                    echo -e "${RED}[CI MODE] $name process died unexpectedly${NC}"
                    kill $TAIL_PID 2>/dev/null || true
                    exit 1
                fi
            done < "$PID_FILE"
        fi
        sleep 5
    done
fi
