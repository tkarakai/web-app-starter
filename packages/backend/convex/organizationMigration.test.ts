import { randomUUID } from "node:crypto";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import { createTestEnv } from "./test.modules";
import authSchema from "./platform/betterAuth/schema";
import { organizationMigrationRegistry as registry } from "./organizationMigrationRegistry";
import { organizationRegistryHash, assertOrganizationInventory } from "./platform/organizationMigrationRegistry";
import { readOrganizationReadiness } from "./platform/organizationReadiness";
import { mutation as authMutation } from "./platform/betterAuth/_generated/server";
import { enrollOrganizationAdminForTest } from "../test/organizationSecurity";

const begin = makeFunctionReference<"mutation">("organizationMigration:begin");
const step = makeFunctionReference<"mutation">("organizationMigration:step");
const finalize = makeFunctionReference<"mutation">("organizationMigration:finalize");
const deployment = "https://migration-fixture.convex.cloud";
const deploymentVersion = "fixture-exact-source-v1";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_CLOUD_URL", deployment);
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", deploymentVersion);
  vi.stubEnv("ORGANIZATION_REGISTRY_HASH", organizationRegistryHash(registry));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./platform/betterAuth/**/*.*s"));
  async function user(ownerId?: string, role = "user") {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: "Migration fixture", email: `${randomUUID()}@example.test`, role, userId: ownerId,
      emailVerified: true, createdAt: now, updatedAt: now,
    } } });
    const account = await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
      userId: user._id, accountId: user._id, providerId: "credential", password: "unchanged-credential-hash", createdAt: now, updatedAt: now,
    } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: user._id, token: randomUUID(), authPurpose: "application", expiresAt: now + 86_400_000,
      createdAt: now, updatedAt: now, assuranceVersion: 1, authMethod: "password", primaryVerifiedAt: now, authenticatedAt: now,
    } } });
    return { user, account, session, ownerId: ownerId ?? user._id, client: t.withIdentity({ subject: user._id, sessionId: session._id }) };
  }
  async function scan() {
    for (let batch = 0; batch < 150; batch++) {
      const result = await t.mutation(step, { batchSize: 1 });
      if (result.complete) return;
    }
    throw new Error("Fixture exceeded bounded batches");
  }
  async function run() {
    await t.mutation(begin, { confirmDeployment: deployment, deploymentVersion });
    await scan();
  }
  return { t, user, run, scan };
}

