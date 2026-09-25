#!/usr/bin/env bash
#
# copy-shared-assets.sh
# Shared branding usage: packages/design-system/assets/README.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ASSETS_DIR="${REPO_ROOT}/packages/design-system/assets"

# Shared assets to copy (add new files here)
ASSETS=(
  "icon.svg"
  "favicon.ico"
  "apple-touch-icon.png"
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

# Validate all source assets exist
for asset in "${ASSETS[@]}"; do
  if [[ ! -f "${ASSETS_DIR}/${asset}" ]]; then
    echo "[assets] Error: Source asset not found: ${ASSETS_DIR}/${asset}" >&2
    exit 1
  fi
done

# App-owned sources live outside public/, whose icon files are generated and ignored.
# Check every override before copying so a typo cannot silently restore starter branding.
for app in "${APPS[@]}"; do
  BRANDING_DIR="${REPO_ROOT}/apps/${app}/branding"
  if [[ -e "${BRANDING_DIR}" || -L "${BRANDING_DIR}" ]]; then
    if [[ ! -d "${BRANDING_DIR}" || -L "${BRANDING_DIR}" ]]; then
      echo "[assets] Error: branding must be a directory: ${BRANDING_DIR}" >&2
      exit 1
    fi
  fi
  for asset in "${ASSETS[@]}"; do
    override="${BRANDING_DIR}/${asset}"
    if [[ -e "${override}" || -L "${override}" ]]; then
      if [[ ! -f "${override}" || -L "${override}" ]]; then
        echo "[assets] Error: branding override must be a regular file: ${override}" >&2
        exit 1
      fi
    fi
  done
done

copied=0

for app in "${APPS[@]}"; do
  PUBLIC_DIR="${REPO_ROOT}/apps/${app}/public"
  mkdir -p "${PUBLIC_DIR}"

  for asset in "${ASSETS[@]}"; do
    src="${ASSETS_DIR}/${asset}"
    if [[ -f "${REPO_ROOT}/apps/${app}/branding/${asset}" ]]; then
      src="${REPO_ROOT}/apps/${app}/branding/${asset}"
    fi
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
