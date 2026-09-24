# Delivering starter updates to business apps

## Current support

Most business apps receive starter changes by merging a reviewed git release tag.
[`VERSIONING.md`](../VERSIONING.md), [`CHANGELOG.md`](../CHANGELOG.md) and
[`UPGRADING.md`](../UPGRADING.md) define that process.

One package-based example is implemented: `@repo/starter-sidebar-policy`.
The standalone demo consumes a versioned local package artifact. Its additional
upgrade test starts with a historical package, reproduces a regression, upgrades
and verifies the app without replacing its custom UI or business behavior.
See [the executable contract](starter-upgrades.md).

This is not registry publishing or repository-wide ownership isolation. No
backend, schema, locale or operations migration is implied by the example.

## Separate three responsibilities

1. **Starter maintainers release an update.** They define versions, affected areas,
   urgency, required actions and verification, then retain rehearsal evidence.
2. **Application teams adopt it in an upgrade PR.** They preserve application-owned
   code, carry out required actions and verify their own behavior.
3. **Operations deploys the resulting application commit.** Operations can present
   available releases, applications behind them, urgency and readiness. It must
   not rewrite source or run hidden migrations during deployment.

[UPGRADING.md](../UPGRADING.md#three-separate-responsibilities) explains the owner,
inputs, outputs, boundaries and an end-to-end example for each responsibility.
The operations implementation is separate and unchanged by this work.

## Choose ownership by how code is maintained

| Category | Intended update mechanism | Present status |
|---|---|---|
| Consumed starter package | Change a versioned dependency; use public exports rather than edit its files | Demonstrated and checked for the sidebar policy only, using immutable local artifacts |
| Application-owned | Application team owns its source; starter notes or reviewed transformations can help adopt API changes | Demo business rules, UI, branding, configuration and tests |
| Generated | Recreate with the owning build/code-generation tool | Explicit fixed demo output list; not a way to hide source |
| Intentionally vendored starter code | Copy selected components with recorded origin, then compare and review later updates | Unsupported pending an explicit registry/copy contract; no current demo path claims this category |

A copy with historical starter/shadcn origins is not automatically supported
vendoring. The demo's editable visual components are application-owned. A managed
package cannot be made editable by silently relabeling it; that would discard its
update guarantees. [Transition preconditions](starter-upgrades.md#copying-a-package-into-editable-code)
explain what a future supported copy process must record and test.

## Existing areas that still mix ownership

- `packages/backend/convex/schema.ts` contains both shared tables and the example
  `projects`, `tasks` and `uploads` tables. It is not a replaceable package boundary
  for applications adding their own domain data.
- `packages/i18n/messages/` combines shared and business/example content. Updating
  shared text must preserve application keys and translations.
- `packages/design-system` and `packages/design-patterns` contain components that
  applications may need to customize. They are candidates for an editable-copy
  contract, not proof that such a contract already exists.
- Branding and infrastructure configuration still require application-specific
  merge review outside the demo's isolated policy upgrade.

`scripts/starter-upgrade/ownership.json` identifies these legacy mixed areas. The
checker verifies the new package and demo; it deliberately does not certify the
rest based on directory names alone. Other workspace packages remain outside the
implemented upgrade contract too.

## Follow-up work, not current guarantees

### Separate shared and application configuration

Centralize branding, compose starter and application database tables explicitly,
and separate shared locale keys from business content. Each change needs a
customized consumer and regression tests proving that app data and edits survive.
The current schema/locale file structure cannot substantiate that claim yet.

### Expand consumed package distribution

For each candidate package, define its public exports, dependencies, version
policy, supported starting versions and required upgrade tests before including
it in automation. Decide registry access and publishing independently of local
package rehearsal. Consider reusable CI workflows and Convex Components where
they provide an actual isolation boundary, not just a renamed directory.

### Design editable component copying

Specify the component registry/copy format, license and dependency contents,
origin version/hash, editable destination, comparison commands and security-update
responsibilities. A reviewed transition must remove managed consumption for the
copied component, update ownership and invalidate old package verification evidence.
Do not label candidates as supported vendored code before this works end-to-end.

### Add operations evidence presentation

Once upgrade contracts are stable, operations may read their outputs to show
release availability, urgency, application versions and readiness. It must deploy
the approved application commit through existing staging/production processes,
not combine source changes with deployment. Operator commands and approvals are
outside this implementation.

## How to measure progress

For each additional package or copy contract, require a real customized consumer,
an immutable historical starting version, a reproduced failure, a successful
upgrade, required-action evidence and tests rejecting unintended source writes.
Passing a typecheck or resolving merge conflicts alone is not enough.

The current demonstration meets those checks for one sidebar policy. Run:

```bash
bun run check:starter-ownership
bun run test:starter-upgrade
bun run test:starter-rehearsal
```
