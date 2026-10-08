import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { sha256Hex } from "./tokenHash";
import { RECENT_AUTH_MS } from "./sessionFields";

const authModules = import.meta.glob("./betterAuth/**/*.*s");
const orgApi = components.betterAuth.organizations;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.stubEnv("BETTER_AUTH_SECRET", "organization-fixture-secret-at-least-32-characters");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, authModules);
  async function user(email: string, role = "user") {
    const now = Date.now();
    const result = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: email.split("@")[0], email, role, emailVerified: true, createdAt: now, updatedAt: now,
    } } });
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
      userId: result._id, accountId: result._id, providerId: "credential", password: "fixture-credential-hash", createdAt: now, updatedAt: now,
    } } });
    return result;
  }
  async function security(userId: string) {
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: userId }], update: { twoFactorEnabled: true } } });
    return await t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: {
      userId, secret: "fixture-encrypted-secret", backupCodes: "fixture-encrypted-codes", verified: true,
    } } });
  }
  async function complete(organizationId: string, userId: string, factorId: string) {
    await t.mutation(orgApi.recordPasswordProof, { organizationId, userId, credentialProof: sha256Hex("fixture-credential-hash") });
    await t.mutation(orgApi.acknowledgeRecovery, { organizationId, userId, factorId });
    return await t.mutation(orgApi.completeEnrollment, { organizationId, userId, requirePasskey: false });
  }
  async function collaborative(email: string, slug: string) {
    const admin = await user(email);
    const org = await t.mutation(orgApi.provisionPersonal, { userId: admin._id });
    await t.mutation(orgApi.beginCollaboration, { organizationId: org.organizationId, userId: admin._id, name: slug, slug });
    const factor = await security(admin._id);
    await complete(org.organizationId, admin._id, factor._id);
    return { ...org, admin, factor };
  }
  async function addMember(organizationId: string, userId: string) {
    return await t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
      organizationId, userId, role: "member", createdAt: Date.now(),
    } } });
  }
  return { t, user, security, complete, collaborative, addMember };
}

