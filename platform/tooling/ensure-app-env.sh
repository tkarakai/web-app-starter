#!/bin/bash
#
# ensure-app-env.sh
#
# Seeds a local .env.local for every app that ships an .env.example but does not
# have one yet.
#
# Next.js loads .env.local from the app directory, not the monorepo root, so each
# app needs its own. dev-start.sh writes them — but only for the apps it starts,
# so an app you have never run (landing-static, say) is left without one. Its
# build then fails the moment a route reads a required variable, which is easy to
# hit through `bun run build` or `bun run test:e2e` since turbo builds every app.
#
# Values come from the app's own checked-in .env.example. Local URLs are not in
# the examples: an empty URL key listed in config_default below is filled with
# the app's local origin from the ports in app.config.ts. Existing .env.local
# files are never touched.
#
# Only apps whose .env.example is self-sufficient are seeded — that is, every key
# has a value once the local URLs are filled in. apps/web and platform/apps/admin deliberately ship empty
# NEXT_PUBLIC_CONVEX_URL / NEXT_PUBLIC_CONVEX_SITE_URL entries, because those are
# only knowable once `convex dev` has assigned a port; dev-start.sh owns them.
# Copying an empty value there would swap one build failure for a more confusing
# one ("CONVEX_SITE_URL is not set"), so those apps are skipped.
#
# Usage:
#   ./platform/tooling/ensure-app-env.sh [--quiet]
#

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Local origins from app.config.ts, as APP_CONFIG_* variables.
APP_CONFIG_VARS=$("$SCRIPT_DIR/node-ts.sh" "$SCRIPT_DIR/app-config.ts" shell) || exit 1
eval "$APP_CONFIG_VARS"
: "${APP_CONFIG_PORT_WEB:?app.config.ts values missing (platform/tooling/app-config.ts printed nothing)}"

# The local default for an app's URL key, or nothing.
config_default() {
    case "$1:$2" in
        web:LANDING_URL)                          echo "$APP_CONFIG_ORIGIN_LANDING" ;;
        landing:NEXT_PUBLIC_SITE_URL)             echo "$APP_CONFIG_ORIGIN_LANDING" ;;
        landing-static:NEXT_PUBLIC_SITE_URL)      echo "$APP_CONFIG_ORIGIN_LANDING_STATIC" ;;
        landing:NEXT_PUBLIC_WEB_APP_URL|landing-static:NEXT_PUBLIC_WEB_APP_URL)
                                                  echo "$APP_CONFIG_ORIGIN_WEB" ;;
    esac
}

# Print an .env.example with its empty local-URL keys filled in.
fill_example() {
    local app_name="$1" example="$2" line key value
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=[[:space:]]*$ ]]; then
            key="${BASH_REMATCH[1]}"
            value=$(config_default "$app_name" "$key")
            if [ -n "$value" ]; then
                line="$key=$value"
            fi
        fi
        printf '%s\n' "$line"
    done < "$example"
}

QUIET=false
if [[ "$1" == "--quiet" ]]; then
    QUIET=true
fi

log() {
    if [[ "$QUIET" == false ]]; then
        echo -e "$1"
    fi
}

created=0

for app_dir in "$PROJECT_DIR"/apps/*/ "$PROJECT_DIR"/platform/apps/*/; do
    [ -d "$app_dir" ] || continue

    example="$app_dir.env.example"
    local_env="$app_dir.env.local"
    app_name="$(basename "$app_dir")"

    # Nothing to copy from — app takes no configuration.
    [ -f "$example" ] || continue

    # Never clobber a developer's real values.
    if [ -f "$local_env" ]; then
        continue
    fi

    filled=$(fill_example "$app_name" "$example")

    # Skip apps whose example still leaves keys blank — dev-start.sh fills those in.
    if grep -qE '^[A-Za-z_][A-Za-z0-9_]*=[[:space:]]*$' <<< "$filled"; then
        log "  ${YELLOW}—${NC} Skipped ${app_name}: .env.example needs values from dev-start.sh"
        continue
    fi

    printf '%s\n' "$filled" > "$local_env"
    created=$((created + 1))
    log "  ${GREEN}✔${NC} Created ${app_name}/.env.local from .env.example"
done

if [ "$created" -gt 0 ]; then
    log ""
    log "  ${YELLOW}Note:${NC} seeded $created .env.local file(s) with localhost defaults."
    log "  Ports are managed by dev-start.sh once you run that app."
else
    log "  ${GREEN}✔${NC} Every app already has its .env.local"
fi
