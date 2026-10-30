import { randomUUID } from "node:crypto";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import { createTestEnv, modules } from "./test.modules";
import authSchema from "./platform/betterAuth/schema";
import { organizationMigrationRegistry as registry } from "./organizationMigrationRegistry";
import { organizationRegistryHash } from "./platform/organizationMigrationRegistry";
import { readOrganizationReadiness } from "./platform/organizationReadiness";
import { exposureInventory } from "./platform/agentExposure";
import { enrollOrganizationAdminForTest } from "../test/organizationSecurity";
import { mutation as authMutation } from "./platform/betterAuth/_generated/server";

const begin = makeFunctionReference<"mutation">("organizationMigration:begin");
const step = makeFunctionReference<"mutation">("organizationMigration:step");
const finalize = makeFunctionReference<"mutation">("organizationMigration:finalize");
const maintenance = makeFunctionReference<"mutation">("organizationMigration:maintenance");
const deployment = "https://independent-review.convex.cloud";
const sourceA = "review-source-a";
const sourceB = "review-source-b";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_CLOUD_URL", deployment);
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", sourceA);
  vi.stubEnv("ORGANIZATION_REGISTRY_HASH", organizationRegistryHash(registry));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, {
    ...import.meta.glob("./platform/betterAuth/**/*.*s"),
    // Historical fixture only: simulate persisted pre-boundary mixed ownership.
    // Never deploy or use this helper for security or migration under test.
    "./platform/betterAuth/reviewHistorical.ts": async () => ({
      promoteLegacyOwner: authMutation({ args: { userId: v.string() }, handler: async (ctx, { userId }) => {
        const id = ctx.db.normalizeId("user", userId); if (!id) throw new Error("Review fixture user missing");
        await ctx.db.patch(id, { role: "admin" });
      } }),
    }),
  });
  async function user(role = "user") {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: "Review fixture", email: `${randomUUID()}@example.test`, role, emailVerified: true, createdAt: now, updatedAt: now,
    } } });
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
      userId: user._id, accountId: user._id, providerId: "credential", password: "review-credential-hash", createdAt: now, updatedAt: now,
    } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: user._id, token: randomUUID(), authPurpose: "application", expiresAt: now + 86_400_000,
      createdAt: now, updatedAt: now, assuranceVersion: 1, authMethod: "password", primaryVerifiedAt: now, authenticatedAt: now,
    } } });
    return { user, client: t.withIdentity({ subject: user._id, sessionId: session._id }) };
  }
  async function scan() {
    for (let batch = 0; batch < 100; batch++) if ((await t.mutation(step, { batchSize: 100 })).complete) return;
    throw new Error("Review fixture exceeded bounded batches");
  }
  async function ready() {
    await t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: sourceA });
    await scan(); await t.mutation(finalize, {});
  }
  return { t, user, scan, ready };
}

test("begin durably fences writers before a preserving validation reports historical mixed authority", async () => {
  const f = fixture(); const alice = await f.user(); const bob = await f.user();
  const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
  const historical = components as unknown as { betterAuth: { reviewHistorical: {
    promoteLegacyOwner: FunctionReference<"mutation", "public", { userId: string }, null>;
  } } };
  await f.t.mutation(historical.betterAuth.reviewHistorical.promoteLegacyOwner, { userId: alice.user._id });
  await expect(f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: sourceA })).resolves.toBe("maintenance");
  await expect(f.scan()).rejects.toThrow(/ORGANIZATION|LAST_ORGANIZATION_ADMIN/);
  expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).phase).toBe("maintenance");
  await expect(bob.client.mutation(api.projects.create, { name: "stale writer", description: "must be fenced" })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "_id", value: org.organizationId }] })).toMatchObject({ personalOwnerId: alice.user._id });
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: alice.user._id }] })).toMatchObject({ role: "admin" });
});

test("a protected forward deployment resumes after preparation changed env but deploying source B failed", async () => {
  const f = fixture(); await f.ready();
  await f.t.mutation(maintenance, { confirmDeployment: deployment, nextDeploymentVersion: sourceB });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", sourceB);
  // prepareOrganizationDeployment repeats this exact call because the receipt is still source A.
  await expect(f.t.mutation(maintenance, { confirmDeployment: deployment, nextDeploymentVersion: sourceB })).resolves.toMatchObject({ phase: "maintenance" });
  expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(false);
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: sourceB });
  await f.scan(); await f.t.mutation(finalize, {});
  expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(true);
});