describe("preserving organization migration registered entry points", () => {
  test("preserves linked owner, canonical org, credentials, parent/child IDs and stored bytes across interruption and rerun", async () => {
    const f = fixture(); const alice = await f.user("legacy-owner-42");
    const personal = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
    const seed = await f.t.run(async ctx => {
      const project = await ctx.db.insert("projects", { ownerId: alice.ownerId, name: "Private", description: "Keep", createdAt: 123 });
      const task = await ctx.db.insert("tasks", { ownerId: alice.ownerId, projectId: project, title: "Keep", description: "Keep", status: "todo", createdAt: 124 });
      const storage = await ctx.storage.store(new Blob(["unchanged bytes"], { type: "text/plain" }));
      const upload = await ctx.db.insert("uploads", { ownerId: alice.ownerId, projectId: project, storageId: storage, name: "keep.txt", contentType: "text/plain", size: 15, ownershipVersion: 1, createdAt: 125 });
      return { project, task, storage, upload };
    });
    await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion });
    // The component paginator may need an empty terminal page. Interrupt at the
    // semantic checkpoint, rather than assuming exactly two physical batches.
    let interrupted = false;
    for (let batch = 0; batch < 10; batch++) {
      const result = await f.t.mutation(step, { batchSize: 1 });
      if (result.stage === "migrate:identities") { interrupted = true; break; }
    }
    expect(interrupted).toBe(true);
    expect((await alice.client.query(api.platform.tenantContext.mine, {}))?.legacyPrivateAvailable).toBe(false);
    const map = await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect());
    expect(map).toHaveLength(1);
    expect(map[0]).toMatchObject({ ownerId: alice.ownerId, authSubject: alice.user._id, organizationId: personal.organizationId });
    await f.run(); await f.t.mutation(finalize, {});
    expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(true);
    const saved = await f.t.run(async ctx => ({ project: await ctx.db.get(seed.project), task: await ctx.db.get(seed.task), upload: await ctx.db.get(seed.upload), bytes: await (await ctx.storage.get(seed.storage))!.text() }));
    expect(saved.project).toMatchObject({ _id: seed.project, ownerId: alice.ownerId, organizationId: personal.organizationId, createdAt: 123 });
    expect(saved.task).toMatchObject({ _id: seed.task, ownerId: alice.ownerId, projectId: seed.project, organizationId: personal.organizationId });
    expect(saved.upload).toMatchObject({ _id: seed.upload, storageId: seed.storage, ownershipVersion: 1, organizationId: personal.organizationId });
    expect(saved.bytes).toBe("unchanged bytes");
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "_id", value: alice.account._id }] })).toEqual(alice.account);
    await f.run();
    expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect())).toEqual(map);
    expect((await alice.client.query(api.tenantProjects.list, { organizationId: personal.organizationId }))?.map(row => row._id)).toEqual([seed.project]);
    const discovered = await alice.client.query(api.platform.tenantContext.mine, {});
    expect(discovered?.legacyPrivateAvailable).toBe(false);
    expect(discovered?.contexts[0]).toMatchObject({ enrollmentStarted: false, enrollmentPending: false });
    expect(await alice.client.query(api.platform.tenantContext.get, { organizationId: personal.organizationId })).toMatchObject({ primaryContactMemberId: null });
    await expect(alice.client.mutation(api.projects.create, { name: "stale", description: "blocked" })).rejects.toThrow("ORGANIZATION_LEGACY_RETIRED");
    expect((await f.t.run(ctx => ctx.db.query("projects").collect()))).toHaveLength(1);
  });
  test("fresh empty deployment must verify, rejects mismatched binding and remains closed after source change", async () => {
    const f = fixture();
    await expect(f.t.mutation(finalize, {})).rejects.toThrow("ORGANIZATION_VERIFICATION_INCOMPLETE");
    await expect(f.t.mutation(begin, { confirmDeployment: "other", deploymentVersion })).rejects.toThrow("ORGANIZATION_WRONG_DEPLOYMENT");
    await f.run(); await f.t.mutation(finalize, {});
    expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(true);
    vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "fixture-new-source");
    expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(false);
    await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: "fixture-new-source" });
    expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).receipt?.legacyRetired).toBe(true);
    await expect(f.t.mutation(finalize, {})).rejects.toThrow("ORGANIZATION_VERIFICATION_INCOMPLETE");
    vi.stubEnv("ORGANIZATION_REGISTRY_HASH", "wrong");
    await expect(f.t.mutation(step, {})).rejects.toThrow("ORGANIZATION_REGISTRY_BINDING_MISMATCH");
  });
  test("maintenance fences legacy and tenant writes and a file transfer started before the barrier", async () => {
    const f = fixture(); const alice = await f.user();
    const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
    await f.run(); await f.t.mutation(finalize, {});
    const projectId = await alice.client.mutation(api.tenantProjects.create, { organizationId: org.organizationId, name: "Existing", description: "private" });
    await alice.client.mutation(internal.tenantFiles.beginUpload, { organizationId: org.organizationId, projectId });
    const storageId = await f.t.run(ctx => ctx.storage.store(new Blob(["retained"])));
    await f.t.mutation(makeFunctionReference<"mutation">("organizationMigration:maintenance"), { confirmDeployment: deployment, nextDeploymentVersion: "forward-fixture" });
    vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "forward-fixture");
    await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: "forward-fixture" });
    await expect(alice.client.mutation(api.projects.create, { name: "old", description: "old" })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
    await expect(alice.client.mutation(api.tenantProjects.create, { organizationId: org.organizationId, name: "new", description: "new" })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
    await expect(alice.client.mutation(internal.tenantFiles.finishUpload, { organizationId: org.organizationId, projectId, storageId, name: "file", contentType: "text/plain", size: 8, ownerId: alice.ownerId })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
    expect(await f.t.run(ctx => ctx.db.query("uploads").collect())).toEqual([]);
    expect(await f.t.run(async ctx => (await ctx.storage.get(storageId))!.text())).toBe("retained");
  });
  test("ambiguous linked owners, operator resources, custom roles and orphans fail closed without lost rows", async () => {
    for (const kind of ["collision", "operator", "custom", "orphan"] as const) {
      const f = fixture(); const alice = await f.user(kind === "collision" ? "duplicate" : undefined, kind === "operator" ? "admin" : kind === "custom" ? "billing" : "user");
      if (kind === "collision") await f.user("duplicate");
      const project = await f.t.run(ctx => ctx.db.insert("projects", { ownerId: kind === "orphan" ? "missing-owner" : alice.ownerId, name: "Retain", description: "retained", createdAt: 1 }));
      const before = await f.t.run(ctx => ctx.db.get(project));
      await expect(f.run()).rejects.toThrow(/ORGANIZATION_(OWNER_AMBIGUOUS|OWNER_UNRESOLVED|ROLE_UNCLASSIFIED)/);
      expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(false);
      expect(await f.t.run(ctx => ctx.db.get(project))).toEqual(before);
    }
  });
  test("conflicting child ownership cannot inherit a parent tenant and prevents readiness", async () => {
    const f = fixture(); const alice = await f.user(); const bob = await f.user();
    const ids = await f.t.run(async ctx => {
      const project = await ctx.db.insert("projects", { ownerId: alice.ownerId, name: "Alice", description: "private", createdAt: 1 });
      const task = await ctx.db.insert("tasks", { ownerId: bob.ownerId, projectId: project, title: "Conflicting", description: "retained", status: "todo", createdAt: 2 });
      return { project, task };
    });
    const child = await f.t.run(ctx => ctx.db.get(ids.task));
    await expect(f.run()).rejects.toThrow("ORGANIZATION_PARENT_OWNERSHIP_INVALID");
    expect(await f.t.run(ctx => ctx.db.get(ids.task))).toEqual(child);
    await expect(f.t.mutation(finalize, {})).rejects.toThrow("ORGANIZATION_VERIFICATION_INCOMPLETE");
  });
  test("verification catches an unguarded stale writer, and unknown queued work blocks final reconciliation", async () => {
    const f = fixture(); const alice = await f.user();
    await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion });
    // First pass has completed project scanning when this deliberately unguarded old binary writes.
    for (;;) { const page = await f.t.mutation(step, { batchSize: 100 }); if (page.stage === "migrate:projects") break; }
    const id = await f.t.run(ctx => ctx.db.insert("projects", { ownerId: alice.ownerId, name: "Old binary", description: "retained", createdAt: 1 }));
    await expect(f.run()).rejects.toThrow("ORGANIZATION_UNMIGRATED_ROW");
    expect(await f.t.run(ctx => ctx.db.get(id))).toMatchObject({ name: "Old binary" });
    const fresh = fixture();
    await fresh.t.run(ctx => ctx.scheduler.runAfter(60_000, makeFunctionReference<"mutation">("unknown:oldWriter"), {}));
    await expect(fresh.run()).rejects.toThrow("ORGANIZATION_JOB_UNCLASSIFIED");
  });
  test("old agent credentials expire and historical task/audit payloads remain quarantined and intact", async () => {
    const f = fixture(); const alice = await f.user();
    const ids = await f.t.run(async ctx => {
      const grant = await ctx.db.insert("agentGrants", { tokenHash: "old-hash", userId: alice.user._id, clientId: "old", resource: "https://old.test", scope: "admin:manage", createdAt: 1, expiresAt: Date.now() + 60000 });
      const task = await ctx.db.insert("agentTasks", { userId: alice.user._id, grantId: grant, resource: "https://old.test", generation: "old", contextId: "old", messageId: "old", requestHash: "old", state: "TASK_STATE_COMPLETED", result: "private historical artifact", createdAt: 1, updatedAt: 1, expiresAt: Date.now() + 60000 });
      return { grant, task };
    });
    const before = await f.t.run(ctx => ctx.db.get(ids.task));
    await f.t.mutation(components.platform.auditTrail.insertEvent, { actor: "private actor", source: "server:historical", action: "auth.sign_in", resource: "private", status: "succeeded" });
    await f.run(); await f.t.mutation(finalize, {});
    expect((await f.t.run(ctx => ctx.db.get(ids.grant)))?.expiresAt).toBe(0);
    expect(await f.t.run(ctx => ctx.db.get(ids.task))).toEqual(before);
    const dispositions = await f.t.run(ctx => ctx.db.query("organizationMigrationDispositions").collect());
    expect(dispositions.map(row => row.disposition).sort()).toEqual(["epoch-quarantine", "expired-reconsent-required", "private-history-quarantine"].sort());
  });
  test("custom business and tenant-agent registrations cannot silently omit unknown surfaces", () => {
    const inventory = { tables: [...Object.keys(registry.tables), "invoices"], functions: [...Object.keys(registry.functions), "tenantAgent:execute"], jobs: ["tenantAgent:send"] };
    expect(() => assertOrganizationInventory(registry, inventory)).toThrow("ORGANIZATION_UNCLASSIFIED_TABLES");
    const custom = { ...registry, tables: { ...registry.tables, invoices: "private-root" as const }, functions: { ...registry.functions, "tenantAgent:execute": "tenant" as const }, jobs: { "tenantAgent:send": "drain" as const } };
    expect(() => assertOrganizationInventory(custom, inventory)).not.toThrow();
    expect(organizationRegistryHash(custom)).not.toBe(organizationRegistryHash(registry));
  });
});

