# Spike 4.1: `auditTrail` as a Convex platform component

Branch `spike/convex-platform-audittrail` (throwaway, not merged), cut from `origin/main`.
Plan: `docs/upgradeability/repo-separation.md` §16 and task 4.1 of the implementation plan.

## Result

| Exit criterion (§16) | Result | Evidence |
| --- | --- | --- |
| Declared env works | **PASS** | On a local backend, the component declares `SITE_URL` (required) and `AUDIT_TRAIL_RETENTION_DAYS` (optional). The app declares both in `defineApp({ env })` and passes them by reference: `app.use(platform, { env: { SITE_URL: app.env.SITE_URL } })`. Push **fails** while `SITE_URL` is unset (`MissingEnvironmentVariables: Required environment variables are not set: SITE_URL`). `convex env remove SITE_URL` is **refused** (`Cannot delete required environment variables`). `convex env set` changes are visible to the component at once, with no redeploy. The component **cannot** see undeclared env: `BETTER_AUTH_SECRET` is invisible to it and still visible to the app. See `platform/auditTrail:envProbe`. |
| The paginator replaces `.paginate()` | **PASS** | The component's `list` uses `paginator(ctx.db, schema)` from `convex-helpers` 0.1.111. The old post-index `.filter()` calls became one `filterWith()`. Component tests cover a 3-page walk (no gaps or duplicates, in descending order), conjunctive filters, the compound index, and full pages under a post-filter. The same checks passed on the local backend with 2,001 rows. The admin table now uses `usePaginatedQuery` from `convex-helpers/react`. |
| The admin app reads through the wrappers | **PASS** (typecheck, build, code inspection and a live call; no E2E) | All 12 app call sites now use `api.platform.auditTrail.*`. `apps/admin`: `tsc` is clean, `eslint` is clean and `next build` succeeds. `apps/web`: `tsc` is clean. Live on the local backend, called with `--identity` using real Better Auth user and session ids: the admin gets rows, a non-admin gets an empty page, and a user's `postEvent` lands in the component with `web:` source, actor and user id. Dev-seed sign-ups (the real Better Auth hooks, then `runAuditEvent`) also land in the component. |
| `convex-test` passes | **PASS** | `bun run test:convex`: `@repo/convex-platform` has 19 tests passing, and `@repo/backend` has all 17 files passing (184 tests). Registration is `t.registerComponent("platform", schema, modules)`, wrapped as `registerPlatform(t)` in `@repo/convex-platform/test`. |
| The data migration works | **PASS on test data** (staging not used; no deployed environment touched) | Under `convex-test`: 257 rows copied and verified (counts plus field-by-field equality), a re-run is idempotent (0 inserted, 120 skipped) and a tampered copy is detected. On a private **local** backend (`anonymous-backend`, this worktree only): 2,000 seeded legacy rows plus 1 new row went through `run` in 21 batches (2,000 inserted, `ok: true`); the re-run inserted 0, skipped 2,000 and still reported `ok: true`. §16's actual criterion, a run on a *staging copy*, is still open. |

**Recommendation: go with the component, scoped.** Move the **self-contained** platform tables into it: `auditTrail`, `appSettings`, `announcements`, the waitlist, invitations and `adminEmails`. Keep everything that touches Better Auth or the rate limiter as plain platform functions in `convex/platform/` (the wrappers): `userProfiles` lookups, sessions and rate limits. Any doubt is about particular tables, not the mechanism: every mechanism §16 depends on works in `convex` 1.45. The reasons and caveats follow.

## What was built

```
packages/convex-platform/            @repo/convex-platform (future platform/packages/convex-platform)
  src/component/convex.config.ts     defineComponent("platform", { env: {...} })
  src/component/schema.ts            auditTrail (+ legacyId, legacyCreationTime, by_legacyId)
  src/component/auditTrail.ts        insertEvent, list (paginator), envProbe, importLegacyEvents, getByLegacyIds, countPage
  src/component/auditTrailConstants.ts   moved from packages/backend/convex/
  src/component/_generated/          produced by `convex dev` (committed)
  src/component/auditTrail.test.ts   component-level convex-test
  src/test.ts                        registerPlatform(t) for app tests
packages/backend/convex/
  convex.config.ts                   defineApp({ env }) + app.use(platform, { env: by-ref })
  platform/auditTrail.ts             wrappers: insertEvent (internal), postEvent, list, envProbe
  platform/auditTrailHelpers.ts      scheduleAuditEvent / runAuditEvent (moved; now target the wrapper)
  platform/migrateAuditTrail.ts      copyBatch, verifyPage, status, run (+ spike-only seedLegacyForSpike)
  platform-auditTrail.test.ts        wrapper + migration tests (at convex/ root, see surprises)
  schema.ts                          legacy auditTrail kept (expand/contract)
```

**Why a separate workspace package and not `convex/components/platform/`:** §16 puts the component in `platform/packages/convex-platform`, so this spike tested the harder layout. It works. The Convex CLI follows the `@repo/convex-platform/convex.config` import through the Bun workspace symlink, treats it as a *local* component and generates `_generated/` inside that package. The docs' `convex/components/<name>` layout would also work, but it would mix platform-zone files into the app's `convex/` tree.

## Surprises and findings

