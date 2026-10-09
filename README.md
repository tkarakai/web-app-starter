# web-app-starter

A production-shaped starter for web products: Next.js, Convex and Better Auth in a Bun and
Turborepo monorepo, with an admin dashboard, internationalization, CI/CD and operations tooling
already built.

This repository has two parts:

- **`platform/`** is the starter platform: shared packages, the admin dashboard, tooling, docs
  and agent skills. It is replaced as a whole when you take a newer release, so you don't edit it.
- **Everything else** is your app: the reference apps in `apps/`, the Convex backend in
  `packages/backend/`, and the configuration in `app.config.ts`.

## Start here

Start from a [published release](https://github.com/tkarakai/web-app-starter/releases), not an arbitrary main commit. For an existing repository, follow [the adoption guide](platform/README.md#existing-repositories) before moving files or merging source.

1. Install the Node and Bun versions named in `package.json` (`engines`, `packageManager`), then
   run `bun install`.
2. Follow [Adopting the starter](platform/README.md#adopting-the-starter) to prepare a task
   branch, then run `bun run adopt` once. It sets your product name, ports and auth cookie prefix in
   `app.config.ts`, replaces this README and the licence with your own, optionally removes the
   sample domain and the demo app, and records the platform version you started from.
3. Run `bun run dev` to start Convex and the apps locally.

Then read:

- [`platform/README.md`](platform/README.md): what the platform gives you, commands, local and
  cloud setup.
- [`platform/AGENTS.md`](platform/AGENTS.md): the platform's rules, for you and your coding agents.
- [`platform/UPGRADING.md`](platform/UPGRADING.md): how to take a newer platform release.

## Tests

Run `bun run setup:e2e` once after installing dependencies, then `CI=true bun run test:e2e`
for browser tests or `CI=true bun run ci` for full local validation. CI mode uses one web
worker: parallel local workers can exceed the proxy's per-IP edge rate limit and trigger
HTTP 429 and cascading timeouts. See [the testing guide](platform/docs/testing.md#running-playwright-e2e-reliably).

## Licence

Until adoption this repository is under the evaluation licence in [`LICENSE`](LICENSE). Production
use needs a commercial licence: see [`platform/COMMERCIAL-LICENSE.md`](platform/COMMERCIAL-LICENSE.md).
