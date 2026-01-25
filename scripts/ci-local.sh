#!/usr/bin/env bash
#
# Run all CI checks locally before pushing to GitHub.
# This mirrors what runs in .github/workflows/ci.yml
#
# Usage: bun run ci
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_step() {
  echo -e "\n"
  echo -e "${BLUE}▶ $1${NC}"
  echo -e "\n"
}

print_success() {
  echo -e "\n${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "\n${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

# Track timing
START_TIME=$(date +%s)

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    Local CI Check                            ║"
echo "║  Running the same checks as GitHub Actions CI workflow       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Step 1: TypeScript
print_step "TypeScript Check"
if bunx tsc --noEmit; then
  print_success "TypeScript check passed"
else
  print_error "TypeScript check failed"
  exit 1
fi

# Step 2: ESLint
print_step "ESLint"
if bun run lint; then
  print_success "ESLint passed"
else
  print_error "ESLint failed"
  exit 1
fi

# Step 3: Bun Unit Tests
print_step "Unit Tests (Bun)"
if bun run test; then
  print_success "Bun tests passed"
else
  print_error "Bun tests failed"
  exit 1
fi

# Step 4: Vitest Component Tests
print_step "Component Tests (Vitest)"
if bun run test:coverage; then
  print_success "Vitest tests passed"
else
  print_error "Vitest tests failed"
  exit 1
fi

# Step 5: Build
print_step "Production Build"
if bun run build; then
  print_success "Build succeeded"
else
  print_error "Build failed"
  exit 1
fi

# Step 6: E2E Tests (optional - can be slow)
if [[ "$1" == "--skip-e2e" ]]; then
  print_warning "Skipping E2E tests (--skip-e2e flag)"
else
  print_step "E2E Tests (Playwright)"
  if bun run test:e2e; then
    print_success "E2E tests passed"
  else
    print_error "E2E tests failed"
    exit 1
  fi
fi

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo -e "\n${GREEN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    All CI Checks Passed!                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "Total time: ${MINUTES}m ${SECONDS}s"
echo ""
