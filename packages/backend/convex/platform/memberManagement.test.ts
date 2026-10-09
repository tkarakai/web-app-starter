import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { enrollOrganizationAdminForTest } from "../../test/organizationSecurity";
import { sendAuthEmail } from "./sendAuthEmail";
import { sha256Hex } from "./tokenHash";

vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_CLOUD_URL", "https://membership-test.convex.cloud");
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", "membership-test-source");
  vi.stubEnv("ORGANIZATION_REGISTRY_HASH", "membership-test-registry");
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.mocked(sendAuthEmail).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  // This suite tests management authorization against an explicit readiness fixture.
  // The separate migration suite proves producing this receipt through preserving backfill.
  await t.run(ctx => ctx.db.insert("organizationMigrationState", {
    key: "organization-v1", deployment: "https://membership-test.convex.cloud",
    deploymentVersion: "membership-test-source", registryHash: "membership-test-registry",
    phase: "ready", stage: 0, cursor: null, scanned: 0, startedAt: Date.now(), legacyRetired: true,
  }));
  async function user(role = "user", strong = true) {
    const now = Date.now();
    const identity = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: "Membership fixture", email: `${randomUUID()}@example.test`, role,
      emailVerified: true, twoFactorEnabled: true, createdAt: now, updatedAt: now,
    } } });
    const factor = await t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: {
      userId: identity._id, verified: true, secret: randomUUID(), backupCodes: '["one","two","three"]',
    } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: identity._id, token: randomUUID(), createdAt: now, updatedAt: now, expiresAt: now + 86_400_000,
      assuranceVersion: 1, authPurpose: "application", authMethod: "password", authenticatedAt: now,
      primaryVerifiedAt: now, ...(strong ? { strongVerifiedAt: now, strongFactorId: factor._id, strongFactorType: "totp" } : {}),
    } } });
    return { identity, factor, session, client: t.withIdentity({ subject: identity._id, sessionId: session._id }) };
  }
  const admin = await user();
  const org = await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: admin.identity._id });
  await enrollOrganizationAdminForTest(t, { organizationId: org.organizationId, userId: admin.identity._id });
  const pending = await user();
  const memberId = await t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
    organizationId: org.organizationId, userId: pending.identity._id, role: "member", createdAt: Date.now(),
  } } });
  return { t, admin, org, pending, memberId: memberId._id, user };
}

