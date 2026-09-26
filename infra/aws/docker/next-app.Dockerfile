# Container image for a Next.js app (web or admin) in standalone output mode.
#
#   docker build -f infra/aws/docker/next-app.Dockerfile --build-arg APP=web .
#
# The image carries no environment identity: CONVEX_URL, CONVEX_SITE_URL,
# LANDING_URL and APP_ENVIRONMENT are read at request time (see
# platform/docs/deployment-architecture.md), so one image serves every environment.
#
# NODE_VERSION and BUN_VERSION must match .node-version and packageManager;
# platform/tooling/check-runtime-baseline.ts enforces it.
ARG NODE_VERSION=24
ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION} AS bun

FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /repo
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

ARG APP
ARG GIT_SHA=unknown
ARG GIT_BRANCH=
ARG DEPLOY_TIMESTAMP=
RUN test -n "$APP" || (echo "APP build arg is required (web or admin)" >&2 && exit 1)

ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_GIT_SHA=${GIT_SHA} \
    NEXT_PUBLIC_GIT_BRANCH=${GIT_BRANCH} \
    NEXT_PUBLIC_DEPLOY_TIMESTAMP=${DEPLOY_TIMESTAMP} \
    NEXT_PUBLIC_BUILD_ID=${GIT_SHA} \
    NEXT_PUBLIC_APP_NAME=${APP}

# Next.js evaluates the auth module while collecting page data, which requires
# the Convex URLs to be set. These placeholders satisfy that and nothing else:
# the leak check below fails the build if any of them reached the output, which
# is what proves the image can be pointed at any environment at runtime.
ENV CONVEX_URL=https://build-placeholder-cloud.convex.cloud \
    CONVEX_SITE_URL=https://build-placeholder-site.convex.site \
    LANDING_URL=https://build-placeholder-landing.invalid

COPY . .
RUN bun install --frozen-lockfile
RUN ./platform/tooling/copy-shared-assets.sh
# The app's directory: apps/<app> for reference apps, platform/apps/<app> for
# platform apps (admin), as app.config.ts's reader reports it.
RUN ./platform/tooling/node-ts.sh platform/tooling/app-config.ts dir "${APP}" > /tmp/app-dir
RUN bun run --cwd "$(cat /tmp/app-dir)" build
RUN ENV_FILE=/dev/null/none ./platform/tooling/check-env-leak.sh "${APP}"

# Assemble the runtime tree: the traced server, plus the static assets and public
# files that standalone output deliberately leaves for a CDN or the host to serve.
RUN APP_DIR="$(cat /tmp/app-dir)" \
 && mkdir -p /out \
 && cp -R "${APP_DIR}/.next/standalone/." /out/ \
 && mkdir -p "/out/${APP_DIR}/.next" \
 && cp -R "${APP_DIR}/.next/static" "/out/${APP_DIR}/.next/static" \
 && if [ -d "${APP_DIR}/public" ]; then cp -R "${APP_DIR}/public" "/out/${APP_DIR}/public"; fi \
 && printf '%s\n' "${APP_DIR}" > /out/.app-dir

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=${GIT_SHA}
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP=${APP}

COPY --from=builder --chown=node:node /out /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "exec node \"$(cat /app/.app-dir)/server.js\""]
