/** App-owned migration registration and private sample-domain backfill. */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { components } from "./_generated/api";
import schema from "./schema";
import { organizationMigrationRegistry as registry } from "./organizationMigrationRegistry";
import { organizationRegistryHash, organizationMigrationFingerprint } from "./platform/organizationMigrationRegistry";
import { readOrganizationReadiness, organizationDeployment } from "./platform/organizationReadiness";
import { securityPolicyStage, identityStage, mappingStage, profileStage, authorityStages, auditStage, jobStage, ownerMapping, preservePrivateOwnership, recordDisposition, beginOrganizationMigration, stepOrganizationMigration, finalizeOrganizationMigration, type MigrationStage } from "./platform/organizationMigration";

const domainStages: MigrationStage[] = (["projects", "tasks", "uploads"] as const).map(table => ({ name: table, async run(ctx, cursor, size, verify) {
  const page = await ctx.db.query(table).paginate({ cursor, numItems: size });
  for (const row of page.page) {
    const mapping = await ownerMapping(ctx, row.ownerId);
    let organizationId = row.organizationId ?? mapping.organizationId;
    if ("projectId" in row) {
      const parent = await ctx.db.get(row.projectId);
      if (!parent || parent.ownerId !== row.ownerId || !parent.organizationId) throw new Error(`ORGANIZATION_PARENT_OWNERSHIP_INVALID:${table}:${row._id}`);
      if (row.organizationId && row.organizationId !== parent.organizationId) throw new Error(`ORGANIZATION_CHILD_CONTEXT_CONFLICT:${table}:${row._id}`);
      organizationId = parent.organizationId;
    }
    if (!organizationId) throw new Error(`ORGANIZATION_OWNER_MAPPING_REQUIRED:${table}:${row._id}`);
    if (verify && !row.organizationId) throw new Error(`ORGANIZATION_UNMIGRATED_ROW:${table}:${row._id}`);
    await preservePrivateOwnership(ctx, { source: table, sourceId: row._id, ownerId: row.ownerId, organizationId,
      wasTagged: Boolean(row.organizationId), creationTime: row._creationTime,
      parentId: "projectId" in row ? row.projectId : undefined, storageId: "storageId" in row ? row.storageId : undefined }, verify);
    if ("storageId" in row) {
      const references = await ctx.db.query("uploads").withIndex("by_storage", q => q.eq("storageId", row.storageId)).take(2);
      if (references.length !== 1 || references[0]._id !== row._id) throw new Error(`ORGANIZATION_STORAGE_SHARED:${row._id}`);
      const stored = await ctx.db.system.get(row.storageId);
      if (!stored || stored.size !== row.size) throw new Error(`ORGANIZATION_STORAGE_MISSING_OR_CHANGED:${row._id}`);
      // Preserve the existing security quarantine instead of manufacturing upload provenance.
      if (row.ownershipVersion !== 1) await recordDisposition(ctx, "uploads", row._id, "upload-provenance-quarantine",
        organizationMigrationFingerprint({ ...row, organizationId }), verify);
    }
    if (!row.organizationId) {
      await ctx.db.patch(row._id, { organizationId });
    }
  }
  return { cursor: page.continueCursor, done: page.isDone, count: page.page.length };
} }));
export const organizationMigrationStages = [securityPolicyStage, identityStage, mappingStage, profileStage, ...domainStages, ...authorityStages, auditStage, jobStage(registry)];
function checkTables() {
  // The separate source-inventory CLI checks functions/jobs before deployment; schema is live here.
  const actual = Object.keys(schema.tables).sort();
  const registered = Object.keys(registry.tables).sort();
  if (JSON.stringify(actual) !== JSON.stringify(registered)) throw new Error("ORGANIZATION_UNCLASSIFIED_TABLES");
}
export const begin = internalMutation({ args: { confirmDeployment: v.string(), deploymentVersion: v.string() }, handler: async (ctx, args) => {
  checkTables(); return await beginOrganizationMigration(ctx, registry, args);
} });
export const step = internalMutation({ args: { batchSize: v.optional(v.number()) }, handler: async (ctx, args) => {
  checkTables(); return await stepOrganizationMigration(ctx, registry, organizationMigrationStages, args.batchSize ?? 50);
} });
export const finalize = internalMutation({ args: {}, handler: async ctx => {
  checkTables(); return await finalizeOrganizationMigration(ctx, registry, organizationMigrationStages);
} });
export const status = internalQuery({ args: {}, handler: async ctx => ({ ...await readOrganizationReadiness(ctx), expectedRegistryHash: organizationRegistryHash(registry), stages: organizationMigrationStages.map(stage => stage.name) }) });