import { convexTest } from "convex-test";
import { registerPlatform } from "@web-app-starter/convex-platform/test";
import { modules } from "./test.modules";
import { customSchema, customRegistry, customFunctions } from "../test/organizationMigrationCustom.fixture";

test("custom buyer invoice migration preserves IDs and rejects shared rows and stale tenant-agent authority", async () => {
  const t = convexTest(customSchema, { ...modules, "./buyerTenantAgent.ts": () => Promise.resolve(customFunctions) });
  registerPlatform(t); t.registerComponent("betterAuth", authSchema, import.meta.glob("./platform/betterAuth/**/*.*s"));
  vi.stubEnv("ORGANIZATION_REGISTRY_HASH", organizationRegistryHash(customRegistry));
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
    name: "Buyer", email: "buyer@example.test", role: "user", emailVerified: true, createdAt: 1, updatedAt: 1,
  } } });
  const invoice = await t.run(ctx => ctx.db.insert("invoices", { ownerId: user._id, amount: 123, shared: true }));
  const refs = { begin: makeFunctionReference<"mutation">("buyerTenantAgent:begin"), step: makeFunctionReference<"mutation">("buyerTenantAgent:step"), finalize: makeFunctionReference<"mutation">("buyerTenantAgent:finalize"), write: makeFunctionReference<"mutation">("buyerTenantAgent:writeInvoice") };
  const queued = await t.run(ctx => ctx.scheduler.runAfter(60_000, refs.write, { ownerId: user._id, epoch: 1 }));
  await t.mutation(refs.begin, { confirmDeployment: deployment, deploymentVersion });
  let reachedShared = false;
  for (let i = 0; i < 100; i++) {
    try { await t.mutation(refs.step, {}); }
    catch (error) { expect(String(error)).toContain("BUYER_SHARED_INVOICE_REQUIRES_REVIEW"); reachedShared = true; break; }
  }
  expect(reachedShared).toBe(true);
  expect(await t.run(ctx => ctx.db.get(invoice))).toMatchObject({ _id: invoice, amount: 123, shared: true });
  await expect(t.mutation(refs.finalize, {})).rejects.toThrow("ORGANIZATION_VERIFICATION_INCOMPLETE");
  // An explicit buyer-reviewed disposition repairs the custom ambiguity; cursor resumes in place.
  await t.run(ctx => ctx.db.patch(invoice, { shared: false }));
  let drainBlocked = false;
  for (let i = 0; i < 100; i++) {
    try { await t.mutation(refs.step, {}); }
    catch (error) { expect(String(error)).toContain("ORGANIZATION_JOB_DRAIN_REQUIRED"); drainBlocked = true; break; }
  }
  expect(drainBlocked).toBe(true);
  await expect(t.mutation(refs.write, { ownerId: user._id, epoch: 1 })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  // The buyer explicitly retires this captured pre-epoch job; nothing is replayed under new authority.
  await t.run(ctx => ctx.scheduler.cancel(queued));
  expect((await t.run(ctx => ctx.db.system.get(queued)))?.state.kind).toBe("canceled");
  let complete = false;
  for (let i = 0; i < 100; i++) { if ((await t.mutation(refs.step, {})).complete) { complete = true; break; } }
  expect(complete).toBe(true); await t.mutation(refs.finalize, {});
  const preserved = await t.run(ctx => ctx.db.get(invoice));
  expect(preserved).toMatchObject({ _id: invoice, ownerId: user._id, amount: 123, shared: false });
  expect(preserved?.organizationId).toBeTruthy();
  await expect(t.mutation(refs.write, { ownerId: user._id, epoch: 1 })).rejects.toThrow("BUYER_OLD_QUEUED_AUTHORITY");
  await expect(t.mutation(refs.write, { ownerId: user._id, organizationId: "other-tenant", epoch: 2 })).rejects.toThrow("BUYER_CONTEXT_MISMATCH");
  await t.mutation(refs.write, { ownerId: user._id, organizationId: preserved!.organizationId!, epoch: 2 });
  expect(await t.run(ctx => ctx.db.query("invoices").collect())).toHaveLength(2);
});

