# Northstar Dispatch — downstream upgrade canary

The existing demo sidebar shell now carries app-owned branding and freight
behavior. Its editable UI consumes a **locked local snapshot**, not current
workspace foundation source. It still has no backend, auth or deployment needs.

```bash
bun run --cwd apps/demo dev          # existing demo development entry point
bun run --cwd apps/demo test:unit    # sidebar regression + actual dispatch dashboard
bun run test:foundation              # fail-closed upgrade-contract tests
bun run test:foundation-canary       # full historical baseline -> target rehearsal
```

The demo is checked in at fixture `sidebar-width-snapshot:1.0.1`. The rehearsal
copies this real app, installs immutable `1.0.0`, proves the known regression is
red, discovers/applies `1.0.1`, and runs behavior, type and production-build checks.
App-owned and vendored bytes must be unchanged. It needs installed Bun dependencies,
not live services, publishing credentials or Google Fonts.

- `foundation.json`: ownership (consumed, vendored/editable, application, generated).
- `foundation.lock.json`: installed identity; `baseline` is not a verification claim.
- `src/business/`: downstream rules and brand; upstream releases cannot overwrite it.
- `src/components/ui/`: intentionally editable UI, protected during upgrades.
- `src/foundation/`: consumed release bytes; local edits block upgrades.
- `public/northstar.svg`: app-owned icon, excluded from the shared asset copier.

See [the contract and enrollment guide](../../docs/foundation-canary.md) for
planning, actions, evidence, failure recovery, limitations and remaining phases.
A foundation release (affected layers, security urgency, migrations, codemods,
verification commands, canary evidence) feeds an explicit **business-app upgrade
PR** that preserves app-owned code; only after it lands may the **operations
plane** deploy that commit through normal staging and production. Operations never
rewrites app source or runs hidden migrations. This rail neither deploys nor
changes any approval layer.