/** Existing runtime closes its barrier before deploy tooling changes environment or source. */
export const maintenance = internalMutation({ args: { confirmDeployment: v.string(), nextDeploymentVersion: v.string() }, handler: async (ctx, args) => {
  const identity = organizationDeployment();
  if (args.confirmDeployment !== identity.deployment || !args.nextDeploymentVersion) throw new Error("ORGANIZATION_INVALID_FORWARD_DEPLOYMENT");
  const { receipt } = await readOrganizationReadiness(ctx);
  if (!receipt || receipt.deployment !== identity.deployment) throw new Error("ORGANIZATION_MIGRATION_BEGIN_REQUIRED");
  if (receipt.nextDeploymentVersion && receipt.nextDeploymentVersion !== args.nextDeploymentVersion) throw new Error("ORGANIZATION_FORWARD_DEPLOYMENT_PENDING");
  // A failed deploy may already have updated the environment binding. Repeating
  // the exact recorded transition must keep maintenance closed and remain retryable.
  if (args.nextDeploymentVersion === identity.deploymentVersion
    && receipt.nextDeploymentVersion !== args.nextDeploymentVersion) throw new Error("ORGANIZATION_INVALID_FORWARD_DEPLOYMENT");
  await ctx.runMutation(components.betterAuth.organizationMigrationBarrier.set, { blocked: true, deploymentVersion: args.nextDeploymentVersion });
  await ctx.db.patch(receipt._id, { phase: "maintenance", nextDeploymentVersion: args.nextDeploymentVersion });
  return { phase: "maintenance", nextDeploymentVersion: args.nextDeploymentVersion };
} });

/** Explicit B-to-C recovery after preparation selected B but its source could not be deployed. */
export const recoverForward = internalMutation({ args: {
  confirmDeployment: v.string(), expectedPendingDeploymentVersion: v.string(), nextDeploymentVersion: v.string(),
}, handler: async (ctx, args) => {
  const identity = organizationDeployment();
  const { receipt } = await readOrganizationReadiness(ctx);
  const next = args.nextDeploymentVersion;
  if (args.confirmDeployment !== identity.deployment || !receipt || receipt.deployment !== identity.deployment
    || receipt.phase !== "maintenance" || !receipt.nextDeploymentVersion
    || receipt.nextDeploymentVersion !== args.expectedPendingDeploymentVersion
    || identity.deploymentVersion !== args.expectedPendingDeploymentVersion) throw new Error("ORGANIZATION_FORWARD_RECOVERY_CONFLICT");
  if (!next.trim() || next !== next.trim() || next.length > 256
    || next === receipt.nextDeploymentVersion || next === receipt.deploymentVersion) throw new Error("ORGANIZATION_INVALID_FORWARD_DEPLOYMENT");
  const abandoned = await ctx.db.query("organizationMigrationDispositions")
    .withIndex("by_recovery_pending", q => q.eq("transition.pendingDeploymentVersion", next)).first();
  const priorOrigin = await ctx.db.query("organizationMigrationDispositions")
    .withIndex("by_recovery_origin", q => q.eq("transition.fromDeploymentVersion", next)).first();
  if (abandoned || priorOrigin) throw new Error("ORGANIZATION_FORWARD_RECOVERY_ROLLBACK");
  const sequence = (receipt.recoverySequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence)) throw new Error("ORGANIZATION_FORWARD_RECOVERY_LIMIT");
  const transition = { deployment: identity.deployment, fromDeploymentVersion: receipt.deploymentVersion,
    pendingDeploymentVersion: receipt.nextDeploymentVersion, nextDeploymentVersion: next, happenedAt: Date.now() };
  // A fixed-size record per transition, never a growing array or reset of prior evidence.
  await ctx.db.insert("organizationMigrationDispositions", {
    key: `organization-forward-recovery:${sequence}`, source: "organization-forward-recovery", sourceId: String(sequence),
    disposition: "maintenance-forward-recovery", fingerprint: organizationMigrationFingerprint(transition), transition,
  });
  await ctx.runMutation(components.betterAuth.organizationMigrationBarrier.set, { blocked: true, deploymentVersion: next });
  await ctx.db.patch(receipt._id, { phase: "maintenance", nextDeploymentVersion: next, recoverySequence: sequence });
  return { phase: "maintenance" as const, nextDeploymentVersion: next, recoverySequence: sequence };
} });
