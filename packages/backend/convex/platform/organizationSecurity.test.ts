import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { hashPassword, symmetricDecrypt, symmetricEncrypt, verifyPassword } from "better-auth/crypto";
import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { sha256Hex } from "./tokenHash";
import { organizationTotp, organizationTotpUri } from "./organizationTotp";
import { ADMIN_SESSION_MS } from "./sessionFields";

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
const nativePassword = "violet compass timber waterfall oyster constellation";
const nativeFactorSecret = "12345678901234567890123456789012";
const nativeKey = "organization-replacement-secret-at-least-32-characters";

async function fixture(admins = 2, native = false) {
  if (native) {
    vi.stubEnv("BETTER_AUTH_SECRET", nativeKey);
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  }
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const users = [];
  const now = Date.now();
  for (let i = 0; i < admins; i++) {
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: "Administrator", email: `${randomUUID()}@example.test`, role: "user", emailVerified: true,
      twoFactorEnabled: true, createdAt: now, updatedAt: now,
    } } });
    const account = await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
      userId: user._id, accountId: user._id, providerId: "credential", password: native ? await hashPassword(nativePassword) : `credential-${i}`, createdAt: now, updatedAt: now,
    } } });
    const factor = await t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: {
      userId: user._id, verified: true, secret: native ? await symmetricEncrypt({ key: nativeKey, data: nativeFactorSecret }) : `secret-${i}`,
      backupCodes: native ? await symmetricEncrypt({ key: nativeKey, data: '["one","two","three"]' }) : '["one","two","three"]',
    } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: user._id, token: randomUUID(), createdAt: now, updatedAt: now, expiresAt: now + 86_400_000,
      assuranceVersion: 1, authPurpose: "application", authMethod: "password", authenticatedAt: now,
      primaryVerifiedAt: now, strongVerifiedAt: now, strongFactorId: factor._id, strongFactorType: "totp",
    } } });
    users.push({ user, account, factor, session });
  }
  const first = users[0];
  const org = await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: first.user._id });
  await t.mutation(components.betterAuth.organizations.beginMembershipManagement, {
    organizationId: org.organizationId, userId: first.user._id, name: "Protected", slug: "protected",
  });
  for (const [index, row] of users.entries()) {
    if (index) {
      const member = await t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
        organizationId: org.organizationId, userId: row.user._id, role: "member", createdAt: now,
      } } });
      await t.mutation(components.betterAuth.organizations.changeMember, {
        organizationId: org.organizationId, actorId: first.user._id, memberId: member._id, operation: "promote",
      });
    }
    const bound = { organizationId: org.organizationId, userId: row.user._id };
    await t.mutation(components.betterAuth.organizations.recordPasswordProof, { ...bound, credentialProof: sha256Hex(row.account.password!) });
    await t.mutation(components.betterAuth.organizations.acknowledgeRecovery, {
      ...bound, factorId: row.factor._id, backupCodesProof: sha256Hex(row.factor.backupCodes),
    });
    await t.mutation(components.betterAuth.organizations.completeEnrollment, { ...bound, requirePasskey: false });
  }
  return { t, users, org };
}

