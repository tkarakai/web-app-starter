# Immutable local sidebar-policy releases

These are offline fixtures for `sidebar-width-snapshot`, not published starter
`v*` tags. Trust them through reviewed repository history; hashes are integrity
checks, not signatures. Do not mutate old payloads to make a regression pass.

- `1.0.0`: equivalent finite-width/clamping/snapping policy extracted from the demo
  and design-system sidebars at starter commit `d515070`. Non-finite input is not
  normalized; `NaN` poisons CSS/state. No global git tag is created.
- `1.0.1`: the current `packages/design-system/src/lib/sidebar-width.ts`, adding
  finite-input handling with the existing 16rem default. Its mandatory local action
  checks component state, CSS, cookies and normal width behavior. No schema or
  deployed migration is involved.

`catalogue.json` declares exact supported transitions, SHA-256 payload hashes and
required action IDs. The tooling has a fixed write/command allowlist, independent
of that declaration. New actions or writable modules require an explicit reviewed
contract extension and negative tests, not just a catalogue edit.

[Full contract and remaining work](../../docs/foundation-canary.md).
