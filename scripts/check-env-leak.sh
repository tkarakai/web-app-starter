#!/usr/bin/env bash
#
# Fail if an environment-specific value was baked into a build artifact.
#
# Build-once/promote requires that an artifact built against one environment's
# config can be deployed to another. That holds only when no environment-specific
# value was inlined at build time. Next.js inlines every NEXT_PUBLIC_* variable
# into the client bundle, and inlines any process.env read that happens during a
# static prerender — so the guarantee cannot be established by reading the source.
# It has to be checked against the output.
#
# Usage:
#   scripts/check-env-leak.sh <app> [--warn]
#
#     --warn   report leaks but exit 0 (used while the migration is in progress)
#
# Values are read from the pulled Vercel env file when present, else from the
# ambient environment.
set -euo pipefail

APP="${1:?usage: check-env-leak.sh <app> [--warn]}"
MODE="${2:-}"

# Variables whose values differ per environment. An artifact containing any of
# these values is pinned to the environment it was built for.
ENV_IDENTITY_VARS=(
  CONVEX_URL
  CONVEX_SITE_URL
  SITE_URL
  LANDING_URL
  WEB_APP_URL
  APP_ENVIRONMENT
  BETTER_AUTH_URL
  AUTH_URL
)

# Variables that identify the build rather than the environment. These are
# identical across a promote, so inlining them is correct and expected:
#   NEXT_PUBLIC_GIT_SHA, NEXT_PUBLIC_GIT_BRANCH, NEXT_PUBLIC_DEPLOY_TIMESTAMP,
#   NEXT_PUBLIC_BUILD_ID, NEXT_PUBLIC_APP_NAME

# Short values ("staging", "production") are too common to grep for by value —
# a match would be noise. For these, detect the inlined identifier instead.
MIN_VALUE_LEN=12

ENV_FILE="${ENV_FILE:-.vercel/.env.production.local}"

# `vercel pull` writes values double-quoted with an escaped newline, e.g.
#   NEXT_PUBLIC_CONVEX_URL="https://festive-civet-955.convex.cloud\n"
# Sourcing the file yields a needle with a literal \n that never matches, which
# silently turns this check into a no-op. Parse the line instead.
value_of() {
  local name="$1" raw=""
  if [ -f "$ENV_FILE" ]; then
    raw=$(grep -E "^${name}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)
  fi
  [ -z "$raw" ] && raw="${!name:-}"
  raw="${raw%\"}"; raw="${raw#\"}"
  raw="${raw%\'}"; raw="${raw#\'}"
  raw="${raw%\\n}"
  printf '%s' "$raw" | tr -d '\r\n' | sed -e 's/[[:space:]]*$//'
}

SCAN_PATHS=()
[ -d ".vercel/output" ] && SCAN_PATHS+=(".vercel/output")
[ -d "apps/${APP}/.next" ] && SCAN_PATHS+=("apps/${APP}/.next")
if [ ${#SCAN_PATHS[@]} -eq 0 ]; then
  echo "::error::No build output found to scan for app '${APP}'"
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  echo "Reading environment-identity values from ${ENV_FILE}"
else
  echo "No ${ENV_FILE}; using ambient environment"
fi
echo "Scanning: ${SCAN_PATHS[*]}"

# --exclude-dir=cache  turbopack's build cache is not shipped in the artifact
# --exclude='*.map'    sourcemaps are not served to the client
GREP_OPTS=(-rlF --exclude='*.map' --exclude-dir=cache --exclude-dir=dev)

leaks=0
report() {
  echo "::error::$1"
  shift
  printf '%s\n' "$@" | sed 's/^/    /'
  leaks=$((leaks + 1))
}

for var in "${ENV_IDENTITY_VARS[@]}"; do
  for name in "$var" "NEXT_PUBLIC_${var}"; do
    value="$(value_of "$name")"
    [ -z "$value" ] && continue

    if [ "${#value}" -lt "$MIN_VALUE_LEN" ]; then
      # Too short to match by value; look for the inlined identifier instead.
      if hits=$(grep "${GREP_OPTS[@]}" "$name" "${SCAN_PATHS[@]}" 2>/dev/null) && [ -n "$hits" ]; then
        report "Environment variable inlined into artifact: ${name} (value too short to match directly)" "$hits"
      fi
      continue
    fi

    if hits=$(grep "${GREP_OPTS[@]}" "$value" "${SCAN_PATHS[@]}" 2>/dev/null) && [ -n "$hits" ]; then
      report "Environment value leaked into artifact: ${name}=${value}" "$hits"
    fi
  done
done

if [ "$leaks" -gt 0 ]; then
  cat <<'MSG'

Build is NOT promotable — environment-specific values are baked in.
Each value above must be resolved at request time instead of build time:
  - Server code: read process.env.<VAR> (unprefixed) from a dynamically rendered route.
  - Client code: read it from the public-config provider, which the root layout
    populates at request time.
See docs/claude/build-once-promote-plan.md
MSG
  if [ "$MODE" = "--warn" ]; then
    echo "::warning::${leaks} leak(s) found; not failing the build (--warn)"
    exit 0
  fi
  exit 1
fi

echo "OK: no environment-identity values in the artifact — safe to promote."
