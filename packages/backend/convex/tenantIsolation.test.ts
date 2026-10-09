import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api, components, internal } from "./_generated/api";
import { createTestEnv } from "./test.modules";
import authSchema from "./platform/betterAuth/schema";
import { enrollOrganizationAdminForTest } from "../test/organizationSecurity";
import { completeOrganizationMigration } from "../test/organizationReadiness";

async function fixture(options: { beforeCutover?: boolean } = {}) {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./platform/betterAuth/**/*.*s"));
  if (!options.beforeCutover) await completeOrganizationMigration(t);
  async function user(role = "user") {
    const now = Date.now();
    return t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: "Isolation fixture", email: `${randomUUID()}@example.test`, role, emailVerified: true, createdAt: now, updatedAt: now,
    } } });
  }
  async function client(userId: string, purpose = "application") {
    const now = Date.now();
    const factor = await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: userId }] });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId, token: randomUUID(), authPurpose: purpose, expiresAt: now + 86_400_000, createdAt: now, updatedAt: now,
      assuranceVersion: 1, authMethod: "password", primaryVerifiedAt: now, authenticatedAt: now,
      ...(factor?.verified ? { strongVerifiedAt: now, strongFactorId: factor._id, strongFactorType: "totp" } : {}),
    } } });
    return { client: t.withIdentity({ subject: userId, sessionId: session._id }), session };
  }
  const alice = await user(); const bob = await user(); const outsider = await user(); const operator = await user("admin");
  const a = await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: alice._id });
  const b = await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: bob._id });
  await t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: {
    userId: bob._id, secret: "isolation-factor", backupCodes: "isolation-codes", verified: true,
  } } });
  await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: bob._id }], update: { twoFactorEnabled: true } } });
  await enrollOrganizationAdminForTest(t, { organizationId: b.organizationId, userId: bob._id });
  await t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: { organizationId: b.organizationId, userId: alice._id, role: "member", createdAt: Date.now() } } });
  const aliceAuth = await client(alice._id); const bobAuth = await client(bob._id);
  const aliceClient = aliceAuth.client; const bobClient = bobAuth.client;
  // Pre-cutover cases retain historical tagged rows; no strict public writer is
  // usable before a verified receipt. Normal fixtures use the real public API.
  const create = (client: typeof aliceClient, ownerId: string, organizationId: string, name: string) => options.beforeCutover
    ? t.run(ctx => ctx.db.insert("projects", { organizationId, ownerId, name, description: "Private", createdAt: Date.now() }))
    : client.mutation(api.tenantProjects.create, { organizationId, name, description: "Private" });
  const aProject = await create(aliceClient, alice._id, a.organizationId, "A private");
  const bProject = await create(aliceClient, alice._id, b.organizationId, "B private");
  const bobProject = await create(bobClient, bob._id, b.organizationId, "Bob private");
  return { t, user, client, alice, bob, outsider, operator, a, b, aliceAuth, aliceClient, bobClient, aProject, bProject, bobProject };
}

