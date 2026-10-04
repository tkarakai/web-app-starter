#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="$PROJECT_DIR/apps/landing"
if [ ! -f "$APP_DIR/package.json" ]; then echo 'Landing is absent; export smoke not applicable.'; exit 0; fi
if [ "${1:-}" = "--variants" ]; then
  cd "$PROJECT_DIR"
  eval "$("$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/app-config.ts" shell)"
  export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-$APP_CONFIG_ORIGIN_LANDING}"
  export NEXT_PUBLIC_WEB_APP_URL="${NEXT_PUBLIC_WEB_APP_URL:-$APP_CONFIG_ORIGIN_WEB}"
  for variant in missing configured; do
    if [ "$variant" = missing ]; then site=""; expected=false; else site="https://placeholder.convex.site"; expected=true; fi
    NEXT_PUBLIC_CONVEX_SITE_URL="$site" bunx turbo build --filter=@repo/landing...
    EXPORT_EXPECT_CONFIGURED="$expected" "$0"
  done
  exit 0
fi
if [ ! -d "$APP_DIR/out" ]; then echo 'Build landing before testing its production export.' >&2; exit 1; fi
# Resolve the consumer's pinned Playwright, not a newly downloaded package.
SCRATCH=$(mktemp -d "$APP_DIR/.export-smoke.XXXXXX")
trap 'rm -rf "$SCRATCH"' EXIT
cp "$SCRIPT_DIR/landing-export/"*.ts "$SCRATCH/"
cd "$APP_DIR"
./node_modules/.bin/playwright test --config="$SCRATCH/playwright.config.ts"
