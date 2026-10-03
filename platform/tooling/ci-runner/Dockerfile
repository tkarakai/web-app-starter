# syntax=docker/dockerfile:1
# Self-hosted runner image for the starter's CI: GitHub's runner, as packaged by
# myoung34/github-runner, plus what almost never changes between jobs. Build it
# locally with compose.yaml; nothing is published. Setup and upkeep:
# platform/docs/private-repo-ci.md.
#
# Only the browser system libraries live in the image. What the repository pins
# (Node, Bun, packages, Playwright's Chromium, the Convex local backend) lives in
# the volumes compose.yaml mounts, so a dependency upgrade never needs a rebuild.

# The Playwright version the repository pins (compose.yaml passes it from .env).
# Its own install-deps picks the package list, so the libraries and fonts match
# what that version's Chromium needs.
ARG PLAYWRIGHT_VERSION

FROM node:24-bookworm-slim AS playwright
ARG PLAYWRIGHT_VERSION
RUN test -n "$PLAYWRIGHT_VERSION" || { echo "PLAYWRIGHT_VERSION is required (see compose.yaml)" >&2; exit 1; } \
    && npm install --prefix /opt/playwright --no-save --no-audit --no-fund "playwright-core@${PLAYWRIGHT_VERSION}"

FROM myoung34/github-runner:ubuntu-noble
ARG PLAYWRIGHT_VERSION

# Playwright and a current Node are mounted for this step only, not kept in the image.
RUN --mount=type=bind,from=playwright,source=/opt/playwright,target=/opt/playwright \
    --mount=type=bind,from=playwright,source=/usr/local/bin/node,target=/opt/node \
    /opt/node /opt/playwright/node_modules/playwright-core/cli.js install-deps chromium \
    && apt-get install -y --no-install-recommends jq unzip \
    && rm -rf /var/lib/apt/lists/* \
    && printf 'playwright=%s\n' "$PLAYWRIGHT_VERSION" > /etc/starter-ci-runner

# .github/actions/setup-playwright reads /etc/starter-ci-runner: when it names the
# Playwright version under test, the job skips installing browser system libraries.