describe("explicit tenant context and private resource isolation", () => {
  test("reactive reads deny without throwing during assurance loss and resume after verified proof", async () => {
    const f = await fixture();
    const args = { organizationId: f.a.organizationId };
    const task = await f.aliceClient.mutation(api.tenantTasks.create, { ...args, projectId: f.aProject, title: "Retained task", description: "Private", status: "todo" });
    const reads = () => Promise.all([
      f.aliceClient.query(api.platform.tenantContext.mine, {}),
      f.aliceClient.query(api.platform.tenantContext.get, args),
      f.aliceClient.query(api.tenantProjects.list, args),
      f.aliceClient.query(api.tenantProjects.listWithStats, args),
      f.aliceClient.query(api.tenantProjects.get, { ...args, id: f.aProject }),
      f.aliceClient.query(api.tenantTasks.listByProject, { ...args, projectId: f.aProject }),
      f.aliceClient.query(api.tenantFiles.listUploads, { ...args, projectId: f.aProject }),
    ]);
    const before = await reads();
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: f.aliceAuth.session._id }], update: { primaryVerifiedAt: 0 } } });
    expect(await reads()).toEqual(Array(7).fill(null));
    expect(await f.t.query(api.platform.tenantContext.mine, {})).toBeNull();
    expect(await f.t.query(api.tenantProjects.list, args)).toBeNull();
    await expect(f.aliceClient.mutation(api.tenantProjects.update, { ...args, id: f.aProject, name: "Denied" })).rejects.toThrow("NOT_AUTHENTICATED");
    await expect(f.aliceClient.mutation(api.tenantTasks.update, { ...args, id: task, status: "done" })).rejects.toThrow("NOT_AUTHENTICATED");
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: f.aliceAuth.session._id }], update: { primaryVerifiedAt: Date.now() } } });
    expect(await reads()).toEqual(before);
  });

  test("shared identity has differing roles and only sees owned resources in the explicit organization", async () => {
    const f = await fixture();
    const contexts = await f.aliceClient.query(api.platform.tenantContext.mine, {});
    expect(contexts!.personalOrganizationId).toBe(f.a.organizationId);
    expect(contexts!.contexts).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId: f.a.organizationId, role: "org-admin" }),
      expect.objectContaining({ organizationId: f.b.organizationId, role: "member" }),
    ]));
    expect((await f.aliceClient.query(api.tenantProjects.list, { organizationId: f.a.organizationId }))!.map(row => row._id)).toEqual([f.aProject]);
    expect((await f.aliceClient.query(api.tenantProjects.list, { organizationId: f.b.organizationId }))!.map(row => row._id)).toEqual([f.bProject]);
    expect(await f.aliceClient.query(api.tenantProjects.get, { organizationId: f.b.organizationId, id: f.aProject })).toBeNull();
    expect(await f.bobClient.query(api.tenantProjects.get, { organizationId: f.b.organizationId, id: f.bProject })).toBeNull();
    await expect(f.aliceClient.mutation(api.tenantProjects.update, { organizationId: f.b.organizationId, id: f.bobProject, name: "Cannot take over" })).rejects.toThrow("PROJECT_NOT_FOUND");
  });

  test("missing, empty and unauthorized context cannot create resources or fall back to session preference", async () => {
    const f = await fixture();
    const before = await f.t.run(ctx => ctx.db.query("projects").collect());
    await expect(f.aliceClient.mutation(api.tenantProjects.create, { organizationId: "", name: "No", description: "No" })).rejects.toThrow("EXPLICIT_ORGANIZATION_CONTEXT_REQUIRED");
    // Runtime argument validation is part of the public contract, not just TypeScript callers.
    await expect(f.aliceClient.mutation(api.tenantProjects.create, { name: "No", description: "No" } as never)).rejects.toThrow();
    const outsider = (await f.client(f.outsider._id)).client;
    await expect(outsider.query(api.tenantProjects.list, { organizationId: f.a.organizationId })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    expect(await f.t.run(ctx => ctx.db.query("projects").collect())).toEqual(before);
  });

  test("changing activeOrganizationId in another tab never redirects a captured write", async () => {
    const f = await fixture();
    const prepared = { organizationId: f.a.organizationId, name: "Tab A", description: "Captured A" };
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: f.aliceAuth.session._id }], update: { activeOrganizationId: f.b.organizationId } } });
    const id = await f.aliceClient.mutation(api.tenantProjects.create, prepared);
    expect(await f.t.run(ctx => ctx.db.get(id))).toMatchObject({ organizationId: f.a.organizationId, ownerId: f.alice._id });
  });

  test("removal, suspension and reactivation recheck live membership/lifecycle without changing identity or resources", async () => {
    const f = await fixture();
    await f.t.mutation(components.betterAuth.organizations.setLifecycle, { organizationId: f.a.organizationId, operatorId: f.operator._id, lifecycle: "disabled" });
    await expect(f.aliceClient.query(api.tenantProjects.get, { organizationId: f.a.organizationId, id: f.aProject })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    expect(await f.aliceClient.query(api.tenantProjects.get, { organizationId: f.b.organizationId, id: f.bProject })).toMatchObject({ _id: f.bProject });
    expect(await f.aliceClient.query(api.platform.auth.getCurrentUser, {})).not.toBeNull();
    await f.t.mutation(components.betterAuth.organizations.setLifecycle, { organizationId: f.a.organizationId, operatorId: f.operator._id, lifecycle: "active" });
    expect(await f.aliceClient.query(api.tenantProjects.get, { organizationId: f.a.organizationId, id: f.aProject })).toMatchObject({ _id: f.aProject });
    await f.t.mutation(components.betterAuth.organizations.leave, { organizationId: f.b.organizationId, userId: f.alice._id });
    await expect(f.aliceClient.mutation(api.tenantProjects.update, { organizationId: f.b.organizationId, id: f.bProject, name: "Removed" })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    expect(await f.t.run(ctx => ctx.db.get(f.bProject))).toMatchObject({ name: "B private", ownerId: f.alice._id });
  });

  test("operator and auth-only sessions cannot use tenant APIs", async () => {
    const f = await fixture();
    const operator = (await f.client(f.operator._id)).client;
    await expect(operator.query(api.tenantProjects.list, { organizationId: f.a.organizationId })).rejects.toThrow("NOT_CUSTOMER");
    const authorizationOnly = (await f.client(f.alice._id, "mcp-authorization")).client;
    expect(await authorizationOnly.query(api.platform.tenantContext.mine, {})).toBeNull();
  });

  test("task parent/context/ownership and malformed cross-tenant child references fail closed", async () => {
    const f = await fixture();
    const task = await f.aliceClient.mutation(api.tenantTasks.create, { organizationId: f.a.organizationId, projectId: f.aProject, title: "Task A", description: "Private", status: "todo" });
    await expect(f.aliceClient.mutation(api.tenantTasks.update, { organizationId: f.b.organizationId, id: task, status: "done" })).rejects.toThrow("PROJECT_NOT_FOUND");
    await f.t.run(ctx => ctx.db.patch(task, { organizationId: f.b.organizationId }));
    await expect(f.aliceClient.query(api.tenantTasks.listByProject, { organizationId: f.a.organizationId, projectId: f.aProject })).rejects.toThrow("RESOURCE_CONTEXT_MISMATCH");
    await expect(f.aliceClient.mutation(api.tenantProjects.remove, { organizationId: f.a.organizationId, id: f.aProject })).rejects.toThrow("RESOURCE_CONTEXT_MISMATCH");
    expect(await f.t.run(ctx => ctx.db.get(f.aProject))).not.toBeNull();
  });

  test("unmapped legacy data never becomes tenant data by fallback; legacy personal access is preserved", async () => {
    const f = await fixture({ beforeCutover: true });
    const legacyUser = await f.user(); const legacy = (await f.client(legacyUser._id)).client;
    const id = await legacy.mutation(api.projects.create, { name: "Legacy", description: "Preserve" });
    expect(await legacy.query(api.projects.get, { id })).toMatchObject({ ownerId: legacyUser._id });
    const mapping = await legacy.query(api.platform.tenantContext.mine, {});
    expect(mapping).toMatchObject({ mappingRequired: true, personalOrganizationId: null });
    await expect(f.aliceClient.query(api.projects.list, {})).rejects.toThrow("EXPLICIT_ORGANIZATION_CONTEXT_REQUIRED");
    const ownedLegacy = await f.t.run(ctx => ctx.db.insert("projects", { name: "Old Alice", description: "Preserve", ownerId: f.alice._id, createdAt: Date.now() }));
    await expect(f.aliceClient.query(api.tenantProjects.get, { organizationId: f.a.organizationId, id: ownedLegacy })).rejects.toThrow("ORGANIZATION_MIGRATION_REQUIRED");
    const preserved = await f.t.run(ctx => ctx.db.get(ownedLegacy));
    expect(preserved).toMatchObject({ name: "Old Alice" });
    expect(preserved?.organizationId).toBeUndefined();
  });

  test("explicit personal legacy bridge binds the captured ID without assigning scope to historical rows", async () => {
    const f = await fixture({ beforeCutover: true });
    const user = await f.user();
    const personal = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: user._id });
    const client = (await f.client(user._id)).client;
    const id = await client.mutation(api.projects.create, { organizationId: personal.organizationId, name: "Preserved private", description: "No backfill" });
    expect(await client.query(api.platform.tenantContext.mine, {})).toMatchObject({ legacyPrivateAvailable: true, personalOrganizationId: personal.organizationId });
    expect(await client.query(api.projects.get, { organizationId: personal.organizationId, id })).toMatchObject({ _id: id });
    await expect(client.query(api.projects.list, { organizationId: f.a.organizationId })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    await expect(client.query(api.tenantProjects.get, { organizationId: personal.organizationId, id })).rejects.toThrow("ORGANIZATION_MIGRATION_REQUIRED");
    expect((await f.t.run(ctx => ctx.db.get(id)))?.organizationId).toBeUndefined();
    await expect(client.mutation(api.tenantProjects.create, { organizationId: personal.organizationId, name: "Too early", description: "Denied" })).rejects.toThrow("ORGANIZATION_MIGRATION_REQUIRED");
    await completeOrganizationMigration(f.t);
    const scoped = await client.mutation(api.tenantProjects.create, { organizationId: personal.organizationId, name: "New scoped", description: "Explicit" });
    await expect(client.query(api.projects.get, { organizationId: personal.organizationId, id: scoped })).rejects.toThrow("ORGANIZATION_LEGACY_RETIRED");
    expect((await client.query(api.tenantProjects.listWithStats, { organizationId: personal.organizationId }))!.map(row => row._id)).toEqual(expect.arrayContaining([scoped, id]));
    expect(await f.aliceClient.query(api.platform.tenantContext.mine, {})).toMatchObject({ legacyPrivateAvailable: false });
  });

  test("pending customer-admission/member-invitation signup cannot use legacy-private APIs as a provisioning bypass", async () => {
    const f = await fixture({ beforeCutover: true });
    const pending = await f.user();
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: pending._id }], update: { customerAdmission: "public-signup" } } });
    const pendingClient = (await f.client(pending._id)).client;
    await expect(pendingClient.mutation(api.projects.create, { name: "Bypass", description: "No" })).rejects.toThrow("CUSTOMER_PROVISIONING_REQUIRED");
    const invite = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "invitation", data: { organizationId: f.b.organizationId,
      inviterId: f.bob._id, email: f.outsider.email, role: "member", status: "pending", expiresAt: Date.now() + 60_000, createdAt: Date.now() } } });
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "organizationInvitationClaims", data: { invitationId: invite._id,
      invitationTokenHash: "a".repeat(64), capabilityHash: "b".repeat(64), userId: f.outsider._id, expiresAt: Date.now() + 60_000, createdAt: Date.now() } } });
    const memberClient = (await f.client(f.outsider._id)).client;
    await expect(memberClient.mutation(api.projects.create, { name: "Bypass", description: "No" })).rejects.toThrow("INVITATION_ACCEPTANCE_REQUIRED");
    expect(await f.t.run(ctx => ctx.db.query("projects").withIndex("by_owner", q => q.eq("ownerId", f.outsider._id)).collect())).toHaveLength(0);
  });

  test("file upload/download bind organization and parent; internal finalization rechecks suspension", async () => {
    const f = await fixture();
    const args = { organizationId: f.a.organizationId, projectId: f.aProject, name: "private.txt", contentType: "text/plain", bytes: new globalThis.TextEncoder().encode("tenant A").buffer };
    const id = await f.aliceClient.action(api.tenantFiles.uploadFile, args);
    expect(await f.aliceClient.action(api.tenantFiles.downloadFile, { organizationId: f.a.organizationId, id })).toMatchObject({ name: "private.txt" });
    await expect(f.aliceClient.action(api.tenantFiles.downloadFile, { organizationId: f.b.organizationId, id })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(f.aliceClient.action(api.tenantFiles.uploadFile, { ...args, organizationId: f.b.organizationId })).rejects.toThrow("PROJECT_NOT_FOUND");
    const storageId = await f.t.run(ctx => ctx.storage.store(new Blob(["delayed"], { type: "text/plain" })));
    await f.t.mutation(components.betterAuth.organizations.setLifecycle, { organizationId: f.a.organizationId, operatorId: f.operator._id, lifecycle: "disabled" });
    await expect(f.aliceClient.mutation(internal.tenantFiles.finishUpload, { organizationId: f.a.organizationId, projectId: f.aProject, storageId,
      name: "delayed.txt", contentType: "text/plain", size: 7, ownerId: f.alice._id })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    expect(await f.t.run(ctx => ctx.db.query("uploads").withIndex("by_storage", q => q.eq("storageId", storageId)).collect())).toHaveLength(0);
  });
});
