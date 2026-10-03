#!/usr/bin/env bash
# Playwright on a self-hosted runner. Browsers persist in ~/.cache/ms-playwright,
# so installing is a no-op once a version is there (Playwright locks the folder,
# so runners sharing it can install at the same time). Browser system libraries
# come from the runner image when it was built for this Playwright version.
set -euo pipefail

: "${PLAYWRIGHT_VERSION:?PLAYWRIGHT_VERSION is required}"
marker=/etc/starter-ci-runner

./node_modules/.bin/playwright install chromium

if [ -r "$marker" ] && grep -qx "playwright=${PLAYWRIGHT_VERSION}" "$marker"; then
  echo "Browser system libraries: provided by the runner image (Playwright ${PLAYWRIGHT_VERSION})"
  exit 0
fi

if [ -r "$marker" ]; then
  built_for=$(sed -n 's/^playwright=//p' "$marker")
  echo "::notice title=Rebuild the CI runner image::The runner image was built for Playwright ${built_for}; this commit uses ${PLAYWRIGHT_VERSION}. Rebuild it with PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION} to skip installing browser system libraries in every E2E job (platform/docs/private-repo-ci.md)."
fi
./node_modules/.bin/playwright install-deps chromium
