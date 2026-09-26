# Move existing platform data into the v2 component

Fresh apps have no data to copy. Existing deployments must complete this procedure **before**
deploying v2's backend or frontends. Do it separately for every deployment, including staging
and production. The deployment action checks for a completed receipt or empty legacy tables
before deploying; this migration never runs automatically in CI, during startup, or through
`convex run migrations`.

The copied tables are `announcements`, `appSettings`, `adminEmails`, `waitlistEntries`,
`invitationTokens`, `adminInvitations` and `auditTrail`. Auth profiles, Better Auth, sessions,
rate limits and your app tables stay in place.

## Prepare an additive bridge

1. Record the exact deployed commit and deployment URL. Export a backup with the Convex CLI;
   keep it somewhere access controlled. Rehearse on a disposable copy before touching live data.
2. Make a disposable checkout of the **currently deployed source**. Separately obtain the v2
   source and install its dependencies. From the legacy checkout, run the v2 tool by absolute path:

   ```sh
   node /path/to/v2/platform/tooling/codemods/v2-component-data-bridge.ts --check
   node /path/to/v2/platform/tooling/codemods/v2-component-data-bridge.ts
   bun install
   ```

   `--check` exits 1 when changes are needed and writes nothing. `--source V2_ROOT`,
   `--convex-dir PATH` and a positional checkout path support alternate layouts. The tool
   refuses file collisions and mismatched Convex dependency versions; align dependencies
   separately if needed. Review every proposed file before deploying.

   The bridge adds the isolated component, its workspace dependency, and the internal migration
   module. It retains the old schema, API functions and scheduled function paths. Do not deploy
   v2's wrappers as the bridge: that would switch reads to empty component tables before copying.
3. Generate the bridge's Convex bindings and check its types. For a cloud deployment, use the
   selected deployment's codegen command; keep its deploy credentials out of logs. Review the
   bridge diff, including generated bindings and the lockfile. Do not run dev seed scripts.

## Stop writers, copy and verify

Keep a maintenance window open until the final backend and apps are deployed. Stop app/API
traffic that writes platform data, webhook consumers, admin operations, seeds and background
writers. Disable concurrent CD runs for this deployment. The `writersStopped: true` argument
is an operator acknowledgement, not a mechanism that stops your old application.

1. Deploy the additive bridge to the explicitly selected deployment, keeping the old app offline.
   Internal migration functions require operator/admin credentials; they are not public endpoints.
2. From the bridge's `packages/backend`, run:

   ```sh
   bunx convex run platform/componentMigration:run \
     '{"confirmDeployment":"https://YOUR-DEPLOYMENT.convex.cloud","writersStopped":true}'
   bunx convex run platform/componentMigration:status
   ```

   Select the same deployment using your deployment environment/deploy key or the CLI's
   `--deployment` option. The confirmation URL must exactly match the backend's built-in
   `CONVEX_CLOUD_URL`; a wrong URL fails before writing. Do not set or override that built-in.
3. Re-run `run` with the same arguments while it returns `resume: true`. `batchSize` and
   `maxBatches` are optional integers from 1 to 100 (defaults 50 and 100). Cursors and receipts
   commit with each copy, so an interrupted run can resume without duplicating rows. Copying
   announcements first transfers their pending jobs; copying audit last includes legacy job events.
4. Require `phase: "complete"` and `matches: true` from `status`. Save the per-table counts and
   completion evidence. It compares every source row's fields and original creation time,
   destination existence and counts, and invitation-to-waitlist mappings. Convex assigns new
   component IDs and creation times; receipts preserve the old IDs/timestamps. App code must
   use the exported component row types and opaque string IDs, not legacy app-model IDs.

Regular component APIs refuse reads/writes while migration is in progress. Pending legacy
announcement jobs are canceled in the same transaction that copies their row. Only pending,
matching jobs are rescheduled; completed/canceled/stale work is not resurrected. Component
jobs that become due during schedule activation wait for activation to finish. An expired
announcement window stays expired. Audit rows added by component jobs can make the component's
audit count greater than the source count; every source row must still match its receipt.

## Deploy the final version

Run the read-only deployment guard from the v2 root with `CONVEX_DEPLOY_KEY` set to the same
deployment key used by `convex deploy` (or an explicit self-hosted URL/admin-key pair). It refuses
implicit CLI defaults, because `run` defaults to dev while `deploy` defaults to production:

```sh
./platform/tooling/node-ts.sh platform/tooling/check-component-migration.ts
```

Deploy the final v2 backend, then the matching apps. Verify auth, admin settings, waitlist,
invitations and scheduled announcements before restoring traffic and CD. The legacy table
**definitions** disappear from the live schema; the migration does not delete legacy rows.
Those rows and the mapping receipts remain recovery evidence. Removing definitions can remove
legacy indexes; migration verification uses creation-order scans and does not depend on them.

`deploymentStatus` exposes the durable completion receipt used by future deploys. After normal
app writes resume, a full `status` scan may report differences because copied rows were changed
or deleted normally. Capture the full verification report during cutover, while writers are stopped.

## If a run stops

- A wrong deployment, nonempty destination, unknown scheduled callback, running job, conflicting
  natural key, missing parent or changed source/destination stops the migration. Inspect it;
  never overwrite destination data or declare success by editing migration state.
- If old jobs appended audit rows after that table's scan, stop the writers and explicitly rescan:

  ```sh
  bunx convex run platform/componentMigration:restartTable \
    '{"confirmDeployment":"https://YOUR-DEPLOYMENT.convex.cloud","writersStopped":true,"table":"auditTrail"}'
  ```

  Then re-run `run`. A rescan checks copied values and copies newly discovered rows. It does not
  overwrite changed rows. Keep legacy writers stopped after verification; a count scan is not a
  database-wide lock across action calls.
- Before any announcement job transfer, the old backend can remain in service after abandoning
  the attempt, provided you have not resumed component writers. Once jobs are transferred, merely
  redeploying old code is **not** a rollback: old job IDs were canceled. Keep maintenance in place
  and finish forward, or restore a rehearsed backup and explicitly restore/reconcile schedules.
  After component writes begin, reverting also needs reconciliation of those writes. The tooling
  never deletes rows, rolls deployments back, or copies data back automatically.