test("final barrier preserves future control schedules and cancels old-epoch agent schedules", async () => {
  const f = fixture();
  const grant = await f.t.run(ctx => ctx.db.insert("agentGrants", { tokenHash: "retired", userId: "historical", clientId: "old", resource: "https://old.test", scope: "admin:manage", createdAt: 1, expiresAt: Date.now() + 86400000 }));
  const jobs = await f.t.run(async ctx => ({
    old: await ctx.scheduler.runAfter(86400000, internal.platform.agentAccess.expireGrant, { grantId: grant }),
    control: await ctx.scheduler.runAfter(86400000, internal.platform.auditTrail.insertEvent, { actor: "control", sourceDetail: "audit", action: "auth.sign_in", resource: "control", status: "succeeded" }),
  }));
  await f.run(); await f.t.mutation(finalize, {}); await f.t.mutation(finalize, {});
  expect((await f.t.run(ctx => ctx.db.system.get(jobs.old)))?.state.kind).toBe("canceled");
  expect((await f.t.run(ctx => ctx.db.system.get(jobs.control)))?.state.kind).toBe("pending");
  expect(await f.t.run(ctx => ctx.db.get(grant))).toMatchObject({ _id: grant, expiresAt: 0 });
});

test("forward deployment maintenance cannot reopen a ready receipt on the old source", async () => {
  const f = fixture(); await f.run(); await f.t.mutation(finalize, {});
  const maintenance = makeFunctionReference<"mutation">("organizationMigration:maintenance");
  await f.t.mutation(maintenance, { confirmDeployment: deployment, nextDeploymentVersion: "next-source" });
  expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(false);
  await expect(f.t.mutation(finalize, {})).rejects.toThrow("ORGANIZATION_VERIFICATION_INCOMPLETE");
  await expect(f.t.mutation(step, {})).rejects.toThrow("ORGANIZATION_FORWARD_DEPLOYMENT_PENDING");
  await expect(f.t.mutation(maintenance, { confirmDeployment: deployment, nextDeploymentVersion: "different-target" })).rejects.toThrow("ORGANIZATION_FORWARD_DEPLOYMENT_PENDING");
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "next-source");
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: "next-source" });
  expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).receipt?.legacyRetired).toBe(true);
});

