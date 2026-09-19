# Codemods

One script per breaking change, shipped in the release that breaks things.

The rule from [`VERSIONING.md`](../../VERSIONING.md): **if you break an API, ship the
migration as code, not as a paragraph in the changelog.** A downstream app should be
able to merge a major and fix its own code by running a command, not by reading a
description of a rename and applying it by hand across a codebase we cannot see.

## Naming

`v<major>-<short-slug>.py`, e.g. `v2-authed-ctx-user-id.py`. The major in the name
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
- **Explain, in its module docstring, why the breaking change happened.** The person
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

Python 3, as here, unless the transform genuinely needs a TypeScript AST — `python3`
is already a build dependency (`bun run test:dev-scripts`) and needs no install step
in a downstream repo that has not run `bun install` yet after the merge.