test("explicit forward recovery compare-and-swaps failed target B to C without reopening or deleting history", async () => {
  const f = fixture(); const alice = await f.user(); await f.ready();
  const mappings = await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect());
  expect(mappings).toHaveLength(1);
  const recover = makeFunctionReference<"mutation">("organizationMigration:recoverForward");
  const sourceC = "review-source-c";
  await f.t.mutation(maintenance, { confirmDeployment: deployment, nextDeploymentVersion: sourceB });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", sourceB);
  const previous = await f.t.run(ctx => readOrganizationReadiness(ctx));
  const request = { confirmDeployment: deployment, expectedPendingDeploymentVersion: sourceB, nextDeploymentVersion: sourceC };
  for (const invalid of [
    { ...request, confirmDeployment: "wrong" },
    { ...request, expectedPendingDeploymentVersion: "wrong" },
    { ...request, nextDeploymentVersion: "" },
    { ...request, nextDeploymentVersion: sourceB },
    { ...request, nextDeploymentVersion: sourceA },
  ]) {
    await expect(f.t.mutation(recover, invalid)).rejects.toThrow(/ORGANIZATION_/);
    expect(await f.t.run(ctx => readOrganizationReadiness(ctx))).toEqual(previous);
  }
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "unknown-env");
  await expect(f.t.mutation(recover, request)).rejects.toThrow(/ORGANIZATION_/);
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", sourceB);
  await f.t.mutation(recover, request);
  const pending = await f.t.run(ctx => readOrganizationReadiness(ctx));
  expect(pending).toMatchObject({ ready: false, phase: "maintenance", receipt: { legacyRetired: true, nextDeploymentVersion: sourceC } });
  expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect())).toEqual(mappings);
  const transition = await f.t.run(ctx => ctx.db.query("organizationMigrationDispositions").collect());
  expect(transition.length).toBeGreaterThan(0);
  await expect(alice.client.mutation(api.projects.create, { name: "old", description: "still blocked" })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  await expect(f.t.mutation(finalize, {})).rejects.toThrow(/ORGANIZATION_/);
  // A repeated stale B-to-C request must never authorize D or alter the stored transition.
  await expect(f.t.mutation(recover, { ...request, nextDeploymentVersion: "review-source-d" })).rejects.toThrow(/ORGANIZATION_/);
  expect(await f.t.run(ctx => ctx.db.query("organizationMigrationDispositions").collect())).toEqual(transition);
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", sourceC);
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: sourceC });
  await f.scan(); await f.t.mutation(finalize, {});
  expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(true);
  expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect())).toEqual(mappings);
});

test("tenant query refuses business data during the cutover barrier", async () => {
  const f = fixture(); const alice = await f.user();
  const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
  await f.ready();
  const projectId = await alice.client.mutation(api.tenantProjects.create, { organizationId: org.organizationId, name: "Retained", description: "private" });
  expect(await alice.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: projectId })).toMatchObject({ _id: projectId });
  await f.t.mutation(maintenance, { confirmDeployment: deployment, nextDeploymentVersion: sourceB });
  await expect(alice.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: projectId })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
});

test("no receipt permits legacy personal continuity but refuses strict tenant data until verified", async () => {
  const f = fixture(); const alice = await f.user();
  const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
  const projectId = await alice.client.mutation(api.projects.create, { name: "Legacy personal", description: "Preserve continuity" });
  expect(await alice.client.query(api.projects.get, { id: projectId })).toMatchObject({ _id: projectId });
  await expect(alice.client.mutation(api.tenantProjects.create, { organizationId: org.organizationId, name: "premature", description: "must refuse" })).rejects.toThrow("ORGANIZATION_MIGRATION_REQUIRED");
  await expect(alice.client.query(api.tenantProjects.list, { organizationId: org.organizationId })).rejects.toThrow("ORGANIZATION_MIGRATION_REQUIRED");
  await f.ready();
  expect(await alice.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: projectId })).toMatchObject({ _id: projectId });
  await expect(alice.client.query(api.projects.get, { id: projectId })).rejects.toThrow("ORGANIZATION_LEGACY_RETIRED");
});

test("a changed source binding closes tenant reads as well as writes", async () => {
  const f = fixture(); const alice = await f.user();
  await f.ready();
  const org = (await alice.client.query(api.platform.tenantContext.mine, {}))!.contexts[0];
  const projectId = await alice.client.mutation(api.tenantProjects.create, { organizationId: org.organizationId, name: "Retained", description: "private" });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", sourceB);
  await expect(alice.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: projectId })).rejects.toThrow("ORGANIZATION_MIGRATION_REQUIRED");
});

test("revoking old authority cannot mutate preservation evidence after it was verified", async () => {
  const f = fixture(); const operator = await f.user("admin");
  const grantId = await f.t.run(ctx => ctx.db.insert("agentGrants", {
    tokenHash: "review-old-hash", userId: operator.user._id, clientId: "historical", resource: "https://old.test", scope: "admin:manage", createdAt: 1, expiresAt: Date.now() + 60_000,
  }));
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: sourceA });
  await f.scan();
  await expect(operator.client.mutation(api.platform.agentAccess.revoke, { grantId })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  await f.t.mutation(finalize, {});
});

