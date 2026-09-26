#!/bin/bash
set -e

# Stop only services whose recorded identity still belongs to this checkout.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/dev-processes.ts" stop
