import { readAdminPasskeyPolicy } from "./organizationPolicy";
import { isAppOperatorIdentity } from "./appOperatorIdentity";
/** Preserving cutover engine. Each step and checkpoint commit atomically; failures never advance. */
import { components } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { ORGANIZATION_MIGRATION_KEY, organizationDeployment, readOrganizationReadiness } from "./organizationReadiness";
import { organizationRegistryHash, organizationMigrationFingerprint, type OrganizationMigrationRegistry } from "./organizationMigrationRegistry";
import { AGENT_CONTRACT_EPOCH } from "./agentContract";
import { projectAppOperatorAudit } from "./auditPrivacy";

export type MigrationPage = { cursor: string; done: boolean; count: number };
export type MigrationStage = { name: string; run: (ctx: MutationCtx, cursor: string | null, size: number, verify: boolean) => Promise<MigrationPage> };
/** Begin commits the fence first; policy/eligibility failures leave this stage retryable. */
export const securityPolicyStage: MigrationStage = { name: "canonical-security-policy", async run(ctx, cursor, size, verify) {
  const { deploymentVersion } = organizationDeployment();
  if (!verify && cursor === null) {
    await ctx.runMutation(components.betterAuth.organizationSecurity.initializeMigrationPolicy, {
      deploymentVersion, value: await readAdminPasskeyPolicy(ctx),
    });
  }
  // The component requires the exact sealed barrier and an existing canonical policy.
  // Both passes paginate eligibility; verification never manufactures a missing policy.
  return ctx.runQuery(components.betterAuth.organizationSecurity.verifyMigrationPolicyPage, {
    deploymentVersion, paginationOpts: { cursor, numItems: size },
  });
} };
const mappings = (ctx: Pick<QueryCtx, "db">) => ctx.db.query("organizationOwnerMappings");
export async function ownerMapping(ctx: Pick<QueryCtx, "db">, ownerId: string) {
  const row = await mappings(ctx).withIndex("by_owner", q => q.eq("ownerId", ownerId)).unique();
  if (!row || (row.disposition === "app-operator" || row.disposition === "app-operator-pending")) throw new Error(`ORGANIZATION_OWNER_UNRESOLVED:${ownerId}`);
  return row;
}
async function mapUser(ctx: MutationCtx, user: Doc<"user">, verify: boolean) {
  const ownerId = user.userId ?? user._id;
  const previous = await mappings(ctx).withIndex("by_subject", q => q.eq("authSubject", user._id)).unique();
  const collision = await mappings(ctx).withIndex("by_owner", q => q.eq("ownerId", ownerId)).unique();
  if ((collision && collision.authSubject !== user._id) || (previous && previous.ownerId !== ownerId)) throw new Error(`ORGANIZATION_OWNER_AMBIGUOUS:${user._id}`);
  const role = user.role ?? "user";
  if (role !== "user" && role !== "admin") throw new Error(`ORGANIZATION_ROLE_UNCLASSIFIED:${user._id}`);
  // Reserved email is an admission hint for first classification, never authority
  // to reclassify a stable customer mapping or silently release a pending operator.
  const operatorEnrollment = previous ? previous.disposition === "app-operator-pending"
    : await ctx.runQuery(components.platform.adminInvitations.requiresEnrollment, { email: user.email });
  if (role === "admin" && !await isAppOperatorIdentity(ctx, user)) throw new Error(`ORGANIZATION_MIXED_OPERATOR_IDENTITY:${user._id}`);
  let organizationId: string | undefined;
  let disposition: "personal" | "member-only" | "app-operator" | "app-operator-pending" = role === "admin" ? "app-operator" : operatorEnrollment ? "app-operator-pending" : "member-only";
  if (role === "user" && !operatorEnrollment) {
    // Read canonical rows directly; disabled/banned identities still need preservation, not deletion.
    const personal = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "personalOwnerId", value: user._id }] });
    if (personal) organizationId = personal._id;
    else {
      const member = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "member", where: [{ field: "userId", value: user._id }] });
      const claim = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "organizationInvitationClaims", where: [{ field: "userId", value: user._id }] });
      // Departure never turns an already classified invited identity into a new customer.
      if (!member && !claim && previous?.disposition !== "member-only") {
        if (verify) throw new Error(`ORGANIZATION_PERSONAL_MAPPING_REQUIRED:${user._id}`);
        organizationId = (await ctx.runMutation(components.betterAuth.organizationMigration.provisionLegacyPersonal, { userId: user._id, deploymentVersion: organizationDeployment().deploymentVersion })).organizationId;
      }
    }
    if (organizationId) {
      const membership = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "member", where: [{ field: "organizationId", value: organizationId }, { field: "userId", value: user._id }] });
      const retired = (await readOrganizationReadiness(ctx)).receipt?.legacyRetired;
      const enrolledOrigin = retired && personal?.experience === "collaborative"
        ? await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "organizationAudit", where: [
          { field: "action", value: "admin.enrollment_completed" }, { field: "actorId", value: user._id },
          { field: "organizationId", value: organizationId },
        ] }) : null;
      const historicalOwner = retired && (previous?.disposition === "personal" && previous.organizationId === organizationId
        || Boolean(enrolledOrigin?.targetId));
      // personalOwnerId records origin, not perpetual membership or administrator authority.
      // A customer born after cutover may enroll and leave before its first scan.
      // Exact subject/org enrollment history proves that origin without assuming
      // current membership. First cutover still requires the original admin mapping.
      if (membership?.role !== "org-admin" && !(historicalOwner && (!membership || membership.role === "member"))) {
        throw new Error(`ORGANIZATION_PERSONAL_MEMBERSHIP_INVALID:${user._id}`);
      }
      disposition = "personal";
    }
  }
  if (previous) {
    if (previous.disposition === "app-operator-pending" && disposition === "app-operator"
      && !previous.organizationId && !organizationId) {
      // Canonical onboarding already granted the global role and the mixed-identity
      // guard above proved this is a control identity. Refine only classification,
      // retaining the mapping ID, immutable ownership keys and a durable transition.
      if (verify) throw new Error(`ORGANIZATION_OPERATOR_MAPPING_REFINEMENT_REQUIRED:${user._id}`);
      await recordDisposition(ctx, "organization-owner-mapping", previous._id, "canonical-operator-admission-completed",
        organizationMigrationFingerprint({ ownerId, authSubject: user._id, from: previous.disposition, to: disposition }), false);
      await ctx.db.patch(previous._id, { disposition });
      return;
    }
    if (previous.organizationId !== organizationId || previous.disposition !== disposition) throw new Error(`ORGANIZATION_MAPPING_CHANGED:${user._id}`);
  } else {
    if (verify) throw new Error(`ORGANIZATION_MAPPING_MISSING:${user._id}`);
    await ctx.db.insert("organizationOwnerMappings", { ownerId, authSubject: user._id, organizationId, disposition, createdAt: Date.now() });
  }
}
export const identityStage: MigrationStage = { name: "identities", async run(ctx, cursor, size, verify) {
  const page = await ctx.runQuery(components.betterAuth.adapter.findMany, { model: "user", paginationOpts: { cursor, numItems: size } });
  if (page.pageStatus === "SplitRequired") throw new Error("ORGANIZATION_IDENTITY_SCAN_SPLIT_REQUIRED");
  for (const user of page.page) await mapUser(ctx, user as Doc<"user">, verify);
  return { cursor: page.continueCursor, done: page.isDone, count: page.page.length };
} };
export const mappingStage: MigrationStage = { name: "owner-mappings", async run(ctx, cursor, size) {
  const page = await ctx.db.query("organizationOwnerMappings").paginate({ cursor, numItems: size });
  for (const row of page.page) {
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: row.authSubject }] });
    if (!user) throw new Error(`ORGANIZATION_MAPPING_SUBJECT_MISSING:${row._id}`);
    await mapUser(ctx, user as Doc<"user">, true);
  }
  return { cursor: page.continueCursor, done: page.isDone, count: page.page.length };
} };
export async function recordDisposition(ctx: MutationCtx, source: string, sourceId: string, disposition: string, fingerprint: string, verify: boolean) {
  const key = `${source}:${sourceId}`;
  const previous = await ctx.db.query("organizationMigrationDispositions").withIndex("by_key", q => q.eq("key", key)).unique();
  if (previous) {
    if (previous.disposition !== disposition || previous.fingerprint !== fingerprint) throw new Error(`ORGANIZATION_DISPOSITION_CHANGED:${key}`);
  } else {
    if (verify) throw new Error(`ORGANIZATION_DISPOSITION_MISSING:${key}`);
    await ctx.db.insert("organizationMigrationDispositions", { key, source, sourceId, disposition, fingerprint });
  }
}
/** Ownership evidence survives membership removal; it never grants read/write authority. */
export async function preservePrivateOwnership(ctx: MutationCtx, args: {
  source: string; sourceId: string; ownerId: string; organizationId: string; wasTagged: boolean;
  creationTime: number; parentId?: string; storageId?: string;
}, verify: boolean) {
  const mapping = await ownerMapping(ctx, args.ownerId);
  const organization = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "_id", value: args.organizationId }] });
  if (!organization) throw new Error(`ORGANIZATION_CONTEXT_MISSING:${args.source}:${args.sourceId}`);
  const source = `private-ownership/${args.source}`;
  const fingerprint = organizationMigrationFingerprint({ ownerId: args.ownerId, authSubject: mapping.authSubject,
    organizationId: args.organizationId, creationTime: args.creationTime, parentId: args.parentId, storageId: args.storageId });
  const previous = await ctx.db.query("organizationMigrationDispositions").withIndex("by_key", q => q.eq("key", `${source}:${args.sourceId}`)).unique();
  if (!previous) {
    const memberships = await ctx.runQuery(components.betterAuth.adapter.findMany, { model: "member",
      where: [{ field: "organizationId", value: args.organizationId }, { field: "userId", value: mapping.authSubject }],
      paginationOpts: { cursor: null, numItems: 2 } });
    if (!memberships.isDone || memberships.page.length > 1) throw new Error(`ORGANIZATION_MEMBERSHIP_AMBIGUOUS:${args.source}:${args.sourceId}`);
    const membership = memberships.page[0];
    if (membership && !["org-admin", "member"].includes(membership.role)) throw new Error(`ORGANIZATION_MEMBERSHIP_MAPPING_INVALID:${args.source}:${args.sourceId}`);
    let proven = Boolean(membership);
    if (!proven && args.wasTagged) {
      // Canonical subject IDs, never mutable email or the fact that another user is a member.
      const departure = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "organizationAudit", where: [
        { field: "organizationId", value: args.organizationId }, { field: "actorId", value: mapping.authSubject },
        // Application audit time has integer-ms precision; Convex creation time can be fractional.
        { field: "action", value: "member.left" }, { field: "happenedAt", operator: "gte", value: Math.floor(args.creationTime) },
      ] });
      const invitation = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "invitation", where: [
        { field: "organizationId", value: args.organizationId }, { field: "acceptedUserId", value: mapping.authSubject },
        { field: "status", value: "accepted" }, { field: "createdAt", operator: "lte", value: args.creationTime },
      ] });
      // The original personal owner is also historical admission evidence after verified cutover.
      const historicalOwner = mapping.disposition === "personal" && mapping.organizationId === args.organizationId
        && organization.personalOwnerId === mapping.authSubject && (await readOrganizationReadiness(ctx)).receipt?.legacyRetired;
      proven = Boolean(departure?.targetId || invitation?.acceptedMemberId || historicalOwner);
    }
    if (!proven) throw new Error(`ORGANIZATION_PRIVATE_PROVENANCE_REQUIRED:${args.source}:${args.sourceId}`);
  }
  await recordDisposition(ctx, source, args.sourceId, "immutable-private-ownership", fingerprint, verify);
}
const authorityTables = ["agentAuthorizationCodes", "agentGrants", "agentDelegations", "agentTasks", "agentTaskMessages"] as const;
export const authorityStages: MigrationStage[] = authorityTables.map(table => ({ name: table, async run(ctx, cursor, size, verify) {
  const page = await ctx.db.query(table).paginate({ cursor, numItems: size });
  for (const row of page.page) {
    if (row.contractEpoch === AGENT_CONTRACT_EPOCH) continue;
    // All pre-contract authority expires; task evidence remains byte-for-byte retained under epoch quarantine.
    if (table !== "agentTasks" && table !== "agentTaskMessages" && row.expiresAt > 0) {
      if (verify) throw new Error(`ORGANIZATION_OLD_AUTHORITY_LIVE:${row._id}`);
      await ctx.db.patch(row._id, { expiresAt: 0 });
    }
    const preserved = { ...row, ...(table !== "agentTasks" && table !== "agentTaskMessages" ? { expiresAt: 0 } : {}) };
    await recordDisposition(ctx, table, row._id, table === "agentTasks" || table === "agentTaskMessages" ? "epoch-quarantine" : "expired-reconsent-required", organizationMigrationFingerprint(preserved), verify);
  }
  return { cursor: page.continueCursor, done: page.isDone, count: page.page.length };
} }));
export const profileStage: MigrationStage = { name: "userProfiles", async run(ctx, cursor, size) {
  const page = await ctx.db.query("userProfiles").paginate({ cursor, numItems: size });
  for (const row of page.page) {
    const owner = await mappings(ctx).withIndex("by_owner", q => q.eq("ownerId", row.ownerId)).unique();
    if (!owner) throw new Error(`ORGANIZATION_PROFILE_OWNER_UNRESOLVED:${row._id}`);
  }
  return { cursor: page.continueCursor, done: page.isDone, count: page.page.length };
} };
export const auditStage: MigrationStage = { name: "audit-history", async run(ctx, cursor, size, verify) {
  const page = await ctx.runQuery(components.platform.auditTrail.list, { paginationOpts: { cursor, numItems: size } });
  for (const row of page.page) {
    const disposition = await projectAppOperatorAudit(ctx, row) ? "operator-projection" : "private-history-quarantine";
    await recordDisposition(ctx, "auditTrail", row._id, disposition, organizationMigrationFingerprint(row), verify);
  }
  return { cursor: page.continueCursor, done: page.isDone, count: page.page.length };
} };
export function jobStage(registry: OrganizationMigrationRegistry): MigrationStage {
  return { name: "scheduled-work", async run(ctx, cursor, size, verify) {
    const page = await ctx.db.system.query("_scheduled_functions").paginate({ cursor, numItems: size });
    for (const row of page.page) {
      if (row.state.kind !== "pending" && row.state.kind !== "inProgress") continue;
      const name = row.name.replace(/\.js:/, ":");
      const disposition = registry.jobs[name];
      if (!disposition) throw new Error(`ORGANIZATION_JOB_UNCLASSIFIED:${name}:${row._id}`);
      if (disposition === "preserve-control") continue;
      if (disposition === "epoch-control") {
        const argument = row.args[0] as Record<string, unknown> | undefined;
        const id = argument?.taskId ?? argument?.codeId ?? argument?.grantId ?? argument?.delegationId;
        if (typeof id !== "string") throw new Error(`ORGANIZATION_JOB_ARGUMENT_UNCLASSIFIED:${name}:${row._id}`);
        const targetId = ctx.db.normalizeId(name.includes("agentTasks") ? "agentTasks" : name.endsWith("expireCode") ? "agentAuthorizationCodes" : name.endsWith("expireGrant") ? "agentGrants" : "agentDelegations", id);
        const target = targetId ? await ctx.db.get(targetId) : null;
        if (!target || target.contractEpoch === AGENT_CONTRACT_EPOCH) continue;
      }
      if (row.state.kind === "inProgress" || disposition === "drain" || verify) throw new Error(`ORGANIZATION_JOB_DRAIN_REQUIRED:${name}:${row._id}`);
      await ctx.scheduler.cancel(row._id);
      await recordDisposition(ctx, "scheduled-work", row._id, "canceled-obsolete-authority", organizationMigrationFingerprint(row.args), false);
    }
    return { cursor: page.continueCursor, done: page.isDone, count: page.page.length };
  } };
}
export function assertMigrationStages(registry: OrganizationMigrationRegistry, stages: MigrationStage[]) {
  const names = stages.map(stage => stage.name);
  if (new Set(names).size !== names.length) throw new Error("ORGANIZATION_DUPLICATE_MIGRATION_STAGE");
  if (names[0] !== securityPolicyStage.name) throw new Error("ORGANIZATION_SECURITY_POLICY_STAGE_REQUIRED");
  const required = ["canonical-security-policy", "identities", "owner-mappings", "audit-history", "scheduled-work", ...Object.entries(registry.tables)
    .filter(([, disposition]) => !["platform-control", "migration-bookkeeping"].includes(disposition)).map(([table]) => table)];
  const missing = required.filter(name => !names.includes(name));
  if (missing.length) throw new Error(`ORGANIZATION_BACKFILL_UNREGISTERED:${missing.join(",")}`);
}
function binding(registry: OrganizationMigrationRegistry) {
  const identity = organizationDeployment();
  if (identity.registryHash !== organizationRegistryHash(registry)) throw new Error("ORGANIZATION_REGISTRY_BINDING_MISMATCH");
  return identity;
}
export async function beginOrganizationMigration(ctx: MutationCtx, registry: OrganizationMigrationRegistry, args: { confirmDeployment: string; deploymentVersion: string }) {
  const identity = binding(registry);
  if (args.confirmDeployment !== identity.deployment || args.deploymentVersion !== identity.deploymentVersion) throw new Error("ORGANIZATION_WRONG_DEPLOYMENT");
  const { receipt } = await readOrganizationReadiness(ctx);
  if (receipt && receipt.deployment === identity.deployment && receipt.deploymentVersion === identity.deploymentVersion && receipt.registryHash === identity.registryHash) return receipt.phase;
  if (receipt?.nextDeploymentVersion && receipt.nextDeploymentVersion !== identity.deploymentVersion) throw new Error("ORGANIZATION_FORWARD_DEPLOYMENT_PENDING");
  await ctx.runMutation(components.betterAuth.organizationMigrationBarrier.set, { blocked: true, deploymentVersion: identity.deploymentVersion });
  const fields = { nextDeploymentVersion: undefined, ...identity, phase: "maintenance" as const, stage: 0, cursor: null, scanned: 0, startedAt: Date.now(), verifiedAt: undefined, problem: undefined };
  if (receipt) {
    if (receipt.deployment !== identity.deployment) throw new Error("ORGANIZATION_RECEIPT_WRONG_DEPLOYMENT");
    // Forward source changes reverify without ever restoring old writers or deleting mappings.
    await ctx.db.patch(receipt._id, fields);
  } else await ctx.db.insert("organizationMigrationState", { key: ORGANIZATION_MIGRATION_KEY, ...fields, legacyRetired: false });
  return "maintenance";
}
export async function stepOrganizationMigration(ctx: MutationCtx, registry: OrganizationMigrationRegistry, stages: MigrationStage[], size: number) {
  assertMigrationStages(registry, stages);
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error("ORGANIZATION_INVALID_BATCH_SIZE");
  const identity = binding(registry);
  const { receipt } = await readOrganizationReadiness(ctx);
  if (!receipt || receipt.deploymentVersion !== identity.deploymentVersion || receipt.registryHash !== identity.registryHash || receipt.deployment !== identity.deployment) throw new Error("ORGANIZATION_MIGRATION_BEGIN_REQUIRED");
  if (receipt.nextDeploymentVersion) throw new Error("ORGANIZATION_FORWARD_DEPLOYMENT_PENDING");
  if (receipt.phase === "ready") return { complete: true, stage: "ready", scanned: receipt.scanned };
  const index = receipt.stage % stages.length;
  const verify = receipt.stage >= stages.length;
  if (receipt.stage >= stages.length * 2) return { complete: true, stage: "verified", scanned: receipt.scanned };
  // Throwing rolls back ALL changes and the cursor; operator repairs cause a same-page retry.
  const page = await stages[index].run(ctx, receipt.cursor, size, verify);
  await ctx.db.patch(receipt._id, { stage: receipt.stage + (page.done ? 1 : 0), cursor: page.done ? null : page.cursor, scanned: receipt.scanned + page.count });
  return { complete: page.done && receipt.stage + 1 === stages.length * 2, stage: `${verify ? "verify" : "migrate"}:${stages[index].name}`, scanned: page.count };
}
export async function finalizeOrganizationMigration(ctx: MutationCtx, registry: OrganizationMigrationRegistry, stages: MigrationStage[]) {
  assertMigrationStages(registry, stages);
  const identity = binding(registry);
  const { receipt, ready } = await readOrganizationReadiness(ctx);
  if (ready) return { ...identity, phase: "ready" as const };
  if (!receipt || receipt.phase !== "maintenance" || receipt.stage !== stages.length * 2 || receipt.nextDeploymentVersion) throw new Error("ORGANIZATION_VERIFICATION_INCOMPLETE");
  if (receipt.deployment !== identity.deployment || receipt.deploymentVersion !== identity.deploymentVersion || receipt.registryHash !== identity.registryHash) throw new Error("ORGANIZATION_RECEIPT_STALE");
  // Query all live jobs in the final transaction, including jobs inserted after the paginated scan.
  const permitted = Object.entries(registry.jobs).filter(([, disposition]) => disposition === "preserve-control" || disposition === "epoch-control")
    .flatMap(([name]) => [name, name.replace(":", ".js:")]);
  const live = await ctx.db.system.query("_scheduled_functions").filter(q => q.and(
    q.or(q.eq(q.field("state.kind"), "pending"), q.eq(q.field("state.kind"), "inProgress")),
    ...permitted.map(name => q.neq(q.field("name"), name)),
  )).first();
  if (live) throw new Error(`ORGANIZATION_JOB_DRAIN_REQUIRED:${live._id}`);
  if (await ctx.runQuery(components.betterAuth.organizationSecurity.policy, {}) === null) throw new Error("ORGANIZATION_SECURITY_POLICY_MISSING");
  await ctx.runMutation(components.betterAuth.organizationMigrationBarrier.set, { blocked: false, deploymentVersion: identity.deploymentVersion });
  await ctx.db.patch(receipt._id, { phase: "ready", legacyRetired: true, verifiedAt: Date.now() });
  return { ...identity, phase: "ready" as const };
}