test("canonical banned users and pending operator admission survive without changed identity or authority", async () => {
  const f = fixture(); const banned = await f.user("banned-linked-owner"); const pending = await f.user();
  await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: banned.user._id }], update: { banned: true, banReason: "preserve" } } });
  await f.t.mutation(components.platform.adminEmails.ensure, { email: pending.user.email });
  await f.run(); await f.t.mutation(finalize, {});
  const users = await f.t.query(components.betterAuth.adapter.findMany, { model: "user", paginationOpts: { cursor: null, numItems: 10 } });
  expect(users.page.find(user => user._id === banned.user._id)).toMatchObject({ banned: true, banReason: "preserve", userId: "banned-linked-owner", role: "user" });
  const mappings = await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect());
  expect(mappings.find(row => row.authSubject === banned.user._id)).toMatchObject({ disposition: "personal", ownerId: "banned-linked-owner" });
  expect(mappings.find(row => row.authSubject === pending.user._id)).toMatchObject({ disposition: "app-operator-pending" });
  expect(mappings.find(row => row.authSubject === pending.user._id)?.organizationId).toBeUndefined();
  const organizations = await f.t.query(components.betterAuth.adapter.findMany, { model: "organization", paginationOpts: { cursor: null, numItems: 10 } });
  expect(organizations.page).toHaveLength(1);
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "_id", value: banned.account._id }] })).toEqual(banned.account);
});

test("component identity mappings, profile changes and expiry cleanup are fenced through final verification", async () => {
  const f = fixture(); const alice = await f.user();
  const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
  const grant = await f.t.run(ctx => ctx.db.insert("agentGrants", { tokenHash: "retained", userId: alice.user._id, clientId: "old", resource: "https://old.test", scope: "admin:manage", createdAt: 1, expiresAt: 0 }));
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion });
  for (const update of [{ userId: "changed-owner" }, { role: "admin" }, { customerAdmission: "public-signup" }]) {
    await expect(f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: alice.user._id }], update } })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  }
  await expect(f.user()).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  await expect(f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "user", where: [{ field: "_id", value: alice.user._id }] } })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  await expect(f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "organization", where: [{ field: "_id", value: org.organizationId }], update: { personalOwnerId: "changed" } } })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  await expect(alice.client.mutation(api.platform.userProfiles.setLocale, { locale: "en" })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
  await f.t.mutation(internal.platform.agentAccess.expireGrant, { grantId: grant });
  expect(await f.t.run(ctx => ctx.db.get(grant))).toMatchObject({ _id: grant, expiresAt: 0 });
  await f.run(); await f.t.mutation(finalize, {});
  await alice.client.mutation(api.platform.userProfiles.setLocale, { locale: "en" });
  expect(await alice.client.query(api.platform.userProfiles.getLocale, {})).toBe("en");
});

test("shared storage fails closed while unique historical upload quarantine retains bytes and provenance", async () => {
  const f = fixture(); const alice = await f.user();
  const seed = await f.t.run(async ctx => {
    const projectId = await ctx.db.insert("projects", { ownerId: alice.ownerId, name: "Retain", description: "private", createdAt: 1 });
    const storageId = await ctx.storage.store(new Blob(["keep"]));
    const row = { projectId, storageId, ownerId: alice.ownerId, name: "legacy", contentType: "text/plain", size: 4, createdAt: 1 };
    const first = await ctx.db.insert("uploads", row); const second = await ctx.db.insert("uploads", row);
    return { projectId, storageId, first, second };
  });
  await expect(f.run()).rejects.toThrow("ORGANIZATION_STORAGE_SHARED");
  expect(await f.t.run(ctx => ctx.db.query("uploads").collect())).toHaveLength(2);
  expect(await f.t.run(async ctx => (await ctx.storage.get(seed.storageId))!.text())).toBe("keep");
  // Explicitly resolve duplicate metadata without deleting the second row or original blob.
  await f.t.run(async ctx => { const storageId = await ctx.storage.store(new Blob(["keep"])); await ctx.db.patch(seed.second, { storageId }); });
  await f.run(); await f.t.mutation(finalize, {});
  const first = await f.t.run(ctx => ctx.db.get(seed.first));
  expect(first?.ownershipVersion).toBeUndefined();
  expect(first?.storageId).toBe(seed.storageId);
  const receipts = await f.t.run(ctx => ctx.db.query("organizationMigrationDispositions").collect());
  expect(receipts.filter(row => row.disposition === "upload-provenance-quarantine")).toHaveLength(2);
  await expect(alice.client.query(api.tenantFiles.listUploads, { projectId: seed.projectId, organizationId: first!.organizationId! })).rejects.toThrow("FILE_QUARANTINED");
});

test("a forged first-cutover tenant tag cannot use another identity's membership as ownership provenance", async () => {
  const f = fixture(); const alice = await f.user(); const bob = await f.user();
  const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
  const project = await f.t.run(ctx => ctx.db.insert("projects", { ownerId: bob.ownerId, organizationId: org.organizationId,
    name: "Ambiguous history", description: "Must remain private and blocked", createdAt: 1 }));
  const retained = await f.t.run(ctx => ctx.db.get(project));
  await expect(f.run()).rejects.toThrow(`ORGANIZATION_PRIVATE_PROVENANCE_REQUIRED:projects:${project}`);
  expect(await f.t.run(ctx => ctx.db.get(project))).toEqual(retained);
  expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(false);
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "member",
    where: [{ field: "organizationId", value: org.organizationId }, { field: "userId", value: bob.user._id }] })).toBeNull();
});

