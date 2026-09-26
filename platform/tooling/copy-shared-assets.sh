#!/usr/bin/env bash
#
# copy-shared-assets.sh
# Copies the brand icons named in app.config.ts (brand.icons) into each app's
# public/ directory. Usage: packages/design-system/assets/README.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Icon sources from app.config.ts, relative to the repository root.
APP_CONFIG_VARS=$("${SCRIPT_DIR}/node-ts.sh" "${SCRIPT_DIR}/app-config.ts" shell) || exit 1
eval "${APP_CONFIG_VARS}"
: "${APP_CONFIG_ICON_SVG:?app.config.ts values missing (scripts/app-config.ts printed nothing)}"

# Published file name in public/ -> source. Apps reference the published names.
ASSETS=(
  "icon.svg"
  "favicon.ico"
  "apple-touch-icon.png"
)
SOURCES=(
  "${APP_CONFIG_ICON_SVG}"
  "${APP_CONFIG_ICON_ICO}"
  "${APP_CONFIG_ICON_APPLE_TOUCH}"
)

# Apps that need the assets
APPS=(
  "web"
  "admin"
  "landing"
  "landing-static"
  "storybook"
  # demo owns its public branding assets; never overwrite them.
)

# Validate all source assets exist before copying anything
for i in "${!ASSETS[@]}"; do
  if [[ ! -f "${REPO_ROOT}/${SOURCES[$i]}" ]]; then
    echo "[assets] Error: Source asset not found: ${SOURCES[$i]} (brand.icons in app.config.ts)" >&2
    exit 1
  fi
done

copied=0

for app in "${APPS[@]}"; do
  PUBLIC_DIR="${REPO_ROOT}/apps/${app}/public"
  mkdir -p "${PUBLIC_DIR}"

  for i in "${!ASSETS[@]}"; do
    asset="${ASSETS[$i]}"
    src="${REPO_ROOT}/${SOURCES[$i]}"
    dest="${PUBLIC_DIR}/${asset}"

    # Skip if destination is already identical
    if [[ -f "${dest}" ]] && cmp -s "${src}" "${dest}"; then
      continue
    fi

    cp "${src}" "${dest}"
    echo "  + Copied ${asset} to apps/${app}/public/"
    copied=$((copied + 1))
  done
done

if [[ ${copied} -eq 0 ]]; then
  echo "[assets] All apps already up to date."
else
  echo "[assets] Done. Copied ${copied} file(s)."
fi