1. **Return types become `any` across the boundary unless the component declares `returns`.** `ComponentApi` types a function's result from its `returns` validator only, so without one, `list` came back to the app as `any`. The full migration must add a `returns` validator to every component function. That's real work, and a `paginationResultValidator(...)` for each paginated one.
2. **The generated import needs a `.js` subpath export.** The app's `_generated/api.d.ts` contains `import("@repo/convex-platform/_generated/component.js").ComponentApi<"platform">`. The package's `exports` map needs `"./_generated/component.js"`. Without it the import fails to resolve and **every component call is silently `any`**: `tsc` still passes. A contract check should assert that `components.platform` is not `any`.
3. **Required declared env is a sharp edge for fresh deployments.** A required variable blocks the *first* push until it is set. `dev-start.sh` currently starts `convex dev` and sets `SITE_URL` afterwards, and CI, preview and E2E deployments do the same kind of thing. Either set the variables before the first push, or declare most platform variables `v.optional` and validate them at use. The upside: this is exactly the "a release declares its required env and deploy fails if missing" check §16 asks for, and it comes free.
4. **`convex-test` doesn't isolate component env.** The generated `env` is just `process.env`, so under vitest the component sees every variable. Env isolation can only be proved on a real backend, as this spike did.
5. **The `convex-test` module glob must start at the `convex/` root.** A test in `convex/platform/` using `import.meta.glob("../**/*.*s")` fails with `Could not find module for: "platform/auditTrail"`. Wrapper tests live at the root (`platform-auditTrail.test.ts`), or a root-level modules export is needed.
6. **Every test that reaches the component must register it.** Otherwise scheduled audit writes fail quietly, because `scheduleAuditEvent` swallows errors. Only `announcements.test.ts` needed a change here, but once more tables move, most test files will. Use one shared `createTestEnv()`.
7. **Paginator semantics differ from `.paginate()`.**
   - Pages don't grow reactively, so clients must use `convex-helpers/react` `usePaginatedQuery`. The admin app gained a `convex-helpers` dependency.
   - Cursors aren't encrypted and expose index key values. Example: `["auth.sign_in",1700001932000,<creationTime>,"<id>"]`. That's acceptable for an admin-only view, but note it for any user-facing list.
   - A full page reports `isDone: false` even when nothing more matches.
   - `filterWith` rows still count as reads.
8. **Scheduling:** `scheduleAuditEvent` still schedules an **app** `internalMutation` (`internal.platform.auditTrail.insertEvent`), which calls the component. That keeps fire-and-forget semantics and a stable reference. The cost is two function executions per event.
9. **Codegen churn:** the new CLI codegen adds a typed `env` export to *every* `_generated/server.*`, including `betterAuth`'s. It also collapses the app's inline `components.betterAuth` types into `import(...).ComponentApi`: about 5.9k deleted lines in `api.d.ts`. That's a one-time diff but a large one in a release.
10. **IDs:** component rows get new `_id` and `_creationTime` values. The migration keeps the old ones as `legacyId` and `legacyCreationTime`. Nothing references audit rows by id, so this was harmless here. It will not be harmless for tables that are referenced.
11. **Local backend:** in `CONVEX_AGENT_MODE=anonymous`, the CLI always selects the single shared `anonymous-agent` deployment, which other checkouts also use. Leave the mode unset (non-TTY) to get a directory-named project-local one: `anonymous-backend`, stored in `packages/backend/.convex/`. Parallel agents doing backend rehearsals need this.

## What the apps see (API and generated-code changes)

- `api.auditTrail.postEvent` / `.list` → `api.platform.auditTrail.postEvent` / `.list` (12 files in `apps/web` and `apps/admin`).
- `internal.auditTrail.insertEvent` → `internal.platform.auditTrail.insertEvent`.
- `Doc<"auditTrail">` no longer exists in the app data model. `@repo/backend` now exports an `AuditTrailEvent` type, derived with `FunctionReturnType` from the wrapper. Every moved table loses its `Doc<...>` type in the same way.
- `AUDIT_ACTIONS` and the other constants come from `@repo/convex-platform/constants`. `@repo/backend` still re-exports them, so app imports are unchanged.
- In the dashboard and CLI, the data lives under the component: `convex data --component platform auditTrail`, `convex run --component platform ...`.

## Effect on the full migration

**Easier than feared:**
- Local component packaging.
- Declared env, including by-reference values and enforcement of required variables.
- `convex-test` registration.
- Transactional calls from app mutations into the component: `copyBatch` reads the app table and writes the component table in one mutation.
- The copy, verify and idempotency pattern generalises into a helper.

**Riskier:**
- **`announcements`:** stores `Id<"_scheduled_functions">` values from the *app* scheduler. The component has its own scheduler, so pending publish and unpublish jobs must be cancelled and rescheduled in the migration, and the whole scheduling logic must move into the component together.
- **`userProfiles` and sessions:** tied to Better Auth, which the app installs as a separate component. The platform component can't read `components.betterAuth` unless it nests Better Auth itself, and §16 keeps the Better Auth instance in the wrappers. Keep this logic in `convex/platform/` and pass plain data in.
- **Rate limits:** `rateLimitTables` and the `convex-helpers` limiter live in the app schema and are used by the wrappers. Leave them in the wrappers (as here) or give the component its own limiter. Their state doesn't need migrating.
- **Typing:** `returns` validators for every function, plus a non-`any` contract check.
- **16 variables:** each has to be declared twice (component and `defineApp`) and wired in `convex.config.ts`, which is a seam, so that file grows.

**Effort observed:** the `auditTrail` move, including learning the tooling, took roughly one day of work. That covers component, wrappers, paginator, env, tests, migration and local rehearsal. About a third of it was tooling friction: anonymous-deployment selection, the `.js` export, glob roots and `returns` typing, all known now. Tables with scheduling or Better Auth coupling will cost more per table than this one.

## Not done

- Staging-copy rehearsal (§16's literal criterion). Next step: restore a staging snapshot into a scratch deployment, deploy this branch and run `platform/migrateAuditTrail:run`.
- The contract step: dropping the legacy `auditTrail` table and its rows.
- Admin E2E, and a `next build` of `web` (`web` typecheck is clean).
