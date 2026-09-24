#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

case "$RUNNER_ARCH" in
    X64) node_arch=x64 ;;
    ARM64) node_arch=arm64 ;;
    *) echo "found=false" >> "$GITHUB_OUTPUT"; exit 0 ;;
esac

if [[ "$NODE_VERSION" =~ ^[0-9]+$ ]]; then
    for node in "${RUNNER_TOOL_CACHE}/node/${NODE_VERSION}."*/"$node_arch/bin/node"; do
        if [ -x "$node" ] && version=$("$node" --version) && [[ "$version" == "v${NODE_VERSION}."* ]]; then
            echo "${node%/node}" >> "$GITHUB_PATH"
            echo "found=true" >> "$GITHUB_OUTPUT"
            exit 0
        fi
    done
fi

echo "found=false" >> "$GITHUB_OUTPUT"
