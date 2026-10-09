import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { hashPassword, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { organizationTotp } from "./organizationTotp";
import { api, components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { sha256Hex } from "./tokenHash";
import { createApi } from "@convex-dev/better-auth";
import { mutationGeneric } from "convex/server";
import { convexToJson, jsonToConvex } from "convex/values";
import * as guardedAdapter from "./betterAuth/adapter";
import { createAuthOptions } from "./auth";

const mutations = ["create", "updateOne", "updateMany", "deleteOne", "deleteMany"] as const;
type PinnedMutation = { exportArgs(): string; exportReturns(): string; invokeMutation(args: string): Promise<string> };
const unguarded = createApi(authSchema, createAuthOptions);
// convex-test normally calls _handler. This harness deliberately executes the
// exported pinned runtime closure instead, under its component syscall context.
const runtimeAdapter = Object.fromEntries(Object.entries(guardedAdapter).map(([name, fn]) => {
  if (!mutations.includes(name as typeof mutations[number])) return [name, fn];
  const registered = fn as unknown as PinnedMutation;
  const wrapper = mutationGeneric({ handler: async (_ctx, args) => jsonToConvex(JSON.parse(
    await registered.invokeMutation(JSON.stringify(convexToJson([args]))),
  )) });
  Object.assign(wrapper, { exportArgs: registered.exportArgs, exportReturns: registered.exportReturns });
  return [name, wrapper];
}));

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
const nativePassword = "violet compass timber waterfall oyster constellation";
const nativeFactorSecret = "12345678901234567890123456789012";
const nativeKey = "organization-replacement-secret-at-least-32-characters";

// Trusted canonical setup ONLY for low-level transaction/handler tests; live E2E earns all administrator authority.
async function fixture(admins = 2, native = false, complete = true) {
  if (native) {
    vi.stubEnv("BETTER_AUTH_SECRET", nativeKey);
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  }
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, {
    ...import.meta.glob("./betterAuth/**/*.*s"), "./betterAuth/adapter.ts": async () => runtimeAdapter,
  });
  await t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: "optional" });
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
    if (complete) await t.mutation(components.betterAuth.organizations.completeEnrollment, { ...bound, requirePasskey: false });
  }
  return { t, users, org };
}

