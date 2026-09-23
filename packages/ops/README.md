# @repo/ops

Run `bun run ops --help` from the repository root. See [the operations CLI guide](../../docs/ops-cli.md) for configuration, commands, the JSON contract, and a staging-to-production walkthrough.

No runtime dependencies. Requires Bun, GitHub CLI for session authentication/repository inference/failed-job logs, and Vercel CLI for session authentication. Start with `bun run ops setup`; environment tokens are also supported for CI.
