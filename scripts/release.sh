#!/usr/bin/env bash
# Prepare release metadata for a PR; never commit, tag or push here.
# Usage: ./scripts/release.sh 1.0.0 [--dry-run | --check | --notes] [--require-main]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec ./scripts/node-ts.sh scripts/release.ts "$@"