describe("independent organization security review", () => {
  test.each(mutations)("%s retains exact pinned argument/return validators", name => {
    const guarded = guardedAdapter[name] as unknown as PinnedMutation;
    const original = unguarded[name] as unknown as PinnedMutation;
    expect(JSON.parse(guarded.exportArgs())).toEqual(JSON.parse(original.exportArgs()));
    expect(JSON.parse(guarded.exportReturns())).toEqual(JSON.parse(original.exportReturns()));
    expect(JSON.parse(guarded.exportArgs())).not.toEqual({ type: "any" });
  });

  test.each(mutations)("%s rejects malformed input before the real runtime handler writes", async name => {
    const { t, users, org } = await fixture(1);
    await expect(t.mutation(components.betterAuth.adapter[name], {
      input: { model: "twoFactor", data: { userId: 42 }, update: { verified: "false" } },
      paginationOpts: { cursor: null, numItems: "all" },
    } as never)).rejects.toThrow();
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: users[0].user._id })).toMatchObject({ canManageMembers: true });
  });

  test("real invokeMutation closure rejects sole-admin factor invalidation and rolls back", async () => {
    const { t, users } = await fixture(1);
    const { factor } = users[0];
    await expect(t.mutation(components.betterAuth.adapter.updateOne, { input: {
      model: "twoFactor", where: [{ field: "_id", value: factor._id }], update: { verified: false },
    } })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: factor._id }] })).toEqual(factor);
  });

  test("every pinned adapter mutation executes the mandatory guard, including bulk paths", async () => {
    const { t, users, org } = await fixture(1);
    const { user, factor } = users[0];
    await expect(t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
      organizationId: org.organizationId, userId: user._id, role: "org-admin", createdAt: Date.now(), adminEnrolledAt: Date.now(), adminFactorId: factor._id,
    } } })).rejects.toThrow("USE_ORGANIZATION_SECURITY_API");
    await expect(t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }] } })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    await expect(t.mutation(components.betterAuth.adapter.updateMany, { input: { model: "twoFactor", update: { verified: false } }, paginationOpts: { cursor: null, numItems: 100 } })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    await expect(t.mutation(components.betterAuth.adapter.deleteMany, { input: { model: "account" }, paginationOpts: { cursor: null, numItems: 100 } })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ canManageMembers: true });
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: factor._id }] })).toEqual(factor);
  });

  test.each([false, true])("cross-plane concurrent invalidations retain exactly one eligible admin (reverse=%s)", async reverse => {
    const { t, users, org } = await fixture();
    const operations = [
      () => t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: users[0].user._id }], update: { emailVerified: false } } }),
      () => t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "account", where: [{ field: "_id", value: users[1].account._id }] } }),
    ];
    const results = await Promise.allSettled((reverse ? operations.reverse() : operations).map(run => run()));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const contexts = await Promise.all(users.map(({ user }) => t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: user._id })));
    expect(contexts.filter(context => context.canManageMembers)).toHaveLength(1);
  });

  test("required-passkey policy forbids normal TOTP-only factor replacement", async () => {
    const { t, users } = await fixture(1, true);
    const { user, session } = users[0];
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: user._id, credentialID: "independent-key", publicKey: "trusted-low-level-key", counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    await t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: "required" });
    const client = t.withIdentity({ subject: user._id, sessionId: session._id });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: false, reason: "passkey_verification" });
    await expect(client.action(api.platform.organizationFactorReplacement.begin, { password: nativePassword }).then(() => "unexpected-secret-bearing-success")).rejects.toThrow(/PASSKEY|AUTHENTICATION/);
  });

  test.each(["generate-register-options", "verify-registration"])("required existing passkey rejects TOTP-only %s", async path => {
    const { t, users } = await fixture(1, true);
    const { user, session } = users[0];
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: user._id, credentialID: "already-required-key", publicKey: "trusted-low-level-key", counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    await t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: "required" });
    expect(await t.withIdentity({ subject: user._id, sessionId: session._id }).query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: false, reason: "passkey_verification" });
    const registration = await t.fetch(`/api/auth/passkey/${path}`, { method: path === "generate-register-options" ? "GET" : "POST", headers: {
      origin: "http://localhost:3000", authorization: `Bearer ${session.token}`, "content-type": "application/json",
    }, ...(path === "verify-registration" ? { body: JSON.stringify({ response: {}, name: "Unproved replacement" }) } : {}) });
    expect(registration.status).toBe(403);
  });

  test.each(["first-key", "optional-policy", "current-required-key"])("passkey enrollment remains available for legitimate %s proof", async scenario => {
    const { t, users, org } = await fixture(1, true, scenario !== "first-key");
    const { user, session } = users[0];
    if (scenario !== "first-key") {
      const key = await t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
        userId: user._id, credentialID: "eligible-existing-key", publicKey: "trusted-low-level-key", counter: 0, deviceType: "singleDevice", backedUp: false,
      } } });
      if (scenario === "current-required-key") await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: {
        strongFactorType: "passkey", strongFactorId: key._id, strongVerifiedAt: Date.now(),
      } } });
    }
    await t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: scenario === "optional-policy" ? "optional" : "required" });
    if (scenario === "first-key") expect(await t.withIdentity({ subject: user._id, sessionId: session._id }).query(api.platform.organizationEnrollment.status, {
      organizationId: org.organizationId,
    })).toMatchObject({ allowed: false, reason: "passkey_enrollment" });
    const registration = await t.fetch("/api/auth/passkey/generate-register-options", { method: "GET", headers: {
      origin: "http://localhost:3000", authorization: `Bearer ${session.token}`,
    } });
    expect(registration.status).toBe(200);
  });

  test("native concurrent recovery-code replay consumes once and preserves eligibility", async () => {
    const { t, users, org } = await fixture(1, true);
    const { user, session, factor } = users[0];
    const consume = () => t.fetch("/api/auth/two-factor/verify-backup-code", { method: "POST", headers: {
      origin: "http://localhost:3000", "content-type": "application/json", authorization: `Bearer ${session.token}`,
    }, body: JSON.stringify({ code: "one" }) });
    const responses = await Promise.all([consume(), consume()]);
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    const current = await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: factor._id }] });
    expect(JSON.parse(await symmetricDecrypt({ key: nativeKey, data: current!.backupCodes }))).toEqual(["two", "three"]);
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ canManageMembers: true });
    const sessions = await t.query(components.betterAuth.adapter.findMany, { model: "session", where: [{ field: "userId", value: user._id }], paginationOpts: { cursor: null, numItems: 100 } });
    const recovery = sessions.page.filter(row => row.recoveryOnly);
    expect(recovery).toHaveLength(1);
    expect(await t.withIdentity({ subject: user._id, sessionId: recovery[0]._id }).query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: false, reason: "recovery", scope: "user" });
  });
  test("policy strengthening after staging rejects TOTP-only completion without changing the live factor", async () => {
    const { t, users } = await fixture(1, true);
    const { user, session, factor } = users[0];
    const client = t.withIdentity({ subject: user._id, sessionId: session._id });
    const stage = await client.action(api.platform.organizationFactorReplacement.begin, { password: nativePassword });
    const stored = await t.query(components.betterAuth.organizationSecurity.stagedFactor, { userId: user._id, sessionId: session._id, changeId: stage.changeId });
    const plaintext = await symmetricDecrypt({ key: nativeKey, data: stored.secret });
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: user._id, credentialID: "later-required-key", publicKey: "trusted-low-level-key", counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    await t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: "required" });
    await expect(client.action(api.platform.organizationFactorReplacement.complete, {
      changeId: stage.changeId, code: await organizationTotp(plaintext, Date.now()), backupCodes: stage.backupCodes.slice(0, 2),
    })).rejects.toThrow(/PASSKEY|AUTHENTICATION/);
    expect(await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "_id", value: factor._id }] })).toEqual(factor);
  });

  test("bound recovery can replace the lost TOTP under required policy but does not earn passkey proof", async () => {
    const { t, users } = await fixture(1, true);
    const { user, session, factor } = users[0];
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: user._id, credentialID: "recovery-required-key", publicKey: "trusted-low-level-key", counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    await t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: "required" });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: {
      recoveryOnly: true, recoverySourceFactorId: factor._id, recoverySourceFactorProof: sha256Hex(factor.secret), strongVerifiedAt: 0,
    } } });
    const client = t.withIdentity({ subject: user._id, sessionId: session._id });
    const stage = await client.action(api.platform.organizationFactorReplacement.begin, { password: nativePassword });
    const stored = await t.query(components.betterAuth.organizationSecurity.stagedFactor, { userId: user._id, sessionId: session._id, changeId: stage.changeId });
    const plaintext = await symmetricDecrypt({ key: nativeKey, data: stored.secret });
    await client.action(api.platform.organizationFactorReplacement.complete, {
      changeId: stage.changeId, code: await organizationTotp(plaintext, Date.now()), backupCodes: stage.backupCodes.slice(0, 2),
    });
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "user", securityScope: "admin", allowed: false, reason: "passkey_verification" });
  });

  test("disabled organizations release administrator-only native password-change requirements", async () => {
    const { t, users, org } = await fixture(1, true);
    const { user, session } = users[0];
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "organization", where: [{ field: "_id", value: org.organizationId }], update: { lifecycle: "disabled" } } });
    let liveSession = session;
    const request = (path: string, body: unknown) => t.fetch(`/api/auth${path}`, { method: "POST", headers: {
      origin: "http://localhost:3000", "content-type": "application/json", authorization: `Bearer ${liveSession.token}`,
    }, body: JSON.stringify(body) });
    expect((await request("/two-factor/disable", { password: nativePassword })).status).toBe(200);
    liveSession = (await t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "userId", value: user._id }] }))!;
    expect(liveSession).not.toBeNull();
    expect(await t.withIdentity({ subject: user._id, sessionId: liveSession._id }).query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "user", securityScope: "user" });
    // Re-prove the ordinary password after native factor disable rotated/revoked proof.
    expect((await request("/verify-password", { password: nativePassword })).status).toBe(200);
    expect((await request("/change-password", { currentPassword: nativePassword, newPassword: "violet lantern maple glacier musical constellation", revokeOtherSessions: false })).status).toBe(200);
  });

  test("reactivation after a weak ordinary password change cannot restore administrator authority", async () => {
    const { t, users, org } = await fixture(1);
    const { user, account } = users[0];
    const lifecycle = (value: "active" | "disabled") => t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "organization", where: [{ field: "_id", value: org.organizationId }], update: { lifecycle: value } },
    });
    await lifecycle("disabled");
    await t.mutation(components.betterAuth.organizationSecurity.replaceCredential, {
      userId: user._id, currentHash: account.password!, newHash: "ordinary-only-password-hash", adminPasswordValidated: false,
    });
    expect((await t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "_id", value: account._id }] }))?.password).toBe("ordinary-only-password-hash");
    await expect(lifecycle("active")).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    expect((await t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "_id", value: org.organizationId }] }))?.lifecycle).toBe("disabled");
  });

  test("activation between password preflight and commit cannot accept ordinary-only password proof", async () => {
    const { t, users, org } = await fixture(1);
    const { user, account, session } = users[0];
    const lifecycle = (value: "active" | "disabled") => t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "organization", where: [{ field: "_id", value: org.organizationId }], update: { lifecycle: value } },
    });
    await lifecycle("disabled");
    expect(await t.query(components.betterAuth.organizations.adminSecurity, { userId: user._id })).toMatchObject({ required: false });
    await lifecycle("active");
    await expect(t.mutation(components.betterAuth.organizationSecurity.replaceCredential, {
      userId: user._id, sessionId: session._id, currentHash: account.password!, newHash: "ordinary-only-password-hash", adminPasswordValidated: false,
    })).rejects.toThrow("PASSWORD_TOO_WEAK");
    expect((await t.query(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "_id", value: account._id }] }))?.password).toBe(account.password);
    expect(await t.query(components.betterAuth.organizations.context, { organizationId: org.organizationId, userId: user._id })).toMatchObject({ canManageMembers: true });
  });

  test("unprotected organizations do not exhaust the global policy update scan", async () => {
    const { t, users } = await fixture(1);
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: { userId: users[0].user._id, credentialID: "scale-key", publicKey: "trusted-low-level-key", counter: 0, deviceType: "singleDevice", backedUp: false } } });
    for (let i = 0; i < 1000; i++) await t.mutation(components.betterAuth.adapter.create, { input: { model: "organization", data: {
      name: "Disabled personal organization", slug: `disabled-${i}`, createdAt: Date.now(), lifecycle: "disabled", experience: "personal",
    } } });
    await expect(t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value: "required" })).resolves.toBeNull();
    expect(await t.query(components.betterAuth.organizationSecurity.policy, {})).toBe("required");
  });

});