test("email changes cannot alter operator-admission classification after identity verification", async () => {
  const f = fixture(); const alice = await f.user();
  const operatorCandidateEmail = "pending-operator-review@example.test";
  await f.t.mutation(components.platform.adminEmails.ensure, { email: operatorCandidateEmail });
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: sourceA });
  await f.scan();
  const before = await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect());
  expect(before).toHaveLength(1);
  expect(before[0].disposition).toBe("personal");
  // This adapter mutation is the same transactional persistence boundary used
  // by native verified email change; mapUser currently consults this email.
  await expect(f.t.mutation(components.betterAuth.adapter.updateOne, { input: {
    model: "user", where: [{ field: "_id", value: alice.user._id }], update: { email: operatorCandidateEmail },
  } })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  await f.t.mutation(finalize, {});
  expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect())).toEqual(before);
});

test("completing an existing pending operator admission does not block the next preserving deployment", async () => {
  const f = fixture(); const candidate = await f.user();
  await f.t.mutation(components.platform.adminEmails.ensure, { email: candidate.user.email });
  await f.ready();
  const before = await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect());
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({ authSubject: candidate.user._id, disposition: "app-operator-pending" });
  // Trusted fixture models the canonical role write after successful operator
  // onboarding. No customer membership or admission is added by this transition.
  await f.t.mutation(components.betterAuth.adapter.updateOne, { input: {
    model: "user", where: [{ field: "_id", value: candidate.user._id }], update: { role: "admin" },
  } });
  await f.t.mutation(maintenance, { confirmDeployment: deployment, nextDeploymentVersion: sourceB });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", sourceB);
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: sourceB });
  await f.scan(); await f.t.mutation(finalize, {});
  const after = await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect());
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ _id: before[0]._id, authSubject: candidate.user._id, ownerId: before[0].ownerId });
  expect(["app-operator", "app-operator-pending"]).toContain(after[0].disposition);
  expect(after[0].organizationId).toBeUndefined();
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "personalOwnerId", value: candidate.user._id }] })).toBeNull();
});

test("registered root internal APIs have explicit exposure inventory entries", async () => {
  const classified = new Set(exposureInventory().map(row => row.operation));
  const discovered: string[] = [];
  const missing: string[] = [];
  for (const [path, load] of Object.entries(modules)) {
    if (path.includes("/_generated/") || path.includes(".test.") || path.includes(".config.") || path.startsWith("./platform/betterAuth/")) continue;
    const exported = await load() as Record<string, { isInternal?: boolean; isQuery?: boolean; isMutation?: boolean; isAction?: boolean }>;
    for (const [name, fn] of Object.entries(exported)) {
      if (!fn?.isInternal || !(fn.isQuery || fn.isMutation || fn.isAction)) continue;
      const operation = `${path.slice(2).replace(/\.ts$/, "")}:${name}`;
      discovered.push(operation);
      if (!classified.has(operation)) missing.push(operation);
    }
  }
  expect(discovered).toContain("organizationMigration:begin");
  expect(discovered.length).toBeGreaterThan(40);
  expect(missing.sort()).toEqual([]);
});

test("a forward deployment preserves a departed member's private rows without restoring membership", async () => {
  const f = fixture(); const alice = await f.user(); const bob = await f.user();
  await f.ready();
  const org = (await alice.client.query(api.platform.tenantContext.mine, {}))!.contexts[0];
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: {
    userId: alice.user._id, secret: "review-factor", backupCodes: "review-backup-set", verified: true,
  } } });
  await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: alice.user._id }], update: { twoFactorEnabled: true } } });
  await enrollOrganizationAdminForTest(f.t, { organizationId: org.organizationId, userId: alice.user._id });
  // Trusted fixture membership stands for a completed invitation; authority removal uses the public API.
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    organizationId: org.organizationId, userId: bob.user._id, role: "member", createdAt: Date.now(),
  } } });
  const projectId = await bob.client.mutation(api.tenantProjects.create, { organizationId: org.organizationId, name: "Bob private", description: "Retain on departure" });
  await bob.client.mutation(api.platform.memberManagement.leave, { organizationId: org.organizationId });
  const retained = await f.t.run(ctx => ctx.db.get(projectId));
  expect(retained?.ownerId).toBe(bob.user._id);
  await expect(bob.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: projectId })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
  await f.t.mutation(maintenance, { confirmDeployment: deployment, nextDeploymentVersion: sourceB });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", sourceB);
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: sourceB });
  await f.scan(); await f.t.mutation(finalize, {});
  expect(await f.t.run(ctx => ctx.db.get(projectId))).toEqual(retained);
  await expect(bob.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: projectId })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
});
