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

1. Install the Node and Bun versions named in `package.json` (`engines`, `packageManager`), then
   run `bun install`.
2. Run `bun run adopt` once. It sets your product name, ports and auth cookie prefix in
   `app.config.ts`, replaces this README and the licence with your own, optionally removes the
   sample domain and the landing sites, and records the platform version you started from.
3. Run `bun run dev` to start Convex and the apps locally.

Then read:

- [`platform/README.md`](platform/README.md): what the platform gives you, commands, local and
  cloud setup.
- [`platform/AGENTS.md`](platform/AGENTS.md): the platform's rules, for you and your coding agents.
- [`platform/UPGRADING.md`](platform/UPGRADING.md): how to take a newer platform release.

## Licence

Until adoption this repository is under the evaluation licence in [`LICENSE`](LICENSE). Production
use needs a commercial licence: see [`platform/COMMERCIAL-LICENSE.md`](platform/COMMERCIAL-LICENSE.md).
