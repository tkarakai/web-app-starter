# Preserving organization cutover

Organization membership management requires a verified migration receipt for the **exact backend
source, deployment and app registry**. A boolean setting, successful generic migration run, empty
fixture or frontend feature flag cannot grant readiness. An empty installation follows the same
verification path as an existing installation.

The migration preserves authentication IDs, credential/factor records, existing canonical organization
IDs, resource IDs, linked `ownerId` values, child references and stored bytes. It does not enable
membership management, grant app-operator authority, share resources, delete history or mark a
quarantined upload as trusted. Uploads missing their original ownership provenance remain inaccessible
until a separate reviewed recovery establishes that provenance.

## App-owned registration and backfill

The app owns `packages/backend/convex/organizationMigrationRegistry.ts`,
`organizationMigration.ts` and the migration entry in `migrations.ts`. The platform supplies the
engine, durable bookkeeping, readiness checks and write barrier. The starter registers projects,
tasks and uploads; custom apps replace those stages with their own domain logic.

Run from the repository root:

```sh
./platform/tooling/node-ts.sh platform/tooling/codemods/organization-register-migration.ts --check
./platform/tooling/node-ts.sh platform/tooling/codemods/organization-register-migration.ts
./platform/tooling/node-ts.sh platform/tooling/organization-migration-check.ts --root .
```

The codemod only creates a missing registration seam, prints its path and never overwrites an app's
registry. Its empty registry deliberately fails verification. `--backend PATH` supports moved backend
layouts. Running it again is a no-op. It cannot infer a buyer's business ownership or convert an
arbitrary unscoped API into an authorized tenant API.

Register every app table and exported API with a reviewed disposition. Declare every scheduled job,
including jobs that appear only in old data. Source inspection rejects unregistered functions,
unclassified tables and dynamic scheduled references that need review. The live schema independently
checks the registered table set. Platform source and component behavior are covered by the exact
backend source digest; application registrations are covered by a separate SHA-256 registry digest.
A registry declaration is not a replacement for an executable backfill and verifier.

A `MigrationStage` has a stable `name` and `run(ctx, cursor, size, verify)` callback. It returns
`{ cursor, done, count }`. Each call processes at most 100 rows in a single transaction. The engine
first runs every stage to migrate, then runs every stage again with `verify: true`. The mandatory first
stage, `canonical-security-policy`, preserves policy under the already committed maintenance fence
and paginates canonical organization eligibility on both passes. Verification must
reject missing or inconsistent scope; it must never repair a row. A thrown error rolls back that
page's writes and cursor, so the same page can be retried after a reviewed correction. Neither retry
nor a forward deployment deletes owner mappings or restores old writers.

Use `ownerMapping(ctx, ownerId)` to resolve the stable authentication subject and personal organization.
A linked legacy owner ID can differ from the auth subject. Preserve it. For private domain rows,
call `preservePrivateOwnership(ctx, { source, sourceId, ownerId, organizationId, wasTagged,
creationTime, parentId?, storageId? }, verify)`. Supply the original Convex `_creationTime`, not an
editable business date. This records an immutable owner/auth-subject/organization/parent/storage
tuple in migration evidence; changing that tuple on a subsequent pass blocks readiness. Mutable
business content is not frozen by this ownership receipt.

A previously tagged row can outlive the creator's membership. It retains its existing organization
when the ownership receipt matches, or when original ownership has unambiguous canonical evidence:
the exact subject's current membership, its recorded departure from that organization, an accepted
invitation bound to the exact subject/member IDs, or its previously verified original personal-owner
mapping. For customers created after the previous cutover, the original personal organization can
also be established by its immutable personal-owner link and exact subject/organization enrollment
completion audit; later departure does not recreate membership during the next deployment scan.
Mutable email addresses and a bare organization tag do not establish provenance. A historical
personal-owner mapping does not require the original owner to remain an administrator after legitimate
demotion/departure. A member-only identity stays member-only after departure. No membership, personal
organization or authority is recreated to make retained resources accessible.

Existing personal/member-only mappings are not reclassified merely because an email becomes a
reserved operator address. Conversely, removing an email admission hint does not turn a previously
mapped pending operator into a customer. Canonical global role, auth-subject and mixed-identity
checks still apply; email is not authority.
When canonical operator onboarding has actually completed, a pending control mapping can refine
one-way to `app-operator` during migration. This requires the same owner/subject, no organization
mapping and the canonical operator predicate. Its mapping ID and original creation time remain,
and a durable disposition records the refinement. The migration itself never grants that role.

Untagged legacy rows still require a valid membership mapping before scope can be added. Verify a
child's private owner and parent before inheriting scope. Shared records, orphaned owners, conflicting children,
mixed/custom roles and app-operator-owned business rows block with an identifying error; they do not
silently disappear or inherit an operator's organization. Reports are internal deployment evidence,
never an operator-facing tenant data view.

## Write barrier and exact deployment binding

The supported deployment integration computes the actual source digest, validates the registry and
sets `ORGANIZATION_DEPLOYMENT_VERSION` and `ORGANIZATION_REGISTRY_HASH` on the selected Convex target.
These are deployment-owned values, not caller input or readiness overrides. `CONVEX_CLOUD_URL`
identifies the actual deployment. Missing or mismatched binding refuses readiness.

For an already verified deployment, the **currently deployed**
`organizationMigration:maintenance({ confirmDeployment, nextDeploymentVersion })` closes its barrier
before source or environment changes. The next version must differ and a different pending target
cannot replace it. A same-source verified redeploy reuses its matching receipt. On the first additive
upgrade, externally stop old admission/writers and drain incompatible work before migration: an old
binary cannot obey a gate it does not contain. Keep the database backup and compatible source artifacts.

