#!/bin/bash
# Resolve the single landing app in the selected checkout. Callers may inspect
# another source tree (deployment/rollback), independently of workflow code.
set -euo pipefail
root="${1:-.}"
for app in landing landing-static; do
  if [ -f "$root/apps/$app/package.json" ]; then
    printf '%s\n' "$app"
    exit 0
  fi
done
if [ "${2:-}" = "--required" ]; then
  echo "No landing app is installed. Keep apps/landing or apps/landing-static." >&2
  exit 1
fi
