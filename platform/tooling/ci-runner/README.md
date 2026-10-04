# Retired Compose worker

The shared-cache Compose runner has been replaced by `../ci-workers/`. Use
`bun run ci:workers:setup` from a reviewed checkout and follow
[the local worker guide](../../docs/local-ci-workers.md), including its
[migration instructions](../../docs/local-ci-workers.md#migrate-from-the-retired-compose-runner).
