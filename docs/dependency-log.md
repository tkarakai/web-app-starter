# Dependency log

Every dependency decision, newest first: what changed, what did not, and why. Written by the
`update-deps` and `assess-upgrade` skills (`.agents/skills/`); policy is in
[`dependency-updates.md`](dependency-updates.md) and
[`dependency-migrations.md`](dependency-migrations.md).

- **Run lines**: one line per merged Renovate PR, grouped under the run's date.
- **Decision entries**: one per assessed major, migration, security fix, hold or rollback,
  using the template at the bottom. Rejections and rollbacks carry their evidence.

## Awaiting external preconditions

Upgrades the repo is ready for, blocked on a change outside it. Re-checked on every
`update-deps` run.

| Upgrade | Precondition | Who | Since |
|---|---|---|---|
| Node 24 → 26 (runtime baseline) | Node 26 becomes Active LTS (October 2026), and every Vercel project (web, admin, landing, landing-static) is switched to Node 26 | User, in Vercel | 2026-09-24 |

## Log

### 2026-09-24

- `size-limit` + `@size-limit/file` 11 → 13, #131. Tier A. v13 drops Node 20; the runtime
  baseline is Node 24.
- `@vitejs/plugin-react` 4 → 5, #130. Tier A. 5.2.0 accepts the installed Vite 7. 6.x stays held
  (needs Vite 8).
- **Trial rejected: `@tanstack/react-table` 8 → 9.2.4.** Admin typecheck failed: `useReactTable`,
  `getCoreRowModel` and `getSortedRowModel` were removed, and `Table`/`ColumnDef` need extra
  generics. Reverted. Revisit as a migration of the users, waitlist, admins and audit-trail
  tables, with sorting, paging and selection tests written first.
- **Trial rejected: `@zxcvbn-ts/*` 3 → 4.** Core 4.2.0 no longer exports `zxcvbn` or
  `zxcvbnOptions` (factory API instead), so types and execution failed. Reverted. The new common
  word list also changes password scores: a security-relevant behaviour change, so the user
  decides.

## Decision entry template

```markdown
- **<Adopted | Rejected | Held | Rolled back>: `<package>` <from> → <to>**, #<PR>. Tier <A/B/C>.
  Usage: <where and how we use it>. Breaking changes that hit us: <list, or none>.
  Tests added first: <list, or none needed>. Validation: <CI run, bundle sizes>.
  Reason: <one or two sentences>. Revisit: <condition, for holds and rejections>.
```
