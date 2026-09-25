#!/usr/bin/env bash
# Build the Floci image the local stack runs: the pinned upstream release plus
# the patches in floci-patches/, until they are released upstream.
#
#   infra/aws/local/build-floci.sh [--force]
#
# Patches (each is also reported upstream; drop it once a release contains it):
#   0001  ELBv2 data plane: keep repeated headers (every Set-Cookie reached the
#         browser as only the last one, so Better Auth sessions were lost) and
#         add X-Forwarded-For/-Proto/-Port like an ALB.
set -euo pipefail
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FLOCI_VERSION="2.1.0"
IMAGE="${FLOCI_IMAGE:-floci/floci:${FLOCI_VERSION}-patched}"

if [[ "${1:-}" != "--force" ]] && docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "$IMAGE already built (--force to rebuild)"
  exit 0
fi

SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
git clone --quiet --depth 1 --branch "$FLOCI_VERSION" https://github.com/floci-io/floci.git "$SRC" 2>/dev/null
for patch in "$LOCAL_DIR"/floci-patches/*.patch; do
  git -C "$SRC" apply "$patch"
  echo "Applied $(basename "$patch")"
done
# The release's test sources do not compile standalone; the image needs none of them.
sed -i.bak 's/-DskipTests/-Dmaven.test.skip=true/' "$SRC/docker/Dockerfile"

echo "Building $IMAGE (a few minutes the first time)"
docker build --quiet -f "$SRC/docker/Dockerfile" --build-arg "VERSION=${FLOCI_VERSION}-patched" -t "$IMAGE" "$SRC" >/dev/null
echo "Built $IMAGE"
