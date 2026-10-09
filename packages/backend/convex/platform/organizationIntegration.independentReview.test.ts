import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "../_generated/api";
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
  // Trusted fixture ONLY for integration boundary tests; not live enrollment or migration evidence.
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

describe("independent organization integration review", () => {
  test("a late failed duplicate delivery cannot downgrade a successful current-generation receipt", async () => {
    const f = await fixture();
    const token = "d".repeat(64);
    const invitationId = await f.t.mutation(components.betterAuth.memberInvitations.issue, {
      organizationId: f.org.organizationId, actorId: f.admin.identity._id, email: "delivery@example.test", role: "member", tokenHash: sha256Hex(token), expiresAt: Date.now() + 60_000,
    });
    let sent!: () => void; let failed!: () => void; let started!: () => void;
    const startedBoth = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(sendAuthEmail).mockImplementationOnce(() => new Promise<void>(resolve => { sent = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failed = () => reject(new Error("provider-private-detail")); started(); }));
    const args = { organizationId: f.org.organizationId, invitationId, token, version: 1, attempt: 0 };
    const first = f.t.action(internal.platform.memberInvitationDelivery.send, args);
    const second = f.t.action(internal.platform.memberInvitationDelivery.send, args);
    await startedBoth;
    expect(sendAuthEmail).toHaveBeenCalledTimes(2);
    sent(); await Promise.race([first, second]); failed(); await Promise.all([first, second]);
    const row = await f.t.query(components.betterAuth.adapter.findOne, { model: "invitation", where: [{ field: "_id", value: invitationId }] });
    expect(row).toMatchObject({ deliveryState: "sent" });
    expect(row?.deliveryError).toBeUndefined();
    expect(await f.t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  });

  test("pending admin admission cannot manage and removal immediately retires all public membership authority", async () => {
    const f = await fixture();
    const scope = { organizationId: f.org.organizationId };
    await f.admin.client.mutation(api.platform.memberManagement.change, { ...scope, memberId: f.memberId, operation: "promote" });
    const pending = await f.admin.client.query(api.platform.memberManagement.directory, { ...scope, paginationOpts: { cursor: null, numItems: 10 } });
    expect(pending.page.find(row => row.memberId === f.memberId)).toMatchObject({ adminPending: true, enrolled: false, role: "member" });
    await expect(f.pending.client.action(api.platform.memberInvitations.issue, { ...scope, email: "unauthorized@example.test", role: "member" })).rejects.toThrow("NOT_ORGANIZATION_ADMIN");
    await expect(f.pending.client.query(api.platform.memberManagement.audit, scope)).rejects.toThrow("NOT_ORGANIZATION_ADMIN");
    await f.admin.client.mutation(api.platform.memberManagement.change, { ...scope, memberId: f.memberId, operation: "remove" });
    await expect(f.pending.client.mutation(api.platform.memberManagement.leave, scope)).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    await expect(f.pending.client.query(api.platform.organizationEnrollment.status, scope)).rejects.toThrow();
    await expect(f.pending.client.action(api.platform.organizationEnrollment.verifyCredential, { ...scope, password: "never-accepted" })).rejects.toThrow();
  });

  test("rotated or canceled invitations and claims never cross the account-creation transaction boundary", async () => {
    const f = await fixture();
    const token = "a".repeat(64); const email = "claim@example.test";
    const scope = { organizationId: f.org.organizationId };
    const invitationId = await f.t.mutation(components.betterAuth.memberInvitations.issue, {
      ...scope, actorId: f.admin.identity._id, email, role: "org-admin", tokenHash: sha256Hex(token), expiresAt: Date.now() + 60_000,
    });
    const claim = await f.t.action(api.platform.memberInvitations.claim, { ...scope, token });
    await f.admin.client.action(api.platform.memberInvitations.resend, { ...scope, invitationId });
    await expect(f.t.mutation(internal.platform.memberInvitations.registerAccount, { capabilityHash: sha256Hex(claim.capability), email, name: "Recipient", passwordHash: "never-created" })).rejects.toThrow("INVALID_MEMBER_INVITATION");
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] })).toBeNull();
    await f.admin.client.mutation(api.platform.memberInvitations.cancel, { ...scope, invitationId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sendAuthEmail).not.toHaveBeenCalled();
  });

  test("readiness withdrawal fences member writes, acceptance and queued email before side effects", async () => {
    const f = await fixture();
    const token = "e".repeat(64); const scope = { organizationId: f.org.organizationId };
    const invitationId = await f.t.mutation(components.betterAuth.memberInvitations.issue, {
      ...scope, actorId: f.admin.identity._id, email: "blocked@example.test", role: "member", tokenHash: sha256Hex(token), expiresAt: Date.now() + 60_000,
    });
    await f.t.run(async ctx => { const state = await ctx.db.query("organizationMigrationState").unique(); await ctx.db.patch(state!._id, { phase: "maintenance" }); });
    await expect(f.admin.client.mutation(api.platform.memberManagement.change, { ...scope, memberId: f.memberId, operation: "remove" })).rejects.toThrow("ORGANIZATION_MIGRATION_REQUIRED");
    await expect(f.admin.client.action(api.platform.memberInvitations.resend, { ...scope, invitationId })).rejects.toThrow("ORGANIZATION_MIGRATION_REQUIRED");
    await expect(f.pending.client.mutation(api.platform.memberInvitations.accept, { ...scope, token })).rejects.toThrow("ORGANIZATION_MIGRATION_REQUIRED");
    await f.t.action(internal.platform.memberInvitationDelivery.send, { ...scope, invitationId, token, version: 1, attempt: 0 });
    expect(sendAuthEmail).not.toHaveBeenCalled();
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "member", where: [{ field: "_id", value: f.memberId }] })).not.toBeNull();
  });
});
