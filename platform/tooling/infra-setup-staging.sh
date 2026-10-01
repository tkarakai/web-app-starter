#!/usr/bin/env bash
set -euo pipefail
# Compatibility entry point. The replacement never writes credentials to setup logs/files.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."
exec "$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/deploy-setup.ts" "$@"
