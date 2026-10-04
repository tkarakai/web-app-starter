FROM validated-tools AS seed
COPY --chown=1001:1001 inputs/ /work/
# No lifecycle script can promote job-generated output into the prepared seed.
RUN bun install --frozen-lockfile --ignore-scripts

FROM validated-tools AS worker
COPY --from=seed --chown=1001:1001 /home/worker/.bun/install/cache/ /home/worker/.bun/install/cache/
