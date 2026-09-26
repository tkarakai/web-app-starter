#!/bin/bash
set -e

# Leave Next.js and every other checkout's Convex deployment alone.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/dev-processes.ts" stop --name convex