test("departed member-only identity keeps its classification, private child graph and bytes without personal provisioning", async () => {
  const f = fixture(); const alice = await f.user(); const bob = await f.user("invited-legacy-owner");
  const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    organizationId: org.organizationId, userId: bob.user._id, role: "member", createdAt: Date.now(),
  } } });
  await f.run(); await f.t.mutation(finalize, {});
  const project = await bob.client.mutation(api.tenantProjects.create, { organizationId: org.organizationId, name: "Private", description: "Retain after leave" });
  const task = await bob.client.mutation(api.tenantTasks.create, { organizationId: org.organizationId, projectId: project, title: "Private child", description: "Retain", status: "todo" });
  const file = await f.t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["private retained bytes"]));
    const id = await ctx.db.insert("uploads", { organizationId: org.organizationId, ownerId: bob.ownerId, projectId: project,
      storageId, name: "retained", contentType: "text/plain", size: 22, ownershipVersion: 1, createdAt: Date.now() });
    return { id, storageId };
  });
  // The real public leave records canonical org+subject history and removes current authority.
  await bob.client.mutation(api.platform.memberManagement.leave, { organizationId: org.organizationId });
  const retained = await f.t.run(async ctx => ({ project: await ctx.db.get(project), task: await ctx.db.get(task), file: await ctx.db.get(file.id) }));
  const mappings = await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect());
  expect(mappings.find(row => row.authSubject === bob.user._id)).toMatchObject({ disposition: "member-only", ownerId: bob.ownerId });
  await f.t.mutation(makeFunctionReference<"mutation">("organizationMigration:maintenance"), { confirmDeployment: deployment, nextDeploymentVersion: "departed-member-forward" });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "departed-member-forward");
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: "departed-member-forward" });
  await f.scan(); await f.t.mutation(finalize, {});
  expect(await f.t.run(async ctx => ({ project: await ctx.db.get(project), task: await ctx.db.get(task), file: await ctx.db.get(file.id) }))).toEqual(retained);
  expect(await f.t.run(async ctx => (await ctx.storage.get(file.storageId))!.text())).toBe("private retained bytes");
  expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect())).toEqual(mappings);
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "personalOwnerId", value: bob.user._id }] })).toBeNull();
  await expect(bob.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: project })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
});

test("new customer can enroll and depart before its first forward-deployment identity scan", async () => {
  const f = fixture(); await f.run(); await f.t.mutation(finalize, {});
  const alice = await f.user("post-cutover-owner"); const bob = await f.user();
  const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
  const project = await alice.client.mutation(api.tenantProjects.create, { organizationId: org.organizationId, name: "Retained", description: "Private after departure" });
  for (const person of [alice, bob]) {
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: {
      userId: person.user._id, secret: "post-cutover-secret", backupCodes: "post-cutover-codes", verified: true,
    } } });
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: person.user._id }], update: { twoFactorEnabled: true } } });
  }
  await enrollOrganizationAdminForTest(f.t, { organizationId: org.organizationId, userId: alice.user._id });
  const second = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    organizationId: org.organizationId, userId: bob.user._id, role: "member", createdAt: Date.now(),
  } } });
  await f.t.mutation(components.betterAuth.organizations.changeMember, { organizationId: org.organizationId, actorId: alice.user._id, memberId: second._id, operation: "promote" });
  await enrollOrganizationAdminForTest(f.t, { organizationId: org.organizationId, userId: bob.user._id });
  await f.t.mutation(components.betterAuth.organizations.changeMember, { organizationId: org.organizationId, actorId: bob.user._id, memberId: org.memberId, operation: "demote" });
  await f.t.mutation(components.betterAuth.organizations.changeMember, { organizationId: org.organizationId, actorId: bob.user._id, memberId: org.memberId, operation: "remove" });
  expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect())).toEqual([]);
  const retained = await f.t.run(ctx => ctx.db.get(project));
  const next = "post-signup-departure";
  await f.t.mutation(makeFunctionReference<"mutation">("organizationMigration:maintenance"), { confirmDeployment: deployment, nextDeploymentVersion: next });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", next);
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: next });
  await f.scan(); await f.t.mutation(finalize, {});
  expect(await f.t.run(ctx => ctx.db.get(project))).toEqual(retained);
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "member", where: [{ field: "_id", value: org.memberId }] })).toBeNull();
  expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").withIndex("by_subject", q => q.eq("authSubject", alice.user._id)).unique()))
    .toMatchObject({ ownerId: alice.ownerId, authSubject: alice.user._id, organizationId: org.organizationId, disposition: "personal" });
  // Factor enrollment withdrew this old session's proof. Both that session and
  // a fresh ordinary session must remain unable to read the departed context.
  expect(await alice.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: project })).toBeNull();
  const factor = await f.t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: alice.user._id }] });
  await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: alice.session._id }], update: {
    primaryVerifiedAt: Date.now(), strongVerifiedAt: Date.now(), strongFactorType: "totp", strongFactorId: factor!._id,
  } } });
  await expect(alice.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: project })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
});

