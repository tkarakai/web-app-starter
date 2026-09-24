# Starter sidebar policy

The first independently versioned starter package boundary demonstrated by this
repository. It exports a default width, clamping and snapping functions. It has
no dependency on application code, editable UI or other starter workspaces.

```bash
bun run --cwd packages/starter-sidebar-policy build
bun run check:starter-ownership
```

The demo consumes the built immutable local package in its own
`starter-packages/sidebar-policy/`, not this authoring workspace. Its public
export map permits only `@repo/starter-sidebar-policy`, not internal file imports.
The legacy design-system helper retains the same sizing fix but is outside this
new package-consumption contract; the broader design system is not certified as
an isolated, replaceable package by this example.

For a new release, change TypeScript source here, bump this package's version,
build, and add a new artifact under the demo's release fixtures with its hashes,
starting-version support and required regression action. Preserve historical
fixtures. The ownership check compares a fresh compiler result to the current
release artifact. Update the demo's installed artifact/baseline deliberately and
run its full upgrade rehearsal before releasing. Registry publication is not
configured.

See [starter upgrades](../../docs/starter-upgrades.md) for the ownership rules,
required evidence and unsupported package-to-vendored transitions.
