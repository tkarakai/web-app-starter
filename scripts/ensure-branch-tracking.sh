#!/bin/bash
#
# ensure-branch-tracking.sh
#
# Ensures the current branch tracks its own remote branch (not main).
# This prevents accidental pushes to main when using Sync/Push buttons.
#
# Also installs a pre-push hook as a safety net.
#
# Usage:
#   ./scripts/ensure-branch-tracking.sh [--quiet]
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

# ============================================================
# GET CURRENT BRANCH INFO
# ============================================================
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

if [ -z "$CURRENT_BRANCH" ]; then
    log "${YELLOW}Not on a branch (detached HEAD) - skipping${NC}"
    exit 0
fi

# Skip if we're on main - nothing to fix
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    log "${BLUE}On main branch - skipping tracking fix${NC}"
    exit 0
fi

log "${BLUE}Checking branch tracking configuration...${NC}"

# ============================================================
# CHECK AND FIX BRANCH TRACKING
# ============================================================
# Get the current upstream branch (what this branch tracks)
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "")

if [ -z "$UPSTREAM" ]; then
    # No upstream set - need to push and set one
    log "  ${YELLOW}No upstream configured${NC}"
    log "  ${BLUE}Creating remote branch and setting upstream...${NC}"

    if git push -u origin "$CURRENT_BRANCH" 2>/dev/null; then
        log "  ${GREEN}✔ Remote branch created and tracking configured${NC}"
    else
        log_always "  ${YELLOW}Warning: Could not push to origin${NC}"
        log_always "  ${YELLOW}  You may need to run: git push -u origin $CURRENT_BRANCH${NC}"
    fi
elif [ "$UPSTREAM" = "origin/main" ] || [ "$UPSTREAM" = "origin/master" ]; then
    # Tracking main but we're on a feature branch - fix it
    log "  ${YELLOW}Branch is tracking $UPSTREAM (should track origin/$CURRENT_BRANCH)${NC}"
    log "  ${BLUE}Fixing upstream tracking...${NC}"

    # Check if remote branch already exists
    if git ls-remote --heads origin "$CURRENT_BRANCH" | grep -q "$CURRENT_BRANCH"; then
        # Remote branch exists - just update tracking
        git branch --set-upstream-to="origin/$CURRENT_BRANCH" "$CURRENT_BRANCH"
        log "  ${GREEN}✔ Tracking updated to origin/$CURRENT_BRANCH${NC}"
    else
        # Remote branch doesn't exist - push and create it
        if git push -u origin "$CURRENT_BRANCH" 2>/dev/null; then
            log "  ${GREEN}✔ Remote branch created and tracking configured${NC}"
        else
            log_always "  ${YELLOW}Warning: Could not push to origin${NC}"
            log_always "  ${YELLOW}  You may need to run: git push -u origin $CURRENT_BRANCH${NC}"
        fi
    fi
else
    # Already tracking something other than main - assume it's correct
    log "  ${GREEN}✔ Branch tracking: $UPSTREAM${NC}"
fi

# ============================================================
# INSTALL PRE-PUSH HOOK (safety net)
# ============================================================
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || git rev-parse --git-dir)
HOOK_PATH="$GIT_COMMON_DIR/hooks/pre-push"

install_hook() {
    mkdir -p "$(dirname "$HOOK_PATH")"
    cat > "$HOOK_PATH" << 'HOOK_EOF'
#!/bin/bash
#
# Pre-push hook: Prevents accidental pushes to main from feature branches
#
# This hook is installed by ensure-branch-tracking.sh
#

protected_branch="main"
current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

while read local_ref local_sha remote_ref remote_sha; do
    if [[ "$remote_ref" == "refs/heads/$protected_branch" ]]; then
        if [[ "$current_branch" == "$protected_branch" ]]; then
            continue
        fi
        echo ""
        echo "ERROR: Direct push to '$protected_branch' blocked."
        echo ""
        echo "  You're on branch: $current_branch"
        echo "  Attempting to push to: $protected_branch"
        echo ""
        echo "  To push to your feature branch instead:"
        echo "    git push -u origin $current_branch"
        echo ""
        exit 1
    fi
done

exit 0
HOOK_EOF
    chmod +x "$HOOK_PATH"
}

if [ ! -f "$HOOK_PATH" ]; then
    log "  ${BLUE}Installing pre-push hook (safety net)...${NC}"
    install_hook
    log "  ${GREEN}✔ Pre-push hook installed${NC}"
elif grep -q "ensure-branch-tracking.sh" "$HOOK_PATH" 2>/dev/null; then
    log "  ${GREEN}✔ Pre-push hook already installed${NC}"
else
    log "  ${YELLOW}Pre-push hook exists (not ours) - skipping${NC}"
fi

log "${GREEN}✔ Branch configuration complete${NC}"