test("immutable private ownership receipt detects retagging even when the same owner belongs to the destination", async () => {
  const f = fixture(); const alice = await f.user(); const bob = await f.user();
  const first = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
  const other = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: bob.user._id });
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    organizationId: other.organizationId, userId: alice.user._id, role: "member", createdAt: Date.now(),
  } } });
  const project = await f.t.run(ctx => ctx.db.insert("projects", { ownerId: alice.ownerId, name: "Original", description: "private", createdAt: 1 }));
  await f.run(); await f.t.mutation(finalize, {});
  expect(await f.t.run(ctx => ctx.db.get(project))).toMatchObject({ organizationId: first.organizationId });
  const evidence = await f.t.run(ctx => ctx.db.query("organizationMigrationDispositions").collect());
  // Deliberately unguarded fixture write models a corrupt old/importing writer, never a supported API.
  await f.t.run(ctx => ctx.db.patch(project, { organizationId: other.organizationId }));
  await f.t.mutation(makeFunctionReference<"mutation">("organizationMigration:maintenance"), { confirmDeployment: deployment, nextDeploymentVersion: "retagged-source" });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "retagged-source");
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: "retagged-source" });
  await expect(f.scan()).rejects.toThrow("ORGANIZATION_DISPOSITION_CHANGED");
  expect(await f.t.run(ctx => ctx.db.query("organizationMigrationDispositions").collect())).toEqual(evidence);
  expect(await f.t.run(ctx => ctx.db.get(project))).toMatchObject({ _id: project, ownerId: alice.ownerId, organizationId: other.organizationId });
  await expect(f.t.mutation(finalize, {})).rejects.toThrow("ORGANIZATION_VERIFICATION_INCOMPLETE");
});

test("verified original owner mapping survives public demotion and later departure while another effective admin remains", async () => {
  const f = fixture(); const alice = await f.user(); const bob = await f.user();
  const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice.user._id });
  const project = await f.t.run(ctx => ctx.db.insert("projects", { ownerId: alice.ownerId, name: "Historical owner", description: "private", createdAt: 1 }));
  await f.run(); await f.t.mutation(finalize, {});
  const retained = await f.t.run(ctx => ctx.db.get(project));
  const mappings = await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect());
  for (const actor of [alice, bob]) {
    const factor = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: {
      userId: actor.user._id, verified: true, secret: `factor-${actor.user._id}`, backupCodes: "retained-recovery-set",
    } } });
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: actor.user._id }], update: { twoFactorEnabled: true } } });
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: actor.session._id }], update: {
      strongVerifiedAt: Date.now(), strongFactorId: factor._id, strongFactorType: "totp",
    } } });
  }
  await enrollOrganizationAdminForTest(f.t, { organizationId: org.organizationId, userId: alice.user._id });
  const member = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    organizationId: org.organizationId, userId: bob.user._id, role: "member", createdAt: Date.now(),
  } } });
  await alice.client.mutation(api.platform.memberManagement.change, { organizationId: org.organizationId, memberId: member._id, operation: "promote" });
  await enrollOrganizationAdminForTest(f.t, { organizationId: org.organizationId, userId: bob.user._id });
  await bob.client.mutation(api.platform.memberManagement.change, { organizationId: org.organizationId, memberId: org.memberId, operation: "demote" });
  for (const next of ["after-original-owner-demotion", "after-original-owner-departure"]) {
    if (next === "after-original-owner-departure") await alice.client.mutation(api.platform.memberManagement.leave, { organizationId: org.organizationId });
    await f.t.mutation(makeFunctionReference<"mutation">("organizationMigration:maintenance"), { confirmDeployment: deployment, nextDeploymentVersion: next });
    vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", next);
    await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: next });
    await f.scan(); await f.t.mutation(finalize, {});
    expect(await f.t.run(ctx => ctx.db.get(project))).toEqual(retained);
    expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect())).toEqual(mappings);
  }
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "_id", value: org.organizationId }] })).toMatchObject({ personalOwnerId: alice.user._id });
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "member", where: [{ field: "organizationId", value: org.organizationId }, { field: "userId", value: alice.user._id }] })).toBeNull();
  await expect(alice.client.query(api.tenantProjects.get, { organizationId: org.organizationId, id: project })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
});

test("forward recovery retains an append-only transition chain and cannot return to an abandoned source", async () => {
  const f = fixture(); await f.user(); await f.run(); await f.t.mutation(finalize, {});
  const recover = makeFunctionReference<"mutation">("organizationMigration:recoverForward");
  const maintenance = makeFunctionReference<"mutation">("organizationMigration:maintenance");
  await f.t.mutation(maintenance, { confirmDeployment: deployment, nextDeploymentVersion: "failed-B" });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "failed-B");
  const request = { confirmDeployment: deployment, expectedPendingDeploymentVersion: "failed-B", nextDeploymentVersion: "forward-C" };
  for (const invalid of [" ", " padded ", "x".repeat(257)]) {
    await expect(f.t.mutation(recover, { ...request, nextDeploymentVersion: invalid })).rejects.toThrow("ORGANIZATION_INVALID_FORWARD_DEPLOYMENT");
  }
  await f.t.mutation(recover, request);
  const first = await f.t.run(ctx => ctx.db.query("organizationMigrationDispositions").collect());
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ source: "organization-forward-recovery", transition: {
    fromDeploymentVersion: deploymentVersion, pendingDeploymentVersion: "failed-B", nextDeploymentVersion: "forward-C",
  } });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "forward-C");
  await expect(f.t.mutation(recover, { ...request, expectedPendingDeploymentVersion: "forward-C", nextDeploymentVersion: "failed-B" })).rejects.toThrow("ORGANIZATION_FORWARD_RECOVERY_ROLLBACK");
  expect(await f.t.run(ctx => ctx.db.query("organizationMigrationDispositions").collect())).toEqual(first);
  await f.t.mutation(recover, { ...request, expectedPendingDeploymentVersion: "forward-C", nextDeploymentVersion: "forward-D" });
  const all = await f.t.run(ctx => ctx.db.query("organizationMigrationDispositions").collect());
  expect(all).toHaveLength(2); expect(all[0]).toEqual(first[0]);
  expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).receipt).toMatchObject({ phase: "maintenance", legacyRetired: true, recoverySequence: 2, nextDeploymentVersion: "forward-D" });
});

