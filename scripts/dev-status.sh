#!/bin/bash

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
CONVEX_STATE_DIR="$HOME/.convex/convex-backend-state"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Development Environment Status${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get deployment name from .env.local
get_deployment_name() {
    if [ -f "$ENV_FILE" ]; then
        grep "^CONVEX_DEPLOYMENT=" "$ENV_FILE" 2>/dev/null | sed 's/CONVEX_DEPLOYMENT=//' | sed 's/ #.*//' | sed 's/local://'
    fi
}

# Check .env.local configuration
echo -e "${YELLOW}Configuration (.env.local):${NC}"
if [ -f "$ENV_FILE" ]; then
    DEPLOYMENT=$(grep "^CONVEX_DEPLOYMENT=" "$ENV_FILE" 2>/dev/null || echo "not set")
    CONVEX_URL=$(grep "^NEXT_PUBLIC_CONVEX_URL=" "$ENV_FILE" 2>/dev/null || echo "not set")
    SITE_URL=$(grep "^NEXT_PUBLIC_CONVEX_SITE_URL=" "$ENV_FILE" 2>/dev/null || echo "not set")

    echo "  $DEPLOYMENT"
    echo "  $CONVEX_URL"
    echo "  $SITE_URL"
else
    echo -e "  ${RED}.env.local not found${NC}"
fi

# Get actual ports from Convex config
echo ""
echo -e "${YELLOW}Convex Backend Config:${NC}"
DEPLOYMENT_NAME=$(get_deployment_name)
if [ -n "$DEPLOYMENT_NAME" ]; then
    CONFIG_FILE="$CONVEX_STATE_DIR/$DEPLOYMENT_NAME/config.json"
    if [ -f "$CONFIG_FILE" ]; then
        CLOUD_PORT=$(cat "$CONFIG_FILE" | grep -o '"cloud":[0-9]*' | grep -o '[0-9]*')
        SITE_PORT=$(cat "$CONFIG_FILE" | grep -o '"site":[0-9]*' | grep -o '[0-9]*')
        echo "  Deployment: $DEPLOYMENT_NAME"
        echo "  Config: $CONFIG_FILE"
        echo "  Cloud port: $CLOUD_PORT (NEXT_PUBLIC_CONVEX_URL should be http://127.0.0.1:$CLOUD_PORT)"
        echo "  Site port: $SITE_PORT (NEXT_PUBLIC_CONVEX_SITE_URL should be http://127.0.0.1:$SITE_PORT)"
    else
        echo -e "  ${RED}Config not found: $CONFIG_FILE${NC}"
    fi
else
    echo -e "  ${RED}No deployment configured${NC}"
fi

# Check running processes
echo ""
echo -e "${YELLOW}Running Processes:${NC}"
if [ -f "$PID_FILE" ]; then
    while IFS= read -r line; do
        name=$(echo "$line" | cut -d':' -f1)
        pid=$(echo "$line" | cut -d':' -f2)

        if kill -0 $pid 2>/dev/null; then
            echo -e "  ${GREEN}✔${NC} $name (PID: $pid) - running"
        else
            echo -e "  ${RED}✖${NC} $name (PID: $pid) - not running"
        fi
    done < "$PID_FILE"
else
    echo "  No PID file found (.dev-pids)"
fi

# Check if ports are actually in use
echo ""
echo -e "${YELLOW}Port Usage:${NC}"
if [ -n "$CLOUD_PORT" ]; then
    if lsof -i :$CLOUD_PORT > /dev/null 2>&1; then
        PROC=$(lsof -i :$CLOUD_PORT | tail -1 | awk '{print $1, $2}')
        echo -e "  ${GREEN}✔${NC} Port $CLOUD_PORT (Convex) in use by: $PROC"
    else
        echo -e "  ${RED}✖${NC} Port $CLOUD_PORT (Convex) not in use"
    fi
fi

if [ -n "$SITE_PORT" ]; then
    if lsof -i :$SITE_PORT > /dev/null 2>&1; then
        PROC=$(lsof -i :$SITE_PORT | tail -1 | awk '{print $1, $2}')
        echo -e "  ${GREEN}✔${NC} Port $SITE_PORT (Site API) in use by: $PROC"
    else
        echo -e "  ${RED}✖${NC} Port $SITE_PORT (Site API) not in use"
    fi
fi

# Try to detect Next.js port from log file or check common ports
NEXT_PORT=""
NEXT_LOG="$PROJECT_DIR/.next-dev.log"
if [ -f "$NEXT_LOG" ]; then
    NEXT_PORT=$(grep -o 'http://localhost:[0-9]*' "$NEXT_LOG" 2>/dev/null | head -1 | grep -o '[0-9]*$')
fi

# Fallback to checking common ports
if [ -z "$NEXT_PORT" ]; then
    for port in 3000 3001 3002 3003; do
        if lsof -i :$port 2>/dev/null | grep -q node; then
            NEXT_PORT=$port
            break
        fi
    done
fi

if [ -n "$NEXT_PORT" ] && lsof -i :$NEXT_PORT > /dev/null 2>&1; then
    PROC=$(lsof -i :$NEXT_PORT | tail -1 | awk '{print $1, $2}')
    echo -e "  ${GREEN}✔${NC} Port $NEXT_PORT (Next.js) in use by: $PROC"
else
    echo -e "  ${RED}✖${NC} Next.js not detected on common ports (3000-3003)"
fi

# Check for URL mismatch
echo ""
echo -e "${YELLOW}Configuration Check:${NC}"
CONFIG_OK=true
if [ -n "$CLOUD_PORT" ] && [ -n "$CONVEX_URL" ]; then
    EXPECTED_URL="NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:$CLOUD_PORT"
    if [ "$CONVEX_URL" = "$EXPECTED_URL" ]; then
        echo -e "  ${GREEN}✔${NC} NEXT_PUBLIC_CONVEX_URL matches backend config"
    else
        echo -e "  ${RED}✖${NC} NEXT_PUBLIC_CONVEX_URL mismatch!"
        echo "      Expected: $EXPECTED_URL"
        echo "      Found:    $CONVEX_URL"
        CONFIG_OK=false
    fi
fi

if [ -n "$SITE_PORT" ] && [ -n "$SITE_URL" ]; then
    EXPECTED_URL="NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:$SITE_PORT"
    if [ "$SITE_URL" = "$EXPECTED_URL" ]; then
        echo -e "  ${GREEN}✔${NC} NEXT_PUBLIC_CONVEX_SITE_URL matches backend config"
    else
        echo -e "  ${RED}✖${NC} NEXT_PUBLIC_CONVEX_SITE_URL mismatch!"
        echo "      Expected: $EXPECTED_URL"
        echo "      Found:    $SITE_URL"
        CONFIG_OK=false
    fi
fi

# Show URLs summary if services are running
CONVEX_RUNNING=false
NEXT_RUNNING=false

if [ -n "$CLOUD_PORT" ] && lsof -i :$CLOUD_PORT > /dev/null 2>&1; then
    CONVEX_RUNNING=true
fi

if [ -n "$NEXT_PORT" ] && lsof -i :$NEXT_PORT > /dev/null 2>&1; then
    NEXT_RUNNING=true
fi

if [ "$CONVEX_RUNNING" = true ] || [ "$NEXT_RUNNING" = true ]; then
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Services Running${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    if [ "$NEXT_RUNNING" = true ] && [ -n "$NEXT_PORT" ]; then
        echo -e "  ${BLUE}App:${NC}        http://localhost:$NEXT_PORT"
    fi

    if [ "$CONVEX_RUNNING" = true ] && [ -n "$CLOUD_PORT" ]; then
        echo -e "  ${BLUE}Convex:${NC}     http://127.0.0.1:$CLOUD_PORT"
    fi

    if [ "$CONVEX_RUNNING" = true ] && [ -n "$SITE_PORT" ]; then
        echo -e "  ${BLUE}Site API:${NC}   http://127.0.0.1:$SITE_PORT"
    fi

    if [ -n "$DEPLOYMENT_NAME" ]; then
        echo -e "  ${BLUE}Dashboard:${NC}  https://dashboard.convex.dev/d/$DEPLOYMENT_NAME"
    fi

    # Show PIDs if we have them
    if [ -f "$PID_FILE" ]; then
        echo ""
        echo -e "  ${YELLOW}PIDs:${NC}"
        while IFS= read -r line; do
            name=$(echo "$line" | cut -d':' -f1)
            pid=$(echo "$line" | cut -d':' -f2)
            if kill -0 $pid 2>/dev/null; then
                echo -e "    $name: $pid"
            fi
        done < "$PID_FILE"
    fi

    echo ""
    echo -e "  ${YELLOW}Stop with:${NC} bun run dev:stop"
else
    echo ""
    echo -e "${YELLOW}Services not running. Start with: bun run dev${NC}"
fi

echo ""
