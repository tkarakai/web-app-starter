#!/bin/bash
# Download Chromium for the installed Playwright versions. E2E setup only;
# development startup must not depend on browser downloads.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

found=false
# Use each workspace's installed CLI, including hoisted installs. Never fetch
# a different Playwright version through a package runner. Repeated installs
# reuse the browser cache; different workspace versions get their own browser.
for cli in apps/*/node_modules/@playwright/test/cli.js node_modules/@playwright/test/cli.js; do
    [ -f "$cli" ] || continue
    found=true
    echo "[e2e] Ensuring Chromium for $cli"
    node "$cli" install chromium
done

if [ "$found" = false ]; then
    echo "[e2e] Playwright is not installed. Run 'bun install' before 'bun run setup:e2e'." >&2
    exit 1
fi