describe("continuing organization administrator security", () => {
  test("two administrators concurrently invalidating their own factor cannot leave zero effective administrators", async () => {
    const { t, users, org } = await fixture();
    const results = await Promise.allSettled(users.map(({ factor }) => t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }], update: { verified: false } },
    })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const contexts = await Promise.all(users.map(({ user }) => t.query(components.betterAuth.organizations.context, {
      organizationId: org.organizationId, userId: user._id,
    })));
    expect(contexts.filter(c => c.canManageMembers)).toHaveLength(1);
  });

  test("a future login needs current admin proof without gaining operator authority", async () => {
    const { t, users } = await fixture(1);
    const { user, session } = users[0];
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session",
      where: [{ field: "_id", value: session._id }], update: { strongVerifiedAt: 0, strongFactorId: "", strongFactorType: "" },
    } });
    const client = t.withIdentity({ subject: user._id, sessionId: session._id });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({
      scope: "user", securityScope: "admin", allowed: false, reason: "mfa_verification",
    });
    await expect(client.mutation(api.platform.adminInvitations.invite, { email: "peer@example.test" })).rejects.toThrow();
  });

  test.each(["credential", "email", "factor-secret", "factor-delete", "recovery-regeneration", "user-ban", "member-delete"])("raw %s write cannot invalidate the sole effective admin", async operation => {
    const { t, users } = await fixture(1);
    const { user, account, factor } = users[0];
    const member = await t.query(components.betterAuth.adapter.findOne, { model: "member", where: [{ field: "userId", value: user._id }] });
    const write = operation === "credential" ? t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "account", where: [{ field: "_id", value: account._id }], update: { password: "unproved-hash" } } })
      : operation === "email" ? t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: user._id }], update: { email: "changed@example.test" } } })
      : operation === "factor-secret" ? t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }], update: { secret: "unproved-secret" } } })
      : operation === "factor-delete" ? t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }] } })
      : operation === "recovery-regeneration" ? t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }], update: { backupCodes: '["unacknowledged"]' } } })
      : operation === "member-delete" ? t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "member", where: [{ field: "_id", value: member!._id }] } })
      : t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: user._id }], update: { banned: true } } });
    await expect(write).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "_id", value: account._id }] })).toMatchObject({ password: account.password });
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: factor._id }] })).toMatchObject({ secret: factor.secret, verified: true });
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: user._id }] })).toMatchObject({ email: user.email });
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "member", where: [{ field: "_id", value: member!._id }] })).not.toBeNull();
  });

  test("bulk writes roll back all affected admins, including bulk deletion", async () => {
    const { t, users, org } = await fixture();
    await expect(t.mutation(components.betterAuth.adapter.updateMany, { input: { model: "twoFactor", update: { verified: false } }, paginationOpts: { cursor: null, numItems: 100 } })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    await expect(t.mutation(components.betterAuth.adapter.deleteMany, { input: { model: "account" }, paginationOpts: { cursor: null, numItems: 100 } })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    for (const { user } of users) expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ canManageMembers: true });
  });

  test("policy strengthening and last required passkey deletion share the invariant and rollback", async () => {
    const { t, users, org } = await fixture(1);
    await expect(t.mutation(components.platform.appSettings.putRaw, { key: "adminPasskeyPolicy", value: "required" })).rejects.toThrow("USE_CANONICAL_ORGANIZATION_POLICY");
    await expect(t.mutation(components.platform.appSettings.set, { key: "adminPasskeyPolicy", value: "required", userId: "operator" })).rejects.toThrow("USE_CANONICAL_ORGANIZATION_POLICY");
    await expect(t.mutation(components.platform.appSettings.remove, { key: "adminPasskeyPolicy" })).rejects.toThrow("USE_CANONICAL_ORGANIZATION_POLICY");
    await expect(t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: "required" })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    expect(await t.query(components.betterAuth.organizationSecurity.policy, {})).toBeNull();
    expect(await t.query(components.platform.appSettings.getRaw, { key: "adminPasskeyPolicy" })).toBeNull();
    const passkey = await t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: users[0].user._id, credentialID: "required-key", publicKey: "key", counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    await t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: "required" });
    await expect(t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "passkey", where: [{ field: "_id", value: passkey._id }] } })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    const client = t.withIdentity({ subject: users[0].user._id, sessionId: users[0].session._id });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "user", securityScope: "admin", allowed: false, reason: "passkey_verification" });
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: users[0].user._id })).toMatchObject({ canManageMembers: true });
  });

  test("disabled organizations release global policy but cannot reactivate without an effective admin", async () => {
    const { t, users, org } = await fixture(1);
    const user = users[0];
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "organization", where: [{ field: "_id", value: org.organizationId }], update: { lifecycle: "disabled" } } });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: user.factor._id }], update: { verified: false } } });
    const client = t.withIdentity({ subject: user.user._id, sessionId: user.session._id });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "user", securityScope: "user" });
    await expect(t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "organization", where: [{ field: "_id", value: org.organizationId }], update: { lifecycle: "active" } } })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
  });

  test("RFC TOTP vectors and URI match the existing Better Auth factor format", async () => {
    expect(await organizationTotp("12345678901234567890", 59_000)).toBe("287082");
    expect(await organizationTotp("12345678901234567890", 1_111_111_109_000)).toBe("081804");
    expect(new URL(organizationTotpUri("12345678901234567890", "Example", "user@example.test")).searchParams.get("secret")).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  test("lost-factor recovery stages a replacement without invalidating the sole admin and commits only verified new proof", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "organization-replacement-secret-at-least-32-characters");
    const { t, users, org } = await fixture(1);
    const { user, session, account, factor } = users[0];
    const password = "violet compass timber waterfall oyster constellation";
    const passwordHash = await hashPassword(password);
    await t.mutation(components.betterAuth.organizationSecurity.replaceCredential, { userId: user._id, currentHash: account.password!, newHash: passwordHash, adminPasswordValidated: true });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: {
      primaryVerifiedAt: Date.now(), recoveryOnly: true, recoverySourceFactorId: factor._id, recoverySourceFactorProof: sha256Hex(factor.secret),
    } } });
    const client = t.withIdentity({ subject: user._id, sessionId: session._id });
    const replacement = await client.action(api.platform.organizationFactorReplacement.begin, { password });
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: factor._id }] })).toMatchObject({ secret: factor.secret, verified: true });
    const stage = await t.query(components.betterAuth.organizationSecurity.stagedFactor, { userId: user._id, sessionId: session._id, changeId: replacement.changeId });
    const plaintext = await symmetricDecrypt({ key: process.env.BETTER_AUTH_SECRET!, data: stage.secret });
    const code = await organizationTotp(plaintext, Date.now());
    await expect(client.action(api.platform.organizationFactorReplacement.complete, { changeId: replacement.changeId, code: "bad", backupCodes: replacement.backupCodes.slice(0, 2) })).rejects.toThrow("INVALID_TOTP");
    await expect(client.action(api.platform.organizationFactorReplacement.complete, { changeId: replacement.changeId, code, backupCodes: [replacement.backupCodes[0], replacement.backupCodes[0]] })).rejects.toThrow("INVALID_RECOVERY_CODES");
    await client.action(api.platform.organizationFactorReplacement.complete, { changeId: replacement.changeId, code, backupCodes: replacement.backupCodes.slice(0, 2) });
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ canManageMembers: true });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "user", securityScope: "admin", allowed: true });
    await expect(client.action(api.platform.organizationFactorReplacement.complete, { changeId: replacement.changeId, code, backupCodes: replacement.backupCodes.slice(0, 2) })).rejects.toThrow("SECURITY_STATE_CHANGED");
  });

  test("native password change and email reset preserve sole-admin eligibility and revoke old proof", async () => {
    const { t, users, org } = await fixture(1, true);
    const { user, session } = users[0];
    const nextPassword = "violet lantern maple glacier musical constellation";
    const request = (path: string, body: unknown, authenticated = true) => t.fetch(`/api/auth${path}`, { method: "POST", headers: {
      origin: "http://localhost:3000", "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${session.token}` } : {}),
    }, body: JSON.stringify(body) });
    const changed = await request("/change-password", { currentPassword: nativePassword, newPassword: nextPassword, revokeOtherSessions: false });
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ canManageMembers: true });
    const account = await t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "userId", value: user._id }] });
    expect(await verifyPassword({ password: nextPassword, hash: account!.password! })).toBe(true);
    const token = randomUUID();
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "verification", data: {
      identifier: `reset-password:${token}`, value: user._id, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 60_000,
    } } });
    const reset = await request("/reset-password", { token, newPassword: nativePassword }, false);
    expect(reset.status, await reset.clone().text()).toBe(200);
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ canManageMembers: true });
    const current = await t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "_id", value: session._id }] });
    expect(current === null || current.primaryVerifiedAt === 0).toBe(true);
    const replay = await request("/reset-password", { token, newPassword: nextPassword }, false);
    expect(replay.status).not.toBe(200);
  });

  test("native backup-code consumption preserves acknowledged recovery and binds limited recovery to the original factor", async () => {
    const { t, users, org } = await fixture(1, true);
    const { user, session, factor } = users[0];
    const response = await t.fetch("/api/auth/two-factor/verify-backup-code", { method: "POST", headers: {
      origin: "http://localhost:3000", "content-type": "application/json", authorization: `Bearer ${session.token}`,
    }, body: JSON.stringify({ code: "one" }) });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ canManageMembers: true });
    const sessions = await t.query(components.betterAuth.adapter.findMany, { model: "session", where: [{ field: "userId", value: user._id }], paginationOpts: { cursor: null, numItems: 100 } });
    const recovered = sessions.page.find(row => row.recoveryOnly)!;
    expect(recovered).toMatchObject({ recoverySourceFactorId: factor._id, recoverySourceFactorProof: sha256Hex(factor.secret), strongVerifiedAt: 0 });
    const client = t.withIdentity({ subject: user._id, sessionId: recovered._id });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: false, reason: "recovery", scope: "user" });
    expect(await client.action(api.platform.organizationFactorReplacement.begin, { password: nativePassword })).toHaveProperty("changeId");
  });

  test.each([false, true])("member removal and another administrator losing proof serialize safely (reverse=%s)", async reverse => {
    const { t, users, org } = await fixture();
    const remove = () => t.mutation(components.betterAuth.organizations.leave, { organizationId: org.organizationId, userId: users[0].user._id });
    const invalidate = () => t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: users[1].factor._id }], update: { verified: false } } });
    const results = await Promise.allSettled((reverse ? [invalidate, remove] : [remove, invalidate]).map(run => run()));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  });

  test.each([false, true])("policy change and required-factor removal serialize safely (reverse=%s)", async reverse => {
    const { t, users, org } = await fixture(1);
    const key = await t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: users[0].user._id, credentialID: "racing-key", publicKey: "key", counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    const strengthen = () => t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: "required" });
    const remove = () => t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "passkey", where: [{ field: "_id", value: key._id }] } });
    const results = await Promise.allSettled((reverse ? [remove, strengthen] : [strengthen, remove]).map(run => run()));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: users[0].user._id })).toMatchObject({ canManageMembers: true });
  });

  test("org-admin four-hour clock, magic-link denial and operator isolation remain independent", async () => {
    const { t, users } = await fixture(1);
    const { user, session } = users[0];
    const client = t.withIdentity({ subject: user._id, sessionId: session._id });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "user", securityScope: "admin", allowed: true });
    await expect(client.mutation(api.platform.adminInvitations.invite, { email: "forbidden@example.test" })).rejects.toThrow("NOT_ADMIN");
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: { authenticatedAt: Date.now() - ADMIN_SESSION_MS } } });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: false, reason: "reauthenticate" });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: { authenticatedAt: Date.now(), authMethod: "magic-link" } } });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: false, reason: "method_disabled" });
  });

  test("recovery-only marker without the exact consumed-factor proof cannot authorize replacement", async () => {
    const { t, users } = await fixture(1, true);
    const { user, session, factor } = users[0];
    const client = t.withIdentity({ subject: user._id, sessionId: session._id });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: { recoveryOnly: true, strongVerifiedAt: 0 } } });
    await expect(client.action(api.platform.organizationFactorReplacement.begin, { password: nativePassword })).rejects.toThrow("RECOVERY_REQUIRED");
    await expect(t.mutation(internal.platform.sessionAssurance.recordProof, { userId: user._id, sessionId: session._id, kind: "recovery", factorId: factor._id, factorSecret: "wrong" })).rejects.toThrow("RECOVERY_REQUIRED");
  });

  test.each(["credential", "session", "factor"])("staged factor replacement rejects a racing %s change", async race => {
    const { t, users, org } = await fixture(2, true);
    const { user, session, account, factor } = users[0];
    const client = t.withIdentity({ subject: user._id, sessionId: session._id });
    const replacement = await client.action(api.platform.organizationFactorReplacement.begin, { password: nativePassword });
    const stage = await t.query(components.betterAuth.organizationSecurity.stagedFactor, { userId: user._id, sessionId: session._id, changeId: replacement.changeId });
    const plaintext = await symmetricDecrypt({ key: nativeKey, data: stage.secret });
    if (race === "credential") await t.mutation(components.betterAuth.organizationSecurity.replaceCredential, { userId: user._id, currentHash: account.password!, newHash: "changed", adminPasswordValidated: true });
    if (race === "session") await t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: session._id }] } });
    if (race === "factor") await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }], update: { secret: "changed" } } });
    await expect(client.action(api.platform.organizationFactorReplacement.complete, { changeId: replacement.changeId, code: await organizationTotp(plaintext, Date.now()), backupCodes: replacement.backupCodes.slice(0, 2) })).rejects.toThrow();
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: users[1].user._id })).toMatchObject({ canManageMembers: true });
    const currentFactor = await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: factor._id }] });
    expect(currentFactor!.secret).not.toBe(stage.secret);
  });

  test("maintenance closes mapping writers while allowing login and existing security proof", async () => {
    const { t, users, org } = await fixture(1);
    const { user, session } = users[0];
    await t.mutation(components.betterAuth.organizationMigrationBarrier.set, { blocked: true, deploymentVersion: "test-version" });
    await expect(t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: user._id }], update: { userId: "remapped-owner" } } })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
    await expect(t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: "New", email: "new@example.test", emailVerified: true, createdAt: Date.now(), updatedAt: Date.now() } } })).rejects.toThrow("ORGANIZATION_MAINTENANCE");
    expect(await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: user._id })).toMatchObject({ organizationId: org.organizationId });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: { primaryVerifiedAt: Date.now() } } });
    expect(await t.withIdentity({ subject: user._id, sessionId: session._id }).query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: true });
  });
});
