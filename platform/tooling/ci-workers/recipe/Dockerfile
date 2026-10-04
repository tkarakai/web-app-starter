# All recipes are installed with the host manager. A job never supplies a Dockerfile.
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS tools
ARG BUN_VERSION
ARG PLAYWRIGHT_VERSION
ARG BACKEND_VERSION
ARG TOOL_KEY
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates curl git jq unzip libicu72 libssl3 libkrb5-3 zlib1g iptables squid tini procps lsof \
 && rm -rf /var/lib/apt/lists/*
COPY downloads/ /tmp/downloads/
RUN mkdir -p /opt/runner /opt/bun /opt/playwright /opt/backend \
 && unzip -q /tmp/downloads/bun.zip -d /opt/bun \
 && ln -s /opt/bun/bun-linux-*/bun /usr/local/bin/bun \
 && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
 && tar -xzf /tmp/downloads/runner.tar.gz -C /opt/runner \
 && unzip -q /tmp/downloads/backend.zip -d /opt/backend \
 && chmod +x /opt/backend/convex-local-backend \
 && rm -rf /tmp/downloads
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN cd /opt/playwright && bun add --exact --ignore-scripts playwright@${PLAYWRIGHT_VERSION} \
 && bun node_modules/playwright/cli.js install --with-deps chromium \
 && rm -rf /root/.bun /var/lib/apt/lists/*
RUN useradd -m -u 1001 -s /bin/bash worker \
 && mkdir -p /home/worker/.cache/convex/binaries/${BACKEND_VERSION} /home/worker/.bun/install/cache /work \
 && cp /opt/backend/convex-local-backend /home/worker/.cache/convex/binaries/${BACKEND_VERSION}/ \
 && chown -R 1001:1001 /home/worker /opt/runner /work \
 && printf '{"bun":"%s","playwright":"%s","backend":"%s","tools":"%s"}\n' "$BUN_VERSION" "$PLAYWRIGHT_VERSION" "$BACKEND_VERSION" "$TOOL_KEY" > /etc/starter-worker.json
COPY entrypoint.sh smoke.mjs firewall.sh squid.conf /opt/starter/
RUN chmod 755 /opt/starter/*.sh && chown proxy:proxy /var/log/squid /var/spool/squid
ENV HOME=/home/worker CI=true STARTER_WORKER=1 CONVEX_LOCAL_BACKEND_VERSION=${BACKEND_VERSION} PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PATH=/usr/local/bin:/usr/bin:/bin
USER 1001:1001
WORKDIR /work
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/starter/entrypoint.sh"]

FROM tools AS seed
COPY --chown=1001:1001 inputs/ /work/
# No lifecycle script can promote job-generated output into the prepared seed.
RUN bun install --frozen-lockfile --ignore-scripts

FROM tools AS worker
COPY --from=seed --chown=1001:1001 /home/worker/.bun/install/cache/ /home/worker/.bun/install/cache/