describe("guarded public organization member management", () => {
  test("requires live elevated assurance, explicit membership and readiness", async () => {
    const f = await fixture();
    const args = { organizationId: f.org.organizationId, paginationOpts: { cursor: null, numItems: 20 } };
    expect((await f.admin.client.query(api.platform.memberManagement.directory, args)).page).toHaveLength(2);
    await expect(f.pending.client.query(api.platform.memberManagement.directory, args)).rejects.toThrow("NOT_ORGANIZATION_ADMIN");
    await expect((await f.user("admin")).client.query(api.platform.memberManagement.directory, args)).rejects.toThrow();
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session",
      where: [{ field: "_id", value: f.admin.session._id }], update: { strongVerifiedAt: 0, strongFactorId: "" },
    } });
    await expect(f.admin.client.query(api.platform.memberManagement.directory, args)).rejects.toThrow("NOT_AUTHENTICATED");
  });

  test("promotion stays pending; last-admin removal rolls back; leave retains identity and private resources", async () => {
    const f = await fixture();
    const context = { organizationId: f.org.organizationId };
    await f.admin.client.mutation(api.platform.memberManagement.change, { ...context, memberId: f.memberId, operation: "promote" });
    const directory = await f.admin.client.query(api.platform.memberManagement.directory, { ...context, paginationOpts: { cursor: null, numItems: 20 } });
    expect(directory.page.find(row => row.memberId === f.memberId)).toMatchObject({ role: "member", adminPending: true, enrolled: false });
    await expect(f.admin.client.mutation(api.platform.memberManagement.leave, context)).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    const project = await f.pending.client.mutation(api.tenantProjects.create, { ...context, name: "Private", description: "Preserved" });
    await f.pending.client.mutation(api.platform.memberManagement.leave, context);
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: f.pending.identity._id }] })).not.toBeNull();
    expect(await f.t.run(ctx => ctx.db.get(project))).toMatchObject({ ownerId: f.pending.identity._id, organizationId: context.organizationId });
    await expect(f.pending.client.query(api.tenantProjects.get, { ...context, id: project })).rejects.toThrow();
  });

  test("only the designated current administrator is an operator contact and tenant audit never contains invitation tokens", async () => {
    const f = await fixture();
    const operator = await f.user("admin");
    const metadata = await f.t.query(components.betterAuth.organizations.contacts,
      { organizationId: f.org.organizationId, operatorId: operator.identity._id });
    expect(metadata.contacts).toEqual([{ name: f.admin.identity.name, email: f.admin.identity.email }]);
    await expect(f.admin.client.mutation(api.platform.memberManagement.setContact,
      { organizationId: f.org.organizationId, memberId: f.memberId })).rejects.toThrow();
    const audit = await f.admin.client.query(api.platform.memberManagement.audit, { organizationId: f.org.organizationId });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(f.admin.factor.secret);
    await expect(operator.client.query(api.platform.memberManagement.audit, { organizationId: f.org.organizationId })).rejects.toThrow();
  });

  test("invitation delivery is observable, rotates on resend, and canceled queued deliveries stay inert", async () => {
    const f = await fixture();
    const context = { organizationId: f.org.organizationId };
    const invitationId = await f.admin.client.action(api.platform.memberInvitations.issue,
      { ...context, email: "recipient@example.test", role: "member" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sendAuthEmail).toHaveBeenCalledOnce();
    const message = vi.mocked(sendAuthEmail).mock.calls[0][0];
    if (message.type !== "custom") throw new Error("EXPECTED_INVITATION_EMAIL");
    const link = message.text.match(/http:\/\/localhost:3000\/[^\s]+/)![0];
    const url = new URL(link);
    expect(url.search).toBe("");
    const token = new URLSearchParams(url.hash.slice(1)).get("token")!;
    expect(await f.t.action(api.platform.memberInvitations.preview, { ...context, token })).toMatchObject({ email: "recipient@example.test" });
    const list = await f.admin.client.query(api.platform.memberInvitations.list, { ...context, paginationOpts: { cursor: null, numItems: 20 } });
    expect(list.page[0]).toMatchObject({ invitationId, deliveryState: "sent" });
    expect(JSON.stringify(list)).not.toContain(token);
    expect(JSON.stringify(list)).not.toContain(sha256Hex(token));
    await f.admin.client.action(api.platform.memberInvitations.resend, { ...context, invitationId });
    await expect(f.t.action(api.platform.memberInvitations.preview, { ...context, token })).rejects.toThrow("INVALID_MEMBER_INVITATION");
    await f.admin.client.mutation(api.platform.memberInvitations.cancel, { ...context, invitationId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sendAuthEmail).toHaveBeenCalledOnce();
  });

  test("delivery retries fail closed after organization disable and expose no provider error details", async () => {
    const f = await fixture();
    vi.mocked(sendAuthEmail).mockRejectedValueOnce(new Error("provider echoed recipient-secret"));
    const context = { organizationId: f.org.organizationId };
    const invitationId = await f.admin.client.action(api.platform.memberInvitations.issue,
      { ...context, email: "retry@example.test", role: "member" });
    vi.advanceTimersByTime(0);
    await f.t.finishInProgressScheduledFunctions();
    const row = await f.t.query(components.betterAuth.adapter.findOne, { model: "invitation", where: [{ field: "_id", value: invitationId }] });
    expect(row).toMatchObject({ deliveryState: "failed", deliveryError: "DELIVERY_FAILED" });
    const operator = await f.user("admin");
    await f.t.mutation(components.betterAuth.organizations.setLifecycle, { ...context, operatorId: operator.identity._id, lifecycle: "disabled" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sendAuthEmail).toHaveBeenCalledOnce();
  });
});
