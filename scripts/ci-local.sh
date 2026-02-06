#!/usr/bin/env bash
#
# Run all CI checks locally before pushing to GitHub.
# This mirrors what runs in .github/workflows/ci.yml
#
# Uses Turborepo to orchestrate across all workspace packages.
#
# Checks included:
#   1. TypeScript check (all packages)
#   2. ESLint (all packages)
#   3. Bun unit tests (apps/web)
#   4. Vitest component tests with coverage (apps/web)
#   5. Convex backend tests (packages/backend)
#   6. Production build (all apps)
#   7. Bundle size check (apps/web)
#   8. E2E tests (Playwright) - optional, skip with --skip-e2e
#
# NOT included (CI-only):
#   - Lighthouse performance audits (requires browser automation setup)
#
# Usage: bun run ci
#        bun run ci:quick  # Skip E2E tests
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
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│                    Local CI Check                            │"
echo "│  Running the same checks as GitHub Actions CI workflow       │"
echo "└──────────────────────────────────────────────────────────────┘"
echo -e "${NC}"

# Step 1: TypeScript
print_step "TypeScript Check (all packages)"
if turbo typecheck; then
  print_success "TypeScript check passed"
else
  print_error "TypeScript check failed"
  exit 1
fi

# Step 2: ESLint
print_step "ESLint (all packages)"
if turbo lint; then
  print_success "ESLint passed"
else
  print_error "ESLint failed"
  exit 1
fi

# Step 3: Bun Unit Tests
print_step "Unit Tests (Bun)"
if turbo test; then
  print_success "Bun tests passed"
else
  print_error "Bun tests failed"
  exit 1
fi

# Step 4: Vitest Component Tests
print_step "Component Tests (Vitest)"
if turbo test:unit; then
  print_success "Vitest tests passed"
else
  print_error "Vitest tests failed"
  exit 1
fi

# Step 5: Convex Backend Tests
print_step "Backend Tests (Convex)"
if turbo test:convex; then
  print_success "Convex tests passed"
else
  print_error "Convex tests failed"
  exit 1
fi

# Step 6: Build
print_step "Production Build (all apps)"
if turbo build; then
  print_success "Build succeeded"
else
  print_error "Build failed"
  exit 1
fi

# Step 7: Bundle Size Check
print_step "Bundle Size Check"
if (cd apps/web && bun run size); then
  print_success "Bundle size check passed"
else
  print_error "Bundle size check failed"
  exit 1
fi

# Step 8: E2E Tests (optional - can be slow)
if [[ "$1" == "--skip-e2e" ]]; then
  print_warning "Skipping E2E tests (--skip-e2e flag)"
else
  print_step "E2E Tests (Playwright)"
  if turbo test:e2e; then
    print_success "E2E tests passed"
  else
    print_error "E2E tests failed"
    exit 1
  fi
fi

# Note: Lighthouse performance audits are not included in local CI.
# They require browser automation setup and are better suited for CI environments.

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo -e "\n${GREEN}"
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│                  ✅ All CI Checks Passed!                    │"
echo "└──────────────────────────────────────────────────────────────┘"
echo -e "${NC}"
echo -e "Total time: ${MINUTES}m ${SECONDS}s"
echo ""
