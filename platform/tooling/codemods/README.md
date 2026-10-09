# Codemods

One script per breaking change, shipped in the release that breaks things.

The rule from [`VERSIONING.md`](../../VERSIONING.md): **if you break an API, ship the
migration as code, not as a paragraph in the changelog.** A downstream app should be
able to merge a major and fix its own code by running a command, not by reading a
description of a rename and applying it by hand across a codebase we cannot see.

## Naming

`v<major>-<short-slug>.ts`, e.g. `v2-authed-ctx-user-id.ts`. The major in the name
says which release's `### Action required` section invokes it. Codemods are kept
after their release — an app upgrading from v1 to v4 runs v2's and v3's on the way.

## Contract

Every codemod must:

- **Run from the repository root with no arguments** and do the right thing for a
  default layout, and accept explicit paths for apps that moved things.
- **Be idempotent.** Running it twice changes nothing the second time. Downstream
  will run it twice.
- **Support `--check`**, which reports what it would change, writes nothing, and
  exits non-zero if there is anything to do. That is what CI calls.
- **Print every file it touches, with a count.** A silent codemod is not auditable.
- **Explain, in its top-of-file comment, why the breaking change happened.** The person
  running it is not the person who decided it, and often is an agent.

## Scope discipline

Rewrite the narrowest pattern that is actually correct. `ctx.ownerId → ctx.userId`
must not touch `doc.ownerId`, `args.ownerId`, or an `ownerId` column in a schema —
business apps have their own tables with the same column name, and a codemod that
corrupts them is worse than no codemod.

Cover the non-obvious call sites too. The v2 rename above needed a second rule for
object literals that *construct* a context (`{ db: ctx.db, ownerId: "..." }`), which
test helpers do. Those type-check against a structural type after the rename and fail
only at runtime — exactly the case a human reading the changelog would miss, and
therefore the case that most justifies shipping a codemod.

## Language

TypeScript, run with `platform/tooling/node-ts.sh` (for example
`./platform/tooling/node-ts.sh platform/tooling/codemods/v2-authed-ctx-user-id.ts`), which needs Node 22.6+.
Use only Node built-in modules unless the transform genuinely needs a TypeScript
AST, so the codemod runs in a downstream repo that has not run `bun install` yet
after the merge. Shell is fine for a thin wrapper; no other language.

## Organization registration

`organization-register-migration.ts` creates the app-owned registration seam without overwriting
existing mappings. It supports `--check` and `--backend PATH`; its empty output deliberately fails
the inventory check until app-owned dispositions and executable backfills are reviewed. It never
changes database records or guesses tenant context. See the
[organization cutover guide](../../docs/organization-data-migration.md) for deployment verification.

## Credential-safe browser evidence

`v2-secret-safe-e2e.ts [--check] [--app PATH] [ROOT]` migrates the app-owned web E2E
commands, literal Playwright reporter/capture settings, and a missing root Playwright declaration
using the app's existing version. It preserves other config values and scripts, refuses dynamic
configurations/custom commands and symlinked targets, and performs no install or browser run.
Run `bun install` afterward. Interactive capture modes are intentionally unsupported by the safe
runner. See [testing](../../docs/testing.md#credential-safe-browser-reports).
