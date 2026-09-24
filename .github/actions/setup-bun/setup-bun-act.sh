#!/usr/bin/env bash
set -euo pipefail

: "${BUN_VERSION:?BUN_VERSION is required}"
: "${GITHUB_PATH:?GITHUB_PATH is required}"
export BUN_INSTALL="${BUN_INSTALL:-/root/.bun}"

if [ -x "$BUN_INSTALL/bin/bun" ] && [ "$("$BUN_INSTALL/bin/bun" --version)" = "$BUN_VERSION" ]; then
  echo "Bun $BUN_VERSION already installed at $BUN_INSTALL"
else
  echo "Installing Bun $BUN_VERSION..."
  curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION"
fi

# A failed or stale installation must not silently run another Bun version.
[ "$("$BUN_INSTALL/bin/bun" --version)" = "$BUN_VERSION" ]
echo "$BUN_INSTALL/bin" >> "$GITHUB_PATH"