test("email-only admission changes cannot reclassify a mapped customer or turn a pending operator into a customer", async () => {
  const f = fixture(); const alice = await f.user(); const pending = await f.user();
  await f.t.mutation(components.platform.adminEmails.ensure, { email: pending.user.email });
  await f.run(); await f.t.mutation(finalize, {});
  const mappings = await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect());
  expect(mappings.find(row => row.authSubject === alice.user._id)?.disposition).toBe("personal");
  expect(mappings.find(row => row.authSubject === pending.user._id)?.disposition).toBe("app-operator-pending");
  const reservedEmail = "existing-customer-reserved@example.test";
  await f.t.mutation(components.platform.adminEmails.ensure, { email: reservedEmail });
  await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user",
    where: [{ field: "_id", value: alice.user._id }], update: { email: reservedEmail } } });
  await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user",
    where: [{ field: "_id", value: pending.user._id }], update: { email: "no-longer-reserved@example.test" } } });
  expect(await f.t.query(components.platform.adminInvitations.requiresEnrollment, { email: reservedEmail })).toBe(true);
  expect(await f.t.query(components.platform.adminInvitations.requiresEnrollment, { email: "no-longer-reserved@example.test" })).toBe(false);
  await f.t.mutation(makeFunctionReference<"mutation">("organizationMigration:maintenance"), { confirmDeployment: deployment, nextDeploymentVersion: "email-forward-source" });
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "email-forward-source");
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion: "email-forward-source" });
  await f.scan(); await f.t.mutation(finalize, {});
  expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect())).toEqual(mappings);
  expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "personalOwnerId", value: pending.user._id }] })).toBeNull();
  for (const actor of [alice, pending]) {
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: actor.user._id }] })).toMatchObject({ role: "user" });
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "_id", value: actor.account._id }] })).toEqual(actor.account);
  }
});

test("security eligibility is paginated beyond 1000 canonical organizations on both migration passes", async () => {
  const f = fixture();
  f.t.registerComponent("betterAuth", authSchema, {
    ...import.meta.glob("./platform/betterAuth/**/*.*s"),
    // Trusted historical fixture only; no seeding helper is part of deployed source.
    "./platform/betterAuth/migrationScaleFixture.ts": async () => ({
      seed: authMutation({ args: { count: v.number(), offset: v.number() }, handler: async (ctx, args) => {
        for (let i = 0; i < args.count; i++) {
          const label = `scale-${args.offset + i}`;
          const userId = await ctx.db.insert("user", { name: label, email: `${label}@example.test`, role: "user", emailVerified: true, createdAt: 1, updatedAt: 1 });
          const organizationId = await ctx.db.insert("organization", { name: label, slug: label, personalOwnerId: userId,
            experience: "personal", lifecycle: "active", createdAt: 1 });
          await ctx.db.insert("member", { userId, organizationId, role: "org-admin", createdAt: 1 });
        }
      } }),
    }),
  });
  const fixtureApi = components as unknown as { betterAuth: { migrationScaleFixture: {
    seed: FunctionReference<"mutation", "public", { count: number; offset: number }, null>;
  } } };
  for (let offset = 0; offset < 1001; offset += 100) await f.t.mutation(fixtureApi.betterAuth.migrationScaleFixture.seed, { offset, count: Math.min(100, 1001 - offset) });
  await f.t.mutation(begin, { confirmDeployment: deployment, deploymentVersion });
  const policyPages: Record<string, number[]> = { migrate: [], verify: [] };
  let complete = false;
  for (let batch = 0; batch < 200; batch++) {
    const result = await f.t.mutation(step, { batchSize: 100 });
    if (result.stage.endsWith(":canonical-security-policy")) policyPages[result.stage.split(":")[0]].push(result.scanned);
    if (result.complete) { complete = true; break; }
  }
  expect(complete).toBe(true);
  for (const counts of Object.values(policyPages)) {
    expect(counts).toHaveLength(11); expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1001);
    expect(counts.every(count => count <= 100)).toBe(true);
  }
  await f.t.mutation(finalize, {});
  expect((await f.t.run(ctx => readOrganizationReadiness(ctx))).ready).toBe(true);
  expect(await f.t.run(ctx => ctx.db.query("organizationOwnerMappings").collect())).toHaveLength(1001);
}, 30_000);
