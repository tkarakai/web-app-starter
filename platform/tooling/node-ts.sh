#!/bin/bash
# Run a project TypeScript script with Node: ./platform/tooling/node-ts.sh FILE.ts [ARGS...]
# Node 22.18+ and 23.6+ run .ts files directly; 22.6-22.17 and 23.0-23.5 need
# --experimental-strip-types. The flags go in NODE_OPTIONS so that Node child
# processes started by the script get them too. Older Node versions are refused.
set -euo pipefail
command -v node >/dev/null || { echo "Node.js 22.6 or newer is required to run project scripts." >&2; exit 1; }
flags=$(node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 6)) process.exit(1);
const strip = (major === 22 && minor < 18) || (major === 23 && minor < 6);
console.log((strip ? "--experimental-strip-types " : "") + "--disable-warning=ExperimentalWarning");
') || { echo "Node.js 22.6 or newer is required to run project scripts (found $(node --version))." >&2; exit 1; }
export NODE_OPTIONS="$flags${NODE_OPTIONS:+ $NODE_OPTIONS}"
exec node "$@"
