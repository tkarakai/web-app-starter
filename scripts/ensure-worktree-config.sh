#!/bin/bash
#
# ensure-worktree-config.sh
#
# Configures git settings for worktrees to prevent accidental pushes to main.
# This script only runs when inside a git worktree (not the main working tree).
#
# What it does:
#   1. Sets push.default=current for this worktree only (requires git 2.20+)
#   2. Installs a pre-push hook to block direct pushes to main from feature branches
#
# Usage:
#   ./scripts/ensure-worktree-config.sh [--quiet]
#
# Options:
#   --quiet    Suppress informational output (only show errors/warnings)
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
# CHECK IF WE'RE IN A WORKTREE
# ============================================================
# A worktree has a .git file (not directory) pointing to the main repo.
# The main working tree has a .git directory.

if [ -d "$PROJECT_DIR/.git" ]; then
    log "${BLUE}Not a worktree (main working tree) - skipping worktree config${NC}"
    exit 0
fi

if [ ! -f "$PROJECT_DIR/.git" ]; then
    log "${YELLOW}Warning: Cannot determine if this is a worktree - skipping${NC}"
    exit 0
fi

# Verify it's actually a worktree by checking the gitdir pointer
if ! grep -q "^gitdir:" "$PROJECT_DIR/.git" 2>/dev/null; then
    log "${YELLOW}Warning: .git file doesn't contain gitdir - skipping${NC}"
    exit 0
fi

log "${BLUE}Configuring git worktree settings...${NC}"

# ============================================================
# CHECK GIT VERSION (need 2.20+ for worktreeConfig)
# ============================================================
GIT_VERSION=$(git --version | sed 's/git version //' | cut -d' ' -f1)
GIT_MAJOR=$(echo "$GIT_VERSION" | cut -d. -f1)
GIT_MINOR=$(echo "$GIT_VERSION" | cut -d. -f2)

# Need git 2.20 or higher for extensions.worktreeConfig
if [ "$GIT_MAJOR" -lt 2 ] || { [ "$GIT_MAJOR" -eq 2 ] && [ "$GIT_MINOR" -lt 20 ]; }; then
    log_always "${RED}Warning: Git version $GIT_VERSION is too old for per-worktree config${NC}"
    log_always "${RED}  Requires git 2.20+ for extensions.worktreeConfig${NC}"
    log_always "${RED}  Skipping worktree-specific push.default setting${NC}"
    log_always ""
    log_always "${YELLOW}  Recommendation: Update git or set globally:${NC}"
    log_always "${YELLOW}    git config --global push.default current${NC}"
    # Don't exit - still try to install the hook
else
    # ============================================================
    # ENABLE WORKTREE CONFIG EXTENSION
    # ============================================================
    # This allows per-worktree configuration via git config --worktree
    # Note: Older git versions won't be able to access this repo after enabling

    WORKTREE_CONFIG_ENABLED=$(git config --get extensions.worktreeConfig 2>/dev/null || echo "false")

    if [ "$WORKTREE_CONFIG_ENABLED" != "true" ]; then
        log "  ${BLUE}Enabling extensions.worktreeConfig...${NC}"
        git config extensions.worktreeConfig true
        log "  ${GREEN}✔ worktreeConfig extension enabled${NC}"
    fi

    # ============================================================
    # SET PUSH.DEFAULT FOR THIS WORKTREE
    # ============================================================
    CURRENT_PUSH_DEFAULT=$(git config --worktree --get push.default 2>/dev/null || echo "")

    if [ "$CURRENT_PUSH_DEFAULT" != "current" ]; then
        git config --worktree push.default current
        log "  ${GREEN}✔ Set push.default=current (worktree-specific)${NC}"
    else
        log "  ${GREEN}✔ push.default=current already set${NC}"
    fi
fi

# ============================================================
# INSTALL PRE-PUSH HOOK
# ============================================================
# This hook blocks direct pushes to main from feature branches.
# It's installed in the shared hooks directory, so it applies to all worktrees.

GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
HOOK_PATH="$GIT_COMMON_DIR/hooks/pre-push"

install_hook() {
    cat > "$HOOK_PATH" << 'HOOK_EOF'
#!/bin/bash
#
# Pre-push hook: Prevents accidental pushes to main from feature branches
#
# This hook is installed by ensure-worktree-config.sh
#

protected_branch="main"
current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

# Read the push details from stdin
while read local_ref local_sha remote_ref remote_sha; do
    # Check if pushing to the protected branch
    if [[ "$remote_ref" == "refs/heads/$protected_branch" ]]; then
        # Allow if we're on the protected branch itself
        if [[ "$current_branch" == "$protected_branch" ]]; then
            continue
        fi

        # Block push from feature branch to main
        echo ""
        echo "ERROR: Direct push to '$protected_branch' blocked."
        echo ""
        echo "  You're on branch: $current_branch"
        echo "  Attempting to push to: $protected_branch"
        echo ""
        echo "  To push to your feature branch instead:"
        echo "    git push -u origin $current_branch"
        echo ""
        echo "  To create a pull request:"
        echo "    gh pr create"
        echo ""
        exit 1
    fi
done

exit 0
HOOK_EOF
    chmod +x "$HOOK_PATH"
}

if [ ! -f "$HOOK_PATH" ]; then
    log "  ${BLUE}Installing pre-push hook...${NC}"
    install_hook
    log "  ${GREEN}✔ Pre-push hook installed${NC}"
else
    # Check if it's our hook (contains our signature comment)
    if grep -q "ensure-worktree-config.sh" "$HOOK_PATH" 2>/dev/null; then
        log "  ${GREEN}✔ Pre-push hook already installed${NC}"
    else
        log_always "  ${YELLOW}Warning: Pre-push hook exists but wasn't installed by this script${NC}"
        log_always "  ${YELLOW}  Location: $HOOK_PATH${NC}"
        log_always "  ${YELLOW}  Skipping hook installation to avoid overwriting${NC}"
    fi
fi

log "${GREEN}✔ Worktree git configuration complete${NC}"
