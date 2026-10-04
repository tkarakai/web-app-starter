# Retired Compose worker

The shared-cache Compose runner has been replaced by `../ci-workers/`. Use
`bun run ci:workers:setup` from a reviewed checkout and follow
[the local worker guide](../../docs/local-ci-workers.md). Stop old containers and revoke
their registration credential before migrating; do not reuse their writable caches.