// These exercise component mutation/query behavior and persisted state, not source strings.
// HTTP/session proof and full enrollment ceremonies have their separate integration suites.
describe("canonical organization component boundary", () => {
  test("personal provisioning is retry-safe, creates no global administrator and hides collaboration", async () => {
    const f = fixture();
    const user = await f.user("personal@example.test");
    const first = await f.t.mutation(orgApi.provisionPersonal, { userId: user._id });
    const repeated = await f.t.mutation(orgApi.provisionPersonal, { userId: user._id });
    expect(repeated).toEqual(first);
    expect(await f.t.query(orgApi.context, { organizationId: first.organizationId, userId: user._id })).toMatchObject({ experience: "personal", role: "org-admin", canManageMembers: false });
    const saved = await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: user._id }] });
    expect(saved?.role).toBe("user");
    await expect(f.t.query(orgApi.directory, { organizationId: first.organizationId, actorId: user._id, paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("NOT_ORGANIZATION_ADMIN");
  });

  test("operator and already-joined member cannot provision a customer organization", async () => {
    const f = fixture();
    const operator = await f.user("operator@example.test", "admin");
    await expect(f.t.mutation(orgApi.provisionPersonal, { userId: operator._id })).rejects.toThrow("NOT_CUSTOMER");
    const org = await f.collaborative("creator@example.test", "joined-org");
    const member = await f.user("joined@example.test");
    await f.addMember(org.organizationId, member._id);
    await expect(f.t.mutation(orgApi.provisionPersonal, { userId: member._id })).rejects.toThrow("CUSTOMER_ALREADY_HAS_MEMBERSHIP");
  });

  test("unknown identity and foreign context are rejected", async () => {
    const f = fixture();
    const a = await f.collaborative("a@example.test", "context-a");
    const b = await f.collaborative("b@example.test", "context-b");
    await expect(f.t.query(orgApi.context, { organizationId: a.organizationId, userId: b.admin._id })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    await expect(f.t.mutation(orgApi.provisionPersonal, { userId: "not-a-user-id" })).rejects.toThrow("NOT_CUSTOMER");
  });

  test("collaboration is pending until actual credential, recovery and verified-factor requirements hold", async () => {
    const f = fixture();
    const user = await f.user("upgrade@example.test");
    const org = await f.t.mutation(orgApi.provisionPersonal, { userId: user._id });
    const args = { organizationId: org.organizationId, userId: user._id, name: "My organization", slug: "my-organization" };
    const enrollmentId = await f.t.mutation(orgApi.beginCollaboration, args);
    expect(await f.t.mutation(orgApi.beginCollaboration, args)).toBe(enrollmentId);
    await expect(f.t.mutation(orgApi.completeEnrollment, { organizationId: org.organizationId, userId: user._id, requirePasskey: false })).rejects.toThrow("ADMIN_ENROLLMENT_REQUIRED");
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ experience: "personal", canManageMembers: false });
    const factor = await f.security(user._id);
    await f.complete(org.organizationId, user._id, factor._id);
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ organizationId: org.organizationId, name: args.name, slug: args.slug, experience: "collaborative", canManageMembers: true });
    expect(await f.t.mutation(orgApi.completeEnrollment, { organizationId: org.organizationId, userId: user._id, requirePasskey: false })).toBe(org.organizationId);
  });

  test("required passkey blocks completion without partially activating collaboration", async () => {
    const f = fixture();
    const user = await f.user("passkey@example.test");
    const org = await f.t.mutation(orgApi.provisionPersonal, { userId: user._id });
    await f.t.mutation(orgApi.beginCollaboration, { organizationId: org.organizationId, userId: user._id, name: "Passkey", slug: "passkey-required" });
    const factor = await f.security(user._id);
    await f.t.mutation(orgApi.recordPasswordProof, { organizationId: org.organizationId, userId: user._id, credentialProof: sha256Hex("fixture-credential-hash") });
    await f.t.mutation(orgApi.acknowledgeRecovery, { organizationId: org.organizationId, userId: user._id, factorId: factor._id });
    await expect(f.t.mutation(orgApi.completeEnrollment, { organizationId: org.organizationId, userId: user._id, requirePasskey: true })).rejects.toThrow("PASSKEY_REQUIRED");
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ experience: "personal", canManageMembers: false });
  });

  test("password changes invalidate enrollment proof; expired proof cannot complete", async () => {
    const f = fixture();
    const user = await f.user("proof@example.test");
    const org = await f.t.mutation(orgApi.provisionPersonal, { userId: user._id });
    await f.t.mutation(orgApi.beginCollaboration, { organizationId: org.organizationId, userId: user._id, name: "Proof", slug: "proof-org" });
    const factor = await f.security(user._id);
    await f.t.mutation(orgApi.recordPasswordProof, { organizationId: org.organizationId, userId: user._id, credentialProof: sha256Hex("fixture-credential-hash") });
    await f.t.mutation(orgApi.acknowledgeRecovery, { organizationId: org.organizationId, userId: user._id, factorId: factor._id });
    vi.setSystemTime(Date.now() + RECENT_AUTH_MS + 1);
    await expect(f.t.mutation(orgApi.completeEnrollment, { organizationId: org.organizationId, userId: user._id, requirePasskey: false })).rejects.toThrow("ADMIN_ENROLLMENT_REQUIRED");
    await f.t.mutation(orgApi.recordPasswordProof, { organizationId: org.organizationId, userId: user._id, credentialProof: sha256Hex("fixture-credential-hash") });
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "account", where: [{ field: "userId", value: user._id }], update: { password: "changed-credential-hash" } } });
    await expect(f.t.mutation(orgApi.completeEnrollment, { organizationId: org.organizationId, userId: user._id, requirePasskey: false })).rejects.toThrow("ADMIN_ENROLLMENT_REQUIRED");
  });

  test.each(["collaboration", "promotion"] as const)("%s requires acknowledgment of regenerated recovery codes", async purpose => {
    const f = fixture();
    const user = await f.user(`recovery-${purpose}@example.test`);
    let organizationId: string;
    if (purpose === "collaboration") {
      const org = await f.t.mutation(orgApi.provisionPersonal, { userId: user._id });
      organizationId = org.organizationId;
      await f.t.mutation(orgApi.beginCollaboration, { organizationId, userId: user._id, name: "Recovery", slug: "recovery-org" });
    } else {
      const org = await f.collaborative("recovery-owner@example.test", "recovery-org");
      organizationId = org.organizationId;
      const member = await f.addMember(organizationId, user._id);
      await f.t.mutation(orgApi.changeMember, { organizationId, actorId: org.admin._id, memberId: member._id, operation: "promote" });
    }
    const factor = await f.security(user._id);
    const args = { organizationId, userId: user._id };
    await f.t.mutation(orgApi.recordPasswordProof, { ...args, credentialProof: sha256Hex("fixture-credential-hash") });
    await f.t.mutation(orgApi.acknowledgeRecovery, { ...args, factorId: factor._id });
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }], update: { backupCodes: "regenerated-encrypted-codes" } } });
    await expect(f.t.mutation(orgApi.completeEnrollment, { ...args, requirePasskey: false })).rejects.toThrow("ADMIN_ENROLLMENT_REQUIRED");
    expect(await f.t.query(orgApi.context, args)).toMatchObject({ canManageMembers: false,
      experience: purpose === "collaboration" ? "personal" : "collaborative", role: purpose === "collaboration" ? "org-admin" : "member" });
    await f.t.mutation(orgApi.acknowledgeRecovery, { ...args, factorId: factor._id });
    expect(await f.t.mutation(orgApi.completeEnrollment, { ...args, requirePasskey: false })).toBe(organizationId);
    expect(await f.t.query(orgApi.context, args)).toMatchObject({ canManageMembers: true, role: "org-admin" });
  });

  test.each(["collaboration", "promotion"] as const)("%s replay checks the current required passkey", async purpose => {
    const f = fixture();
    const user = await f.user(`replay-${purpose}@example.test`);
    let organizationId: string;
    if (purpose === "collaboration") {
      const org = await f.t.mutation(orgApi.provisionPersonal, { userId: user._id });
      organizationId = org.organizationId;
      await f.t.mutation(orgApi.beginCollaboration, { organizationId, userId: user._id, name: "Replay", slug: "replay-org" });
    } else {
      const org = await f.collaborative("replay-owner@example.test", "replay-org");
      organizationId = org.organizationId;
      const member = await f.addMember(organizationId, user._id);
      await f.t.mutation(orgApi.changeMember, { organizationId, actorId: org.admin._id, memberId: member._id, operation: "promote" });
    }
    const factor = await f.security(user._id);
    const args = { organizationId, userId: user._id, requirePasskey: true };
    await f.t.mutation(orgApi.recordPasswordProof, { organizationId, userId: user._id, credentialProof: sha256Hex("fixture-credential-hash") });
    await f.t.mutation(orgApi.acknowledgeRecovery, { organizationId, userId: user._id, factorId: factor._id });
    const passkey = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: user._id, publicKey: "fixture-public-key", credentialID: "fixture-credential-id", counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    expect(await f.t.mutation(orgApi.completeEnrollment, args)).toBe(organizationId);
    expect(await f.t.mutation(orgApi.completeEnrollment, args)).toBe(organizationId);
    await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "passkey", where: [{ field: "_id", value: passkey._id }] } });
    await expect(f.t.mutation(orgApi.completeEnrollment, args)).rejects.toThrow("PASSKEY_REQUIRED");
    expect(await f.t.mutation(orgApi.completeEnrollment, { ...args, requirePasskey: false })).toBe(organizationId);
  });

  test("foreign-factor acknowledgment and changed verified factor cannot complete", async () => {
    const f = fixture();
    const a = await f.user("factor-a@example.test");
    const b = await f.user("factor-b@example.test");
    const org = await f.t.mutation(orgApi.provisionPersonal, { userId: a._id });
    await f.t.mutation(orgApi.beginCollaboration, { organizationId: org.organizationId, userId: a._id, name: "Factors", slug: "factor-org" });
    const af = await f.security(a._id);
    const bf = await f.security(b._id);
    await expect(f.t.mutation(orgApi.acknowledgeRecovery, { organizationId: org.organizationId, userId: a._id, factorId: bf._id })).rejects.toThrow("INVALID_ENROLLMENT");
    await f.t.mutation(orgApi.recordPasswordProof, { organizationId: org.organizationId, userId: a._id, credentialProof: sha256Hex("fixture-credential-hash") });
    await f.t.mutation(orgApi.acknowledgeRecovery, { organizationId: org.organizationId, userId: a._id, factorId: af._id });
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: af._id }], update: { verified: false } } });
    await expect(f.t.mutation(orgApi.completeEnrollment, { organizationId: org.organizationId, userId: a._id, requirePasskey: false })).rejects.toThrow("ADMIN_ENROLLMENT_REQUIRED");
  });

  test("promotion creates pending enrollment, not immediate authority", async () => {
    const f = fixture();
    const org = await f.collaborative("promoter@example.test", "promotion-org");
    const user = await f.user("promoted@example.test");
    const member = await f.addMember(org.organizationId, user._id);
    const args = { organizationId: org.organizationId, actorId: org.admin._id, memberId: member._id, operation: "promote" as const };
    await f.t.mutation(orgApi.changeMember, args);
    await f.t.mutation(orgApi.changeMember, args);
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ role: "member", canManageMembers: false });
    await expect(f.t.mutation(orgApi.changeMember, { ...args, actorId: user._id, memberId: org.memberId, operation: "remove" })).rejects.toThrow("NOT_ORGANIZATION_ADMIN");
    const factor = await f.security(user._id);
    await f.complete(org.organizationId, user._id, factor._id);
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ role: "org-admin", canManageMembers: true });
  });

  test("last enrolled admin is protected; a pending replacement does not count", async () => {
    const f = fixture();
    const org = await f.collaborative("last@example.test", "last-admin");
    const user = await f.user("replacement@example.test");
    const member = await f.addMember(org.organizationId, user._id);
    await f.t.mutation(orgApi.changeMember, { organizationId: org.organizationId, actorId: org.admin._id, memberId: member._id, operation: "promote" });
    for (const operation of ["remove", "demote"] as const) await expect(f.t.mutation(orgApi.changeMember, { organizationId: org.organizationId, actorId: org.admin._id, memberId: org.memberId, operation })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    const factor = await f.security(user._id);
    await f.complete(org.organizationId, user._id, factor._id);
    await f.t.mutation(orgApi.changeMember, { organizationId: org.organizationId, actorId: org.admin._id, memberId: org.memberId, operation: "demote" });
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: org.admin._id })).toMatchObject({ role: "member", canManageMembers: false });
  });

  test("concurrent peer self-demotions cannot leave zero enrolled administrators", async () => {
    const f = fixture();
    const org = await f.collaborative("concurrent-a@example.test", "concurrent-org");
    const b = await f.user("concurrent-b@example.test");
    const bm = await f.addMember(org.organizationId, b._id);
    await f.t.mutation(orgApi.changeMember, { organizationId: org.organizationId, actorId: org.admin._id, memberId: bm._id, operation: "promote" });
    const bf = await f.security(b._id);
    await f.complete(org.organizationId, b._id, bf._id);
    const results = await Promise.allSettled([
      f.t.mutation(orgApi.changeMember, { organizationId: org.organizationId, actorId: org.admin._id, memberId: org.memberId, operation: "demote" }),
      f.t.mutation(orgApi.changeMember, { organizationId: org.organizationId, actorId: b._id, memberId: bm._id, operation: "demote" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const denied = results.find(result => result.status === "rejected");
    expect(denied?.status === "rejected" && String(denied.reason)).toContain("LAST_ORGANIZATION_ADMIN");
    const rows = await f.t.query(components.betterAuth.adapter.findMany, { model: "member", where: [{ field: "organizationId", value: org.organizationId }], paginationOpts: { numItems: 100, cursor: null } });
    expect(rows.page.filter(row => row.role === "org-admin")).toHaveLength(1);
  });

  test("installed native organization endpoints remain denied to valid customer sessions", async () => {
    const f = fixture();
    const org = await f.collaborative("http@example.test", "http-org");
    const now = Date.now();
    const token = crypto.randomUUID();
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: org.admin._id, token, createdAt: now, updatedAt: now, expiresAt: now + 86_400_000,
      assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
      strongVerifiedAt: now, strongFactorId: org.factor._id, strongFactorType: "totp",
    } } });
    const operations = [
      { path: "create", body: { name: "Bypass", slug: "bypass-org" } },
      { path: "delete", body: { organizationId: org.organizationId } },
      { path: "remove-member", body: { organizationId: org.organizationId, memberIdOrEmail: org.memberId } },
      { path: "update-member-role", body: { organizationId: org.organizationId, memberId: org.memberId, role: "member" } },
      { path: "leave", body: { organizationId: org.organizationId } },
      { path: "invite-member", body: { organizationId: org.organizationId, email: "bypass@example.test", role: "org-admin" } },
    ];
    for (const operation of operations) {
      const response = await f.t.fetch(`/api/auth/organization/${operation.path}`, { method: "POST", headers: {
        origin: "http://localhost:3000", "content-type": "application/json", authorization: `Bearer ${token}`,
      }, body: JSON.stringify(operation.body) });
      expect(response.status, operation.path).toBe(403);
      expect(await response.json()).toMatchObject({ code: "AUTH_METHOD_DISABLED" });
    }
    const response = await f.t.fetch("/api/auth/organization/list", { headers: { origin: "http://localhost:3000", authorization: `Bearer ${token}` } });
    expect(response.status).toBe(403);
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: org.admin._id })).toMatchObject({ canManageMembers: true });
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "slug", value: "bypass-org" }] })).toBeNull();
  });

  test("foreign member IDs cannot be managed and membership removal preserves other organizations/identity", async () => {
    const f = fixture();
    const a = await f.collaborative("remove-a@example.test", "remove-org-a");
    const b = await f.collaborative("remove-b@example.test", "remove-org-b");
    await expect(f.t.mutation(orgApi.changeMember, { organizationId: a.organizationId, actorId: a.admin._id, memberId: b.memberId, operation: "remove" })).rejects.toThrow("MEMBER_NOT_FOUND");
    const shared = await f.user("shared@example.test");
    const am = await f.addMember(a.organizationId, shared._id);
    await f.addMember(b.organizationId, shared._id);
    await f.t.mutation(orgApi.changeMember, { organizationId: a.organizationId, actorId: a.admin._id, memberId: am._id, operation: "remove" });
    await expect(f.t.query(orgApi.context, { organizationId: a.organizationId, userId: shared._id })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    expect(await f.t.query(orgApi.context, { organizationId: b.organizationId, userId: shared._id })).toMatchObject({ role: "member" });
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: shared._id }] })).not.toBeNull();
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "userId", value: shared._id }] })).not.toBeNull();
  });

  test("operator contacts expose only org-admin names/emails, not ordinary or pending members or auth fields", async () => {
    const f = fixture();
    const org = await f.collaborative("contact-admin@example.test", "contact-org");
    const operator = await f.user("contact-operator@example.test", "admin");
    const member = await f.user("hidden-member@example.test");
    const row = await f.addMember(org.organizationId, member._id);
    await f.t.mutation(orgApi.changeMember, { organizationId: org.organizationId, actorId: org.admin._id, memberId: row._id, operation: "promote" });
    expect(await f.t.query(orgApi.contacts, { organizationId: org.organizationId, operatorId: operator._id })).toEqual({
      organizationId: org.organizationId, name: "contact-org", experience: "collaborative", lifecycle: "active",
      contacts: [{ name: "contact-admin", email: "contact-admin@example.test" }],
    });
    await expect(f.t.query(orgApi.contacts, { organizationId: org.organizationId, operatorId: org.admin._id })).rejects.toThrow("NOT_PLATFORM_ADMIN");
    await expect(f.t.query(orgApi.directory, { organizationId: org.organizationId, actorId: operator._id, paginationOpts: { cursor: null, numItems: 10 } })).rejects.toThrow("NOT_CUSTOMER");
  });

  test("disable gates all component customer operations and reactivation preserves membership", async () => {
    const f = fixture();
    const org = await f.collaborative("disabled@example.test", "disabled-org");
    const operator = await f.user("lifecycle-operator@example.test", "admin");
    await expect(f.t.mutation(orgApi.setLifecycle, { organizationId: org.organizationId, operatorId: org.admin._id, lifecycle: "disabled" })).rejects.toThrow("NOT_PLATFORM_ADMIN");
    await f.t.mutation(orgApi.setLifecycle, { organizationId: org.organizationId, operatorId: operator._id, lifecycle: "disabled" });
    await expect(f.t.query(orgApi.context, { organizationId: org.organizationId, userId: org.admin._id })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    await expect(f.t.query(orgApi.directory, { organizationId: org.organizationId, actorId: org.admin._id, paginationOpts: { cursor: null, numItems: 10 } })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    await expect(f.t.mutation(orgApi.changeMember, { organizationId: org.organizationId, actorId: org.admin._id, memberId: org.memberId, operation: "demote" })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    expect(await f.t.query(orgApi.contacts, { organizationId: org.organizationId, operatorId: operator._id })).toMatchObject({ lifecycle: "disabled" });
    await f.t.mutation(orgApi.setLifecycle, { organizationId: org.organizationId, operatorId: operator._id, lifecycle: "active" });
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: org.admin._id })).toMatchObject({ canManageMembers: true });
  });

  test("leaving protects the personal/collaborative sole admin and affects only the selected membership", async () => {
    const f = fixture();
    const user = await f.user("leaving@example.test");
    const own = await f.t.mutation(orgApi.provisionPersonal, { userId: user._id });
    await expect(f.t.mutation(orgApi.leave, { organizationId: own.organizationId, userId: user._id })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    const other = await f.collaborative("leave-other@example.test", "leave-other-org");
    await f.addMember(other.organizationId, user._id);
    await f.t.mutation(orgApi.leave, { organizationId: other.organizationId, userId: user._id });
    await expect(f.t.query(orgApi.context, { organizationId: other.organizationId, userId: user._id })).rejects.toThrow("ORGANIZATION_UNAVAILABLE");
    expect(await f.t.query(orgApi.context, { organizationId: own.organizationId, userId: user._id })).toMatchObject({ experience: "personal" });
    await expect(f.t.mutation(orgApi.leave, { organizationId: other.organizationId, userId: other.admin._id })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
  });

  test("cursor directory paginates scoped membership without offset or secret fields", async () => {
    const f = fixture();
    const a = await f.collaborative("directory-a@example.test", "directory-org-a");
    const b = await f.collaborative("directory-b@example.test", "directory-org-b");
    const member = await f.user("directory-member@example.test");
    await f.addMember(a.organizationId, member._id);
    const first = await f.t.query(orgApi.directory, { organizationId: a.organizationId, actorId: a.admin._id, paginationOpts: { cursor: null, numItems: 1 } });
    expect(first.page).toHaveLength(1);
    expect(first.isDone).toBe(false);
    const second = await f.t.query(orgApi.directory, { organizationId: a.organizationId, actorId: a.admin._id, paginationOpts: { cursor: first.continueCursor, numItems: 1 } });
    expect(second.page).toHaveLength(1);
    // The component paginator conservatively requires a final empty page at an exact boundary.
    expect(second.isDone).toBe(false);
    const final = await f.t.query(orgApi.directory, { organizationId: a.organizationId, actorId: a.admin._id, paginationOpts: { cursor: second.continueCursor, numItems: 1 } });
    expect(final.page).toEqual([]);
    expect(final.isDone).toBe(true);
    expect([...first.page, ...second.page].map(row => row.email).sort()).toEqual([a.admin.email, member.email].sort());
    expect([...first.page, ...second.page].some(row => row.email === b.admin.email)).toBe(false);
    expect(Object.keys(second.page[0]).sort()).toEqual(["adminPending", "email", "enrolled", "memberId", "name", "role"]);
  });

  test("directory rejects foreign start and end cursors in both tenant directions", async () => {
    const f = fixture();
    const a = await f.collaborative("cursor-a@example.test", "cursor-org-a");
    const b = await f.collaborative("cursor-b@example.test", "cursor-org-b");
    for (const org of [a, b]) {
      for (let i = 0; i < 2; i++) {
        const user = await f.user(`cursor-${org.organizationId}-${i}@example.test`);
        await f.addMember(org.organizationId, user._id);
      }
    }
    for (const [own, foreign] of [[a, b], [b, a]]) {
      const args = { organizationId: own.organizationId, actorId: own.admin._id };
      const foreignPage = await f.t.query(orgApi.directory, { organizationId: foreign.organizationId, actorId: foreign.admin._id, paginationOpts: { cursor: null, numItems: 1 } });
      expect(foreignPage.isDone).toBe(false);
      await expect(f.t.query(orgApi.directory, { ...args, paginationOpts: { cursor: foreignPage.continueCursor, numItems: 1 } })).rejects.toThrow("INVALID_DIRECTORY_CURSOR");
      await expect(f.t.query(orgApi.directory, { ...args, paginationOpts: { cursor: null, endCursor: foreignPage.continueCursor, numItems: 1 } })).rejects.toThrow("INVALID_DIRECTORY_CURSOR");
      const first = await f.t.query(orgApi.directory, { ...args, paginationOpts: { cursor: null, numItems: 1 } });
      const bounded = await f.t.query(orgApi.directory, { ...args, paginationOpts: { cursor: null, endCursor: first.continueCursor, numItems: 1 } });
      expect(bounded.page).toEqual(first.page);
      for (const cursor of ["not-json", "{}", JSON.stringify([foreign.organizationId]), JSON.stringify([own.organizationId])]) {
        for (const field of ["cursor", "endCursor"] as const) {
          await expect(f.t.query(orgApi.directory, { ...args, paginationOpts: { cursor: null, numItems: 1, [field]: cursor } })).rejects.toThrow("INVALID_DIRECTORY_CURSOR");
        }
      }
    }
  });

  test("factor invalidation removes administrative authority and cannot satisfy last-admin replacement", async () => {
    const f = fixture();
    const org = await f.collaborative("invalidated@example.test", "invalidated-org");
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: org.factor._id }], update: { verified: false } } });
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: org.admin._id })).toMatchObject({ canManageMembers: false });
    await expect(f.t.mutation(orgApi.changeMember, { organizationId: org.organizationId, actorId: org.admin._id, memberId: org.memberId, operation: "remove" })).rejects.toThrow("NOT_ORGANIZATION_ADMIN");
  });

  test("slug collision at activation rolls back all grants, preserving personal state", async () => {
    const f = fixture();
    const a = await f.user("slug-a@example.test");
    const org = await f.t.mutation(orgApi.provisionPersonal, { userId: a._id });
    await f.t.mutation(orgApi.beginCollaboration, { organizationId: org.organizationId, userId: a._id, name: "Original", slug: "collision-org" });
    await f.collaborative("slug-b@example.test", "collision-org");
    const factor = await f.security(a._id);
    await expect(f.complete(org.organizationId, a._id, factor._id)).rejects.toThrow("ORGANIZATION_SLUG_TAKEN");
    expect(await f.t.query(orgApi.context, { organizationId: org.organizationId, userId: a._id })).toMatchObject({ experience: "personal", canManageMembers: false });
  });

  test.each(["admin", "UPPERCASE", "a", "has space", "../foreign"])("rejects invalid or reserved slug %s", async slug => {
    const f = fixture();
    const user = await f.user("slug@example.test");
    const org = await f.t.mutation(orgApi.provisionPersonal, { userId: user._id });
    await expect(f.t.mutation(orgApi.beginCollaboration, { organizationId: org.organizationId, userId: user._id, name: "Valid", slug })).rejects.toThrow("INVALID_ORGANIZATION_SLUG");
  });
});
