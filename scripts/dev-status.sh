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

if lsof -i :3000 > /dev/null 2>&1; then
    PROC=$(lsof -i :3000 | tail -1 | awk '{print $1, $2}')
    echo -e "  ${GREEN}✔${NC} Port 3000 (Next.js) in use by: $PROC"
else
    echo -e "  ${RED}✖${NC} Port 3000 (Next.js) not in use"
fi

# Check for URL mismatch
echo ""
echo -e "${YELLOW}Configuration Check:${NC}"
if [ -n "$CLOUD_PORT" ] && [ -n "$CONVEX_URL" ]; then
    EXPECTED_URL="NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:$CLOUD_PORT"
    if [ "$CONVEX_URL" = "$EXPECTED_URL" ]; then
        echo -e "  ${GREEN}✔${NC} NEXT_PUBLIC_CONVEX_URL matches backend config"
    else
        echo -e "  ${RED}✖${NC} NEXT_PUBLIC_CONVEX_URL mismatch!"
        echo "      Expected: $EXPECTED_URL"
        echo "      Found:    $CONVEX_URL"
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
    fi
fi

echo ""
