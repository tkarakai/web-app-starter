# <Product name>

<!--
This README is yours: platform upgrades never change it. `bun run adopt` puts it at the
repository root in place of the starter's README. Replace every <placeholder>.
-->

<One paragraph: what the product does and who it is for.>

## Apps

| App | Path | Purpose |
|---|---|---|
| <app> | `apps/<app>` | <what it is for> |

The backend is the Convex project in `packages/backend/convex/`. Names, ports, the auth cookie
prefix, brand and optional features are set in `app.config.ts`.

## Development

```bash
bun install
bun run dev        # Convex and the apps, on the ports in app.config.ts
bun run ci:quick   # lint, types, tests and build before you push
```

## Built on web-app-starter

This product is built on the web-app-starter platform, in `platform/`. Its version is in
`platform/VERSION`; its documentation starts at [`platform/README.md`](platform/README.md) and
[`platform/AGENTS.md`](platform/AGENTS.md). Don't edit `platform/` for app features: take newer
platform releases with [`platform/UPGRADING.md`](platform/UPGRADING.md).

## Licence

See [`LICENSE`](LICENSE).
