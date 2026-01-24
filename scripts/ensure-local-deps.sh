#!/bin/bash
#
# ensure-local-deps.sh
#
# Ensures this worktree has its own local dependencies and caches,
# not symlinks to the parent project. Symlinked node_modules and
# cache directories cause issues with test runners, build tools,
# and concurrent development across multiple worktrees.
#
# Usage:
#   ./scripts/ensure-local-deps.sh [--quiet]
#
# Options:
#   --quiet    Suppress informational output (only show errors/changes)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

QUIET=false
if [[ "$1" == "--quiet" ]]; then
    QUIET=true
fi

log() {
    if [[ "$QUIET" == false ]]; then
        echo -e "$1"
    fi
}

log_always() {
    echo -e "$1"
}

cd "$PROJECT_DIR"

# Directories that must be local (not symlinked)
# These are either installed dependencies or generated caches
MUST_BE_LOCAL=(
    "node_modules"
    ".next"
    "coverage"
    ".turbo"
    ".cache"
)

CHANGES_MADE=false

log "${BLUE}Checking for symlinked directories...${NC}"

for dir in "${MUST_BE_LOCAL[@]}"; do
    if [ -L "$dir" ]; then
        log_always "${YELLOW}Found symlink: $dir${NC}"

        # Get the target of the symlink for logging
        target=$(readlink "$dir" 2>/dev/null || echo "unknown")
        log_always "  ${BLUE}→ Target: $target${NC}"

        # Remove the symlink
        rm "$dir"
        log_always "  ${GREEN}✔ Removed symlink${NC}"

        CHANGES_MADE=true

        # Handle specific directories
        case "$dir" in
            "node_modules")
                log_always "${GREEN}▶ Running bun install to create local node_modules...${NC}"
                bun install
                log_always "${GREEN}✔ Local node_modules installed${NC}"
                ;;
            ".next")
                log "  ${BLUE}ℹ .next will be recreated on next build/dev${NC}"
                ;;
            "coverage")
                log "  ${BLUE}ℹ coverage will be recreated on next test run${NC}"
                ;;
            *)
                log "  ${BLUE}ℹ $dir will be recreated as needed${NC}"
                ;;
        esac

        echo ""
    elif [ -d "$dir" ]; then
        log "  ${GREEN}✔${NC} $dir is a real directory"
    fi
done

# Also check for symlinks in node_modules that point outside the project
# (This can happen with certain package managers or manual setups)
if [ -d "node_modules" ]; then
    # Check a few critical packages
    CRITICAL_PACKAGES=("vitest" "next" "@playwright/test")

    for pkg in "${CRITICAL_PACKAGES[@]}"; do
        pkg_path="node_modules/$pkg"
        if [ -L "$pkg_path" ]; then
            target=$(readlink "$pkg_path" 2>/dev/null || echo "unknown")
            # Check if target points outside the project
            if [[ "$target" == /* ]] || [[ "$target" == ../* && "$target" == *"../.."* ]]; then
                log_always "${YELLOW}Warning: $pkg_path is a symlink to $target${NC}"
                log_always "  ${YELLOW}This may cause issues. Consider running 'bun install' fresh.${NC}"
            fi
        fi
    done
fi

if [ "$CHANGES_MADE" = true ]; then
    log_always ""
    log_always "${GREEN}✔ Worktree isolation fixes applied${NC}"
else
    log "${GREEN}✔ All directories are properly local${NC}"
fi

# ============================================================
# ENSURE PLAYWRIGHT BROWSERS ARE INSTALLED
# ============================================================
# Playwright requires browsers to be downloaded separately.
# This ensures chromium is available for E2E testing.
# The install command is idempotent - it skips if already installed.

if [ -d "node_modules/@playwright/test" ]; then
    log "${BLUE}Checking Playwright browsers...${NC}"

    # Run playwright install - it's smart enough to skip if already installed
    # Capture output to detect if it actually installed something
    PLAYWRIGHT_OUTPUT=$(npx playwright install chromium 2>&1)

    if echo "$PLAYWRIGHT_OUTPUT" | grep -q "Downloading"; then
        log_always "${GREEN}✔ Playwright chromium installed${NC}"
        CHANGES_MADE=true
    else
        log "${GREEN}✔ Playwright browsers ready${NC}"
    fi
fi
