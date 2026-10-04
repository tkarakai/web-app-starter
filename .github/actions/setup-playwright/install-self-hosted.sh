#!/usr/bin/env bash
# Managed workers must match their baked Playwright version. The fallback below
# supports externally operated runners with persistent browser caches and an
# optional system-library marker; see platform/docs/ci-workers.md.
set -euo pipefail

if [ "${STARTER_WORKER:-}" = "1" ]; then
  expected=$(jq -r .playwright /etc/starter-worker.json)
  test "$PLAYWRIGHT_VERSION" = "$expected" || { echo "Prepared Playwright mismatch; refresh the worker image" >&2; exit 1; }
  exit 0
fi

: "${PLAYWRIGHT_VERSION:?PLAYWRIGHT_VERSION is required}"
marker=/etc/starter-ci-runner

./node_modules/.bin/playwright install chromium

if [ -r "$marker" ] && grep -qx "playwright=${PLAYWRIGHT_VERSION}" "$marker"; then
  echo "Browser system libraries: provided by the runner image (Playwright ${PLAYWRIGHT_VERSION})"
  exit 0
fi

if [ -r "$marker" ]; then
  built_for=$(sed -n 's/^playwright=//p' "$marker")
  echo "::notice title=Rebuild the CI runner image::The runner image was built for Playwright ${built_for}; this commit uses ${PLAYWRIGHT_VERSION}. Rebuild it with PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION} to skip installing browser system libraries in every E2E job (platform/docs/ci-workers.md)."
fi
./node_modules/.bin/playwright install-deps chromium
