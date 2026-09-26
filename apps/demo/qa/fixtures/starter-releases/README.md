# Immutable starter package test releases

These fixtures belong to the demo's upgrade tests. They are built local package
artifacts, not published starter git tags or a production release catalogue.

- `1.0.0`: historical sidebar policy; non-finite width inputs can reach state/CSS.
- `1.0.1`: returns the existing 16rem default for NaN and infinities.

Each version contains `starter-packages/sidebar-policy/package.json` plus compiled
JavaScript and declarations. `catalogue.json` records file hashes, supported
starting versions, affected layers, urgency and required actions. There are no
database migrations or codemods for this transition.

Do not regenerate old fixtures to make a test pass. Add a version for a new
package release, its required regression action and explicit supported starting
versions. `scripts/starter-upgrade/ownership.json` pins release metadata;
`bun run check:starter-ownership` checks the current author package build against
the latest artifact and validates the demo's real dependency separately.

Generated rehearsal logs and copied apps belong under
`.ci-local-artifacts/starter-upgrade/`, not in this directory. See
[the demo README](../../../README.md#test-a-starter-upgrade).