After deploying the additive implementation, use internal deployment operations:

1. `organizationMigration:begin({ confirmDeployment, deploymentVersion })` commits the minimal
   maintenance fence and receipt. It does not inspect security eligibility in that transaction:
   malformed historical identities must not roll back the fence.
2. Repeatedly call `organizationMigration:step({ batchSize: 50 })` until `complete` is true. Save the
   exact source/registry evidence and inspect any row-specific blocker. The durable state resumes
   after interruption; do not reset it or change IDs to force completion. The first stage preserves
   canonical policy and verifies organizations in bounded pages. Ineligible historical administrators
   remain actionable blockers under maintenance; the migration never fabricates enrollment, factors,
   administrator roles or credentials. An unfinished personal enrollment remains personal until normal
   completion; a malformed already-enabled organization must be repaired through reviewed recovery.
3. `organizationMigration:finalize({})` checks all verification stages and the final queued-work
   barrier, requires the canonical policy, retires legacy writers permanently, and records readiness.
   Policy and identity/ownership writers remain fenced between verification pages and finalization;
   credential changes preserve the effective-administrator invariant. Repeating finalization for
   the same valid receipt is harmless.
4. `organizationMigration:status({})` returns the receipt and current deployment binding for trusted
   tooling. Public `platform/organizationReadiness:status` returns only `ready` and `phase` to an
   authenticated user. Completion must call `requireOrganizationReadiness(ctx)` on the backend.

Application mutations call `assertOrganizationWriteAllowed(ctx, "tenant")` in the **transaction that
writes**. Legacy entry points use `"legacy"` and stay denied after cutover. Actions must guard both
prepare and final commit; a pre-maintenance upload cannot finish during reconciliation. Identity
mapping writes must also consult the component maintenance barrier. Security self-service that
cannot change identity ownership can remain available. Every buyer-owned background writer needs
the same live check plus its captured immutable context and current authority epoch.

## Queues, authority and retained evidence

Old agent codes/grants/delegations expire and require new consent. Historical task messages/results
retain their original bytes and epoch quarantine; a new grant cannot recover them just because the
same user authored them. Existing app-operator transports retain their current operator-only contract.
Audit rows are retained as either safe operator projections or private historical quarantine; migration
never guesses an organization or broadcasts historical events to members.

Job dispositions are executable: `drain` blocks while pending/running, `cancel` cancels obsolete work,
`epoch-control` checks captured agent target epoch before canceling old work, and `preserve-control`
keeps specifically registered control jobs such as audit/admission email delivery. Unknown jobs block.
Legitimate future control schedules survive. Component announcement schedules remain control-plane
behavior and keep their scheduled times and IDs. Do not label a tenant job `preserve-control` to avoid
draining it. New app-owned jobs and mutations must be reviewed with the migration registry.

## Recovery and verification

A failed migration stays in maintenance. Keep its source and exact target binding, fix the named
mapping/relationship or deploy a compatible forward correction, and resume. Already migrated rows
and mappings are stable. Schema narrowing is a later step after every supported environment has
verified cutover; retain widened fields until then.

If preparation selected source **B** but deploying it failed, retrying the exact pending B transition
is safe even when the environment already names B. Normal preparation refuses to replace B with a
different target. To use a reviewed correction **C**, select explicit deployment credentials and run
the trusted deployment tool against C's source checkout:

```sh
./platform/tooling/node-ts.sh .github/actions/deploy-convex/organization-target.ts \
  recover-forward /path/to/corrected-source "$expectedPendingDigest"
```

`expectedPendingDigest` is the exact recorded B digest, not a guessed version label. The tool inspects
C's inventory and source, then calls internal
`organizationMigration:recoverForward({ confirmDeployment, expectedPendingDeploymentVersion,
nextDeploymentVersion })`. The mutation compares both stored pending B and current environment B,
keeps maintenance closed, and records one bounded append-only transition record. It rejects empty,
same-source and original/previously-abandoned rollback targets. It never clears legacy retirement,
owner mappings, dispositions or prior transition evidence. Stale concurrent recovery requests fail
without changing evidence. If recovery commits but the following environment write fails, the tool
can resume the exact recorded C target.

Recovery preparation does **not** deploy C or grant readiness. Deploy the compatible corrected source
through the guarded deployment path, then run its complete `begin`/`step`/`finalize` verification with
the selected target. Its source and registry must match before access reopens. Do not directly patch
the migration receipt or change a deployment version to bypass a blocker.

**Old single-tenant binaries are unsafe rollback targets.** The deployment action rejects source
without the organization contract marker and inventory. Restrict production deploy credentials to
that guarded path. A database receipt cannot stop someone with administrative deploy access from
manually deploying an old binary; do not claim otherwise. Restore functionality through compatible
forward recovery. Never reset the database, recreate accounts, erase membership history, move tags,
or restore an old writer to make a migration green.

The maintained in-memory rehearsal is `organizationMigration.test.ts`: starter linked-owner/resource
preservation, interruption/rerun, fresh installs, stale clients and transfers, ambiguity/orphans,
agent/audit quarantine, future schedules, retained departed-member data, forged-tag rejection,
immutable provenance, chained forward recovery, more than 1,000 organizations and a custom
invoice/tenant-agent extension. Run
`CI=true bun run --cwd packages/backend test:convex organizationMigration` and the focused tooling test
`./platform/tooling/node-ts.sh --test platform/tooling/tests/organization-migration.test.ts`.
These tests do not substitute for a disposable real deployment rehearsal of the selected source,
its actual scheduled work, all four agent transports and the buyer's own domain before rollout.
