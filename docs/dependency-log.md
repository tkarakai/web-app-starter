# Dependency log

Every dependency decision, newest first: what changed, what did not, and why. Written by the
`deps-update` and `deps-major` skills (`.agents/skills/`); policy is in
[`dependency-updates.md`](dependency-updates.md) and
[`dependency-migrations.md`](dependency-migrations.md).

- **Run lines**: one line per merged Renovate PR, grouped under the run's date.
- **Decision entries**: one per assessed major, migration, security fix, hold or rollback,
  using the template at the bottom. Rejections and rollbacks carry their evidence.

## Awaiting external preconditions

Upgrades the repo is ready for, blocked on a change outside it. Re-checked on every
`deps-update` run.

| Upgrade | Precondition | Who | Since |
|---|---|---|---|
| Node 24 → 26 (runtime baseline) | Node 26 becomes Active LTS (October 2026), and every Vercel project (web, admin, landing, landing-static) is switched to Node 26 | User, in Vercel | 2026-09-24 |

## Log

### 2026-09-24

- **Adopted: `typescript` 5.9.3 → 6.0.3**, #143, ticket #135. Tier A.
  Usage: codebase-wide typechecks/builds plus two compiler-API starter-upgrade scripts. Breaking
  changes that hit us: deprecated `baseUrl`, ambient `types` now defaulting to `[]`, and the
  existing TypeScript ESLint stack's `<6.0.0` peer range. Tests added first: none; this is build-only
  tooling, and the existing compilation, build, test, bundle, starter-rehearsal and E2E coverage is
  the behavior contract. Validation: `bun run typecheck`, `bun run lint`, Convex `dev --once`
  typecheck, and `bun run ci`; every migration-sensitive check and bundle budget passed. Local
  web/admin/landing E2E retained the same placeholder/fixture failures seen on 5.9.3; Storybook E2E
  passed. Reason: removed `baseUrl`, made the web path target explicitly relative, declared Node
  ambient types for Convex, updated TypeScript ESLint to eligible 8.70.0, and taught the anonymous
  Convex launcher to preserve the current tsconfig rather than discarding in-progress changes.
- `size-limit` + `@size-limit/file` 11 → 13, #131. Tier A. v13 drops Node 20; the runtime
  baseline is Node 24.
- `@vitejs/plugin-react` 4 → 5, #130. Tier A. 5.2.0 accepts the installed Vite 7. 6.x stays held
  (needs Vite 8).
- **Trial rejected: `@tanstack/react-table` 8 → 9.2.4.** Admin typecheck failed: `useReactTable`,
  `getCoreRowModel` and `getSortedRowModel` were removed, and `Table`/`ColumnDef` need extra
  generics. Reverted. Revisit as a migration (#136) of the users, waitlist, admins and audit-trail
  tables, with sorting, paging and selection tests written first.
- **Trial rejected: `@zxcvbn-ts/*` 3 → 4.** Core 4.2.0 no longer exports `zxcvbn` or
  `zxcvbnOptions` (factory API instead), so types and execution failed. Reverted. The new common
  word list also changes password scores: a security-relevant behaviour change, so the user
  decides (#137).

## Decision entry template

```markdown
- **<Adopted | Rejected | Held | Rolled back>: `<package>` <from> → <to>**, #<PR>. Tier <A/B/C>.
  Usage: <where and how we use it>. Breaking changes that hit us: <list, or none>.
  Tests added first: <list, or none needed>. Validation: <CI run, bundle sizes>.
  Reason: <one or two sentences>. Revisit: <condition, for holds and rejections>.
```
