#!/bin/bash
set -euo pipefail
case "${1:-}" in
  github)
    # The manager supplies only a single-use JIT configuration via stdin.
    IFS= read -r jit
    cd /opt/runner
    exec ./run.sh --jitconfig "$jit"
    ;;
  smoke) exec node /opt/starter/smoke.mjs ;;
  exec) shift; exec "$@" ;;
  *) echo "Unknown worker mode" >&2; exit 2 ;;
esac
