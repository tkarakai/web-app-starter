import { ORG_ADMIN_MEMBERSHIP_ROLE, ORG_MEMBER_ROLE } from "./betterAuth/organizationVocabulary";
import { createHmac, randomUUID } from "node:crypto";
import * as crypto from "better-auth/crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { ADMIN_SESSION_MS, RECENT_AUTH_MS } from "./sessionFields";
import { enrollOrganizationAdminForTest } from "../../test/organizationSecurity";

vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
vi.mock("better-auth/crypto", async importOriginal => {
  const actual = await importOriginal<typeof crypto>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});
const actualCrypto = await vi.importActual<typeof crypto>("better-auth/crypto");
const password = "violet compass timber waterfall oyster constellation";
const secret = "organization-enrollment-fixture-secret-at-least-32-characters";
let passwordHash: string;
beforeAll(async () => { passwordHash = await crypto.hashPassword(password); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("")));
});
afterEach(() => { vi.mocked(crypto.verifyPassword).mockReset(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function totp(uri: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = Array.from(new URL(uri).searchParams.get("secret")!, c => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  return String((hash.readUInt32BE(hash[hash.length - 1] & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function fixture(role = "user") {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const now = Date.now();
  const email = `${randomUUID()}@example.test`;
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
    name: "Enrollment user", email, role, emailVerified: true, createdAt: now, updatedAt: now,
  } } });
  const account = await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
    userId: user._id, accountId: user._id, providerId: "credential", password: passwordHash, createdAt: now, updatedAt: now,
  } } });
  const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
    token: randomUUID(), userId: user._id, createdAt: now, updatedAt: now, expiresAt: now + 7 * 24 * 60 * 60_000,
    authPurpose: "application", assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
  } } });
  const client = t.withIdentity({ subject: user._id, sessionId: session._id });
  const org = role === "user" ? await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: user._id }) : null;
  const context = { organizationId: org?.organizationId ?? "invalid-org" };
  const bound = { ...context, userId: user._id, sessionId: session._id };
  const begin = () => client.mutation(api.platform.organizationEnrollment.begin, { ...context, name: "Organization", slug: "organization-setup" });
  const status = () => client.query(api.platform.organizationEnrollment.status, context);
  const setting = async (key: string, value: unknown) => key === "adminPasskeyPolicy"
    ? t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key, value: JSON.stringify(value) })
    : t.mutation(components.platform.appSettings.putRaw, { key, value: JSON.stringify(value) });
  async function update(model: "user" | "session" | "account" | "twoFactor", id: string, data: Record<string, string | number | boolean>) {
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model, where: [{ field: "_id", value: id }], update: data } });
  }
  async function security() {
    await update("user", user._id, { twoFactorEnabled: true });
    const codes = ["one-code", "second-code", "third-code"];
    const factor = await t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: {
      userId: user._id, verified: true, secret: "fixture-encrypted-factor", backupCodes: await crypto.symmetricEncrypt({ key: secret, data: JSON.stringify(codes) }),
    } } });
    await update("session", session._id, { strongFactorType: "totp", strongFactorId: factor._id, strongVerifiedAt: Date.now() });
    return { factor, codes };
  }
  return { t, client, user, account, session, context, bound, begin, status, update, setting, security };
}

describe("parent organization enrollment and scoped assurance", () => {
  test("pending setup preserves personal organization, ordinary access and global user role", async () => {
    const f = await fixture();
    const projectId = await f.t.run(ctx => ctx.db.insert("projects", { name: "Existing personal data", description: "Preserve this row unchanged", ownerId: f.user._id, createdAt: Date.now() }));
    const before = await f.t.run(ctx => ctx.db.get(projectId));
    expect(await f.begin()).toBe(await f.begin());
    expect(await f.status()).toMatchObject({ scope: "user", securityScope: "admin", emailRequired: true,
      mfaRequired: true, reason: "mfa_enrollment", setup: { completed: false, passwordVerified: false, backupAcknowledged: false } });
    expect(await f.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "user", securityScope: "user", allowed: true });
    await f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...f.context, password });
    expect(await f.status()).toMatchObject({ setup: { passwordVerified: true } });
    expect(await f.t.query(components.betterAuth.organizations.context, { ...f.context, userId: f.user._id })).toMatchObject({ experience: "personal", role: ORG_ADMIN_MEMBERSHIP_ROLE, canManageMembers: false });
    await expect(f.client.mutation(api.platform.adminInvitations.invite, { email: "peer@example.test" })).rejects.toThrow("NOT_ADMIN");
    expect(await f.t.run(ctx => ctx.db.get(projectId))).toEqual(before);
  });

  test("real TOTP HTTP ceremony and two-code acknowledgment record exact proof but cannot enable organization membership management", async () => {
    const f = await fixture();
    await f.begin();
    await f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...f.context, password });
    const request = (path: string, body: unknown) => f.t.fetch(`/api/auth${path}`, { method: "POST", headers: {
      origin: "http://localhost:3000", "content-type": "application/json", authorization: `Bearer ${f.session.token}`,
    }, body: JSON.stringify(body) });
    const enabled = await request("/two-factor/enable", { password });
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    const setup = await enabled.json();
    const verified = await request("/two-factor/verify-totp", { code: totp(setup.totpURI) });
    expect(verified.status, await verified.clone().text()).toBe(200);
    const sessions = await f.t.query(components.betterAuth.adapter.findMany, { model: "session", where: [{ field: "userId", value: f.user._id }], paginationOpts: { cursor: null, numItems: 10 } });
    const current = sessions.page.find(s => s.strongFactorType === "totp")!;
    expect(current).toBeDefined();
    const client = f.t.withIdentity({ subject: f.user._id, sessionId: current._id });
    await client.action(api.platform.organizationEnrollment.acknowledgeRecovery, { ...f.context, password, codes: setup.backupCodes.slice(0, 2) });
    expect(await client.query(api.platform.organizationEnrollment.status, f.context)).toMatchObject({ scope: "user", securityScope: "admin", allowed: true,
      setup: { passwordVerified: true, backupAcknowledged: true, completed: false } });
    expect(await f.t.query(components.betterAuth.organizations.context, { ...f.context, userId: f.user._id })).toMatchObject({ experience: "personal", canManageMembers: false });
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: f.user._id }] })).toMatchObject({ role: "user" });
  });

  test("credential acknowledgment enforces admin password strength, not merely a valid user password", async () => {
    const f = await fixture();
    await f.begin();
    const ordinaryPassword = "correct horse battery staple";
    await f.update("account", f.account._id, { password: await crypto.hashPassword(ordinaryPassword) });
    await expect(f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...f.context, password: ordinaryPassword })).rejects.toThrow("REAUTHENTICATION_REQUIRED");
    expect(await f.status()).toMatchObject({ setup: { passwordVerified: false } });
  });

  test("strong proof is live and required for recovery acknowledgment and resumed credential checks", async () => {
    const f = await fixture();
    await f.begin();
    const { factor, codes } = await f.security();
    await f.update("session", f.session._id, { strongVerifiedAt: 0 });
    await expect(f.client.action(api.platform.organizationEnrollment.acknowledgeRecovery, { ...f.context, password, codes: codes.slice(0, 2) })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    await expect(f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...f.context, password })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    await f.update("session", f.session._id, { strongVerifiedAt: Date.now() });
    await f.update("twoFactor", factor._id, { verified: false });
    await expect(f.client.action(api.platform.organizationEnrollment.acknowledgeRecovery, { ...f.context, password, codes: codes.slice(0, 2) })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
  });

  test.each([["one-code"], ["one-code", "one-code"], ["one-code", "wrong-code"], ["one-code", "second-code", "third-code"]])("rejects invalid acknowledgment %j", async (...input) => {
    const f = await fixture();
    await f.begin();
    await f.security();
    await expect(f.client.action(api.platform.organizationEnrollment.acknowledgeRecovery, { ...f.context, password, codes: input as string[] })).rejects.toThrow("INVALID_RECOVERY_CODES");
    expect(await f.status()).toMatchObject({ setup: { backupAcknowledged: false } });
  });

  test("credential and recovery state races invalidate the parent's exact validated proof", async () => {
    const f = await fixture();
    await f.begin();
    const { factor, codes } = await f.security();
    vi.mocked(crypto.verifyPassword).mockImplementationOnce(async args => {
      const verified = await actualCrypto.verifyPassword(args);
      await f.update("account", f.account._id, { password: "replaced-credential-hash" });
      return verified;
    });
    await expect(f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...f.context, password })).rejects.toThrow("CREDENTIAL_CHANGED");
    await f.update("account", f.account._id, { password: passwordHash });
    vi.mocked(crypto.verifyPassword).mockImplementationOnce(async args => {
      const verified = await actualCrypto.verifyPassword(args);
      await f.update("twoFactor", factor._id, { backupCodes: await crypto.symmetricEncrypt({ key: secret, data: JSON.stringify(["new-one", "new-two"]) }) });
      return verified;
    });
    await expect(f.client.action(api.platform.organizationEnrollment.acknowledgeRecovery, { ...f.context, password, codes: codes.slice(0, 2) })).rejects.toThrow("RECOVERY_CODES_CHANGED");
    expect(await f.status()).toMatchObject({ setup: { passwordVerified: false, backupAcknowledged: false } });
  });

  test("session revocation during password validation prevents recording", async () => {
    const f = await fixture();
    await f.begin();
    vi.mocked(crypto.verifyPassword).mockImplementationOnce(async args => {
      const verified = await actualCrypto.verifyPassword(args);
      await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: f.session._id }] } });
      return verified;
    });
    await expect(f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...f.context, password })).rejects.toThrow("NOT_AUTHENTICATED");
    expect(await f.t.query(components.betterAuth.organizations.enrollmentStatus, { ...f.context, userId: f.user._id })).toMatchObject({ passwordVerified: false });
  });

  test("scoped four-hour absolute expiry never blocks unchanged personal access or resets on password proof", async () => {
    const f = await fixture();
    await f.begin();
    vi.setSystemTime(Date.now() + ADMIN_SESSION_MS + 1);
    await f.t.mutation(internal.platform.sessionAssurance.recordProof, { userId: f.user._id, sessionId: f.session._id, kind: "password", passwordHash });
    expect(await f.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: true, scope: "user" });
    expect(await f.status()).toMatchObject({ allowed: false, reason: "reauthenticate", expiresAt: f.session.authenticatedAt! + ADMIN_SESSION_MS });
    await expect(f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...f.context, password })).rejects.toThrow("REAUTHENTICATION_REQUIRED");
  });

  test("recent-proof expiry, recovery-only sessions and magic links cannot satisfy scoped enrollment", async () => {
    const f = await fixture();
    await f.begin();
    vi.setSystemTime(Date.now() + RECENT_AUTH_MS + 1);
    await expect(f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...f.context, password })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    await f.update("session", f.session._id, { primaryVerifiedAt: Date.now(), recoveryOnly: true });
    await expect(f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...f.context, password })).rejects.toThrow("REAUTHENTICATION_REQUIRED");
    await f.update("session", f.session._id, { recoveryOnly: false, authMethod: "magic-link" });
    await f.setting("userMagicLinkEnabled", true);
    expect(await f.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: true });
    expect(await f.status()).toMatchObject({ reason: "method_disabled" });
  });

  test("org-admin enrollment policy is fail-closed but never overrides pending personal policy", async () => {
    const f = await fixture();
    await f.begin();
    await f.security();
    await f.setting("adminPasskeyPolicy", "required");
    await f.setting("adminEmailVerificationRequired", false);
    await f.setting("adminMfaRequired", false);
    expect(await f.status()).toMatchObject({ emailRequired: true, mfaRequired: true, passkeyPolicy: "required", reason: "passkey_enrollment" });
    await f.setting("adminPasskeyPolicy", "invalid-value");
    expect(await f.status()).toMatchObject({ passkeyPolicy: "required" });
    await f.setting("userEmailVerificationRequired", false);
    await f.update("user", f.user._id, { emailVerified: false });
    expect(await f.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: true });
    expect(await f.status()).toMatchObject({ reason: "email_verification" });
  });

  test("foreign context, disabled organization, missing membership and auth-only purpose fail closed", async () => {
    const f = await fixture();
    await f.begin();
    const other = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: "Other", email: "other@example.test", role: "user", emailVerified: true, createdAt: Date.now(), updatedAt: Date.now() } } });
    const foreign = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: other._id });
    await expect(f.client.query(api.platform.organizationEnrollment.status, { organizationId: foreign.organizationId })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    await f.update("session", f.session._id, { authPurpose: "mcp-authorization" });
    await expect(f.status()).rejects.toThrow("NOT_AUTHENTICATED");
    await f.update("session", f.session._id, { authPurpose: "application" });
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "organization", where: [{ field: "_id", value: f.context.organizationId }], update: { lifecycle: "disabled" } } });
    await expect(f.status()).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "organization", where: [{ field: "_id", value: f.context.organizationId }], update: { lifecycle: "active" } } });
    const { memberId } = await f.t.query(components.betterAuth.organizations.context, { ...f.context, userId: f.user._id });
    await expect(f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "member", where: [{ field: "_id", value: memberId }] } })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    expect(await f.status()).toMatchObject({ setup: { completed: false } });
  });

  test("a pending promotion binds setup to canonical membership without granting administration", async () => {
    const f = await fixture();
    const owner = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: "Owner", email: "owner@example.test", role: "user", emailVerified: true, createdAt: Date.now(), updatedAt: Date.now() } } });
    const org = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: owner._id });
    // Trusted component fixture represents an already peer enrolled for organization membership management.
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: { userId: owner._id, verified: true, secret: "fixture-factor", backupCodes: "fixture-codes" } } });
    await f.update("user", owner._id, { twoFactorEnabled: true });
    await enrollOrganizationAdminForTest(f.t, { organizationId: org.organizationId, userId: owner._id, name: "Peer", slug: "peer-org" });
    const member = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: { userId: f.user._id, organizationId: org.organizationId, role: ORG_MEMBER_ROLE, createdAt: Date.now() } } });
    await f.t.mutation(components.betterAuth.organizations.changeMember, { organizationId: org.organizationId, actorId: owner._id, memberId: member._id, operation: "promote" });
    const context = { organizationId: org.organizationId };
    await f.client.action(api.platform.organizationEnrollment.verifyCredential, { ...context, password });
    const { codes } = await f.security();
    await f.client.action(api.platform.organizationEnrollment.acknowledgeRecovery, { ...context, password, codes: codes.slice(0, 2) });
    expect(await f.client.query(api.platform.organizationEnrollment.status, context)).toMatchObject({ scope: "user", setup: { purpose: "promotion", passwordVerified: true, backupAcknowledged: true, completed: false } });
    expect(await f.t.query(components.betterAuth.organizations.context, { ...context, userId: f.user._id })).toMatchObject({ role: ORG_MEMBER_ROLE, canManageMembers: false });
    await f.t.mutation(components.betterAuth.organizations.changeMember, { organizationId: org.organizationId, actorId: owner._id, memberId: member._id, operation: "remove" });
    await expect(f.client.query(api.platform.organizationEnrollment.status, context)).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
  });

  test("app operators cannot begin or inspect org-admin enrollment", async () => {
    const f = await fixture("admin");
    await expect(f.begin()).rejects.toThrow("NOT_CUSTOMER");
    await expect(f.status()).rejects.toThrow("NOT_CUSTOMER");
  });
});
