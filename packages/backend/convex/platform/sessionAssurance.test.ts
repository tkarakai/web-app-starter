import { createHash, createHmac, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getEndpoints } from "better-auth/api";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { getFunctionName } from "convex/server";
import * as assuranceHooks from "./authAssurance";
import { authComponent, createAuthOptions } from "./auth";
import { authRoutePolicy } from "./authAssurance";
import { api, components, internal } from "../_generated/api";
import { assuranceApi, createSessionAssuranceTestEnv } from "./sessionAssurance.test-helpers";
import { modules } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { sendAuthEmail } from "./sendAuthEmail";

vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
const authModules = import.meta.glob("./betterAuth/**/*.*s");
const password = "violet compass timber waterfall oyster constellation";
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword(password); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.mocked(sendAuthEmail).mockReset().mockResolvedValue(undefined);
  vi.stubEnv("BETTER_AUTH_SECRET", "session-assurance-fixture-secret-at-least-32-characters");
  vi.stubEnv("ADMIN_SITE_URL", "http://localhost:3001");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.pwnedpasswords.com/range/")) return new Response("");
    throw new Error(`Unexpected outbound request: ${url}`);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function totp(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret")!;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=/g, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map(value => parseInt(value, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function fixture(role = "user") {
  const t = createSessionAssuranceTestEnv(modules);
  t.registerComponent("betterAuth", authSchema, authModules);
  const now = Date.now();
  const email = `${randomUUID()}@example.test`;
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
    name: "Session fixture", email, role, emailVerified: true, createdAt: now, updatedAt: now,
  } } });
  await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
    userId: user._id, accountId: user._id, providerId: "credential", password: passwordHash, createdAt: now, updatedAt: now,
  } } });
  const setting = (key: string, value: unknown) => t.mutation(components.platform.appSettings.putRaw, { key, value: JSON.stringify(value) });
  const request = (path: string, body?: unknown, token?: string, cookie?: string) => t.fetch(`/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function signIn(extra = {}) {
    const response = await request("/sign-in/email", { email, password, ...extra });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return { response, body };
  }
  async function caller(token: string) {
    const session = await t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "token", value: token }] });
    expect(session).not.toBeNull();
    return { session: session!, client: t.withIdentity({ subject: user._id, sessionId: session!._id }) };
  }
  async function enroll(token: string) {
    const response = await request("/two-factor/enable", { password }, token);
    const data = await response.json();
    expect(response.status, JSON.stringify(data)).toBe(200);
    const verified = await request("/two-factor/verify-totp", { code: totp(data.totpURI) }, token);
    expect(verified.status, await verified.clone().text()).toBe(200);
    // Enrollment rotates the token. Resolve the cookie's new session rather than a stale body.
    const sessions = await t.query(components.betterAuth.adapter.findMany, { model: "session", where: [{ field: "userId", value: user._id }], paginationOpts: { cursor: null, numItems: 100 } });
    const factor = await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: user._id }] });
    const fresh = sessions.page.find(row => row.strongFactorType === "totp" && row.strongFactorId === factor?._id);
    expect(fresh).toBeDefined();
    return { token: fresh!.token, uri: data.totpURI as string, codes: data.backupCodes as string[] };
  }
  return { t, user, email, setting, request, signIn, caller, enroll };
}

async function passkeyFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  // A real RS256 COSE key and signed WebAuthn wire response; no verifier is mocked.
  const cose = Buffer.concat([Buffer.from([0xa4, 1, 3, 3, 0x39, 1, 0, 0x20, 0x59, 1, 0]),
    Buffer.from(jwk.n!, "base64url"), Buffer.from([0x21, 0x43]), Buffer.from(jwk.e!, "base64url")]);
  const credentialID = Buffer.from(randomUUID()).toString("base64url");
  const key = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
    name: "Fixture passkey", userId: f.user._id, publicKey: cose.toString("base64"), credentialID,
    counter: 0, deviceType: "singleDevice", backedUp: false, createdAt: Date.now(),
  } } });
  async function authenticate(uv: boolean, tamper = false) {
    const response = await f.request("/passkey/generate-authenticate-options");
    const options = await response.json();
    expect(response.status, JSON.stringify(options)).toBe(200);
    expect(options.userVerification).toBe("required");
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: "http://localhost:3001", crossOrigin: false }));
    const authenticatorData = Buffer.concat([createHash("sha256").update(options.rpId).digest(), Buffer.from([uv ? 5 : 1, 0, 0, 0, 1])]);
    const signature = sign("sha256", Buffer.concat([authenticatorData, createHash("sha256").update(clientData).digest()]), privateKey);
    if (tamper) authenticatorData[32] = 5;
    return await f.request("/passkey/verify-authentication", { response: {
      id: credentialID, rawId: credentialID, type: "public-key", clientExtensionResults: {},
      response: { clientDataJSON: clientData.toString("base64url"), authenticatorData: authenticatorData.toString("base64url"), signature: signature.toString("base64url") },
    } }, undefined, cookie);
  }
  return { key, authenticate };
}

describe("backend session assurance through authentication endpoints", () => {
  test("bulk revocation removes all 240 other sessions and preserves the current device", async () => {
    // convex-test does not enforce the live backend's 16-query concurrency cap.
    // Better Auth swallows failed deletion lookups, so enforce that cap here
    // while retaining real adapter reads, writes, hooks and HTTP endpoints.
    const adapterFactory = authComponent.adapter.bind(authComponent);
    let activeLookups = 0;
    vi.spyOn(authComponent, "adapter").mockImplementation(ctx => {
      const factory = adapterFactory(ctx);
      return options => {
        const adapter = factory(options);
        const findMany = adapter.findMany;
        adapter.findMany = async <T>(args: Parameters<typeof findMany>[0]) => {
          if (args.model !== "session" || args.limit !== 1) return findMany<T>(args);
          if (activeLookups >= 16) throw new Error("Too many concurrent queries");
          activeLookups++;
          try { return await findMany<T>(args); }
          finally { activeLookups--; }
        };
        return adapter;
      };
    });
    const f = await fixture();
    const { body } = await f.signIn();
    const now = Date.now();
    const otherUser = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: "Other user", email: `${randomUUID()}@example.test`, emailVerified: true, createdAt: now, updatedAt: now,
    } } });
    const otherToken = randomUUID();
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: otherUser._id, token: otherToken, createdAt: now, updatedAt: now, expiresAt: now + 86_400_000,
    } } });
    for (let index = 0; index < 240; index++) {
      await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
        userId: f.user._id, token: randomUUID(), createdAt: now, updatedAt: now, expiresAt: now + 86_400_000,
      } } });
    }

    const listed = await f.request("/list-sessions", undefined, body.token);
    expect(listed.status).toBe(200);
    const sessions: { token: string }[] = await listed.json();
    expect(new Set(sessions.map(session => session.token)).size).toBe(241);
    const response = await f.request("/revoke-other-sessions", {}, body.token);
    expect(response.status, await response.clone().text()).toBe(200);
    const remaining = await f.t.query(components.betterAuth.adapter.findMany, {
      model: "session", where: [{ field: "userId", value: f.user._id }],
      paginationOpts: { cursor: null, numItems: 300 },
    });
    expect(remaining.isDone).toBe(true);
    expect(remaining.page.map(session => session.token)).toEqual([body.token]);
    const current = await f.request("/get-session", undefined, body.token);
    expect((await current.json()).session.token).toBe(body.token);
    const other = await f.request("/get-session", undefined, otherToken);
    expect((await other.json()).session.token).toBe(otherToken);
  });

  test("password sign-in stamps server-owned proof and rejects forged client assurance fields", async () => {
    const f = await fixture();
    const { body } = await f.signIn({ assuranceVersion: 1, strongVerifiedAt: Date.now(), strongFactorId: "forged", strongFactorType: "totp" });
    const { session, client } = await f.caller(body.token);
    expect(session).toMatchObject({ authMethod: "password", assuranceVersion: 1, strongVerifiedAt: 0, strongFactorId: "" });
    const jwt = await f.request("/convex/token", undefined, body.token);
    expect(jwt.status, await jwt.clone().text()).toBe(200);
    await expect(client.mutation(assuranceApi.write, {})).resolves.toBeTypeOf("string");
    await f.setting("userMfaRequired", true);
    await expect(client.mutation(assuranceApi.write, {})).rejects.toThrow("NOT_AUTHENTICATED");
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "mfa_enrollment", allowed: false });
  });

  test("required TOTP enrollment grants access only after successful verification", async () => {
    const f = await fixture();
    await f.setting("userMfaRequired", true);
    const { body } = await f.signIn();
    const old = await f.caller(body.token);
    await expect(old.client.mutation(assuranceApi.write, {})).rejects.toThrow();
    const wrong = await f.request("/two-factor/verify-totp", { code: "000000" }, body.token);
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const enrolled = await f.enroll(body.token);
    const fresh = await f.caller(enrolled.token);
    expect(await fresh.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "ready", strong: true, recent: true });
    await expect(fresh.client.mutation(assuranceApi.write, {})).resolves.toBeTypeOf("string");
    expect(await old.client.query(api.platform.auth.getCurrentUser, {})).toBeNull();
  });

  test("administrator policy cannot be weakened by a first-factor session", async () => {
    const f = await fixture("admin");
    await f.setting("adminMfaRequired", true);
    const { body } = await f.signIn();
    const { client } = await f.caller(body.token);
    await expect(client.mutation(api.platform.appSettings.set, { key: "adminMfaRequired", value: "false" })).rejects.toThrow("NOT_AUTHENTICATED");
    expect((await f.request("/admin/set-role", { userId: f.user._id, role: "user" }, body.token)).status).toBe(403);
    expect(await client.query(api.platform.adminEmails.listProtected, {})).toEqual([]);
    const enrolled = await f.enroll(body.token);
    const strong = await f.caller(enrolled.token);
    await expect(strong.client.mutation(api.platform.appSettings.set, { key: "adminMfaRequired", value: "true" })).resolves.toBeNull();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await expect(strong.client.mutation(api.platform.appSettings.set, { key: "adminMfaRequired", value: "false" })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    expect((await f.request("/two-factor/verify-totp", { code: totp(enrolled.uri) }, enrolled.token)).status).toBe(200);
    await expect(strong.client.mutation(api.platform.appSettings.set, { key: "adminMfaRequired", value: "true" })).resolves.toBeNull();
  });

  test("disabled magic links cannot send mail or redeem an existing token", async () => {
    const f = await fixture();
    expect((await f.request("/sign-in/magic-link", { email: f.email, callbackURL: "/dashboard" })).status).toBe(403);
    expect(sendAuthEmail).not.toHaveBeenCalled();
    const now = Date.now();
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "verification", data: {
      identifier: "known-link-token", value: JSON.stringify({ email: f.email, name: "Fixture" }), createdAt: now, updatedAt: now, expiresAt: now + 300000,
    } } });
    expect((await f.request("/magic-link/verify?token=known-link-token&callbackURL=%2Fdashboard")).status).toBe(403);
    expect((await f.request("/sign-in/email-otp", { email: f.email, otp: "123456" })).status).toBe(403);
  });

  test("absolute administrator age and ban state apply to Convex and admin HTTP calls", async () => {
    const f = await fixture("admin");
    const { body } = await f.signIn();
    const { session, client } = await f.caller(body.token);
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: { expiresAt: Date.now() + 7 * 86400000 } } });
    vi.setSystemTime(Date.now() + 4 * 3600000 + 1);
    expect(await client.query(api.platform.auth.getCurrentUser, {})).toBeNull();
    expect((await f.request("/admin/list-users", undefined, body.token)).status).toBe(403);
    const banned = await fixture("admin");
    const bannedToken = (await banned.signIn()).body.token;
    const bannedCaller = await banned.caller(bannedToken);
    await banned.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: banned.user._id }], update: { banned: true } } });
    expect(await bannedCaller.client.query(assuranceApi.read, {})).toBeNull();
    expect((await banned.request("/admin/list-users", undefined, bannedToken)).status).toBe(403);
  });

  test("a session ID cannot be paired with a different JWT subject", async () => {
    const f = await fixture();
    const { body } = await f.signIn();
    const { session } = await f.caller(body.token);
    const now = Date.now();
    const other = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: "Other", email: "other@example.test", emailVerified: true, createdAt: now, updatedAt: now } } });
    const forged = f.t.withIdentity({ subject: other._id, sessionId: session._id });
    expect(await forged.query(api.platform.auth.getCurrentUser, {})).toBeNull();
    await expect(forged.mutation(assuranceApi.write, {})).rejects.toThrow("NOT_AUTHENTICATED");
  });

  test("an email-only session cannot bypass an enrolled factor or replace it", async () => {
    const f = await fixture();
    await f.setting("userMagicLinkEnabled", true);
    const initial = (await f.signIn()).body.token;
    const enrolled = await f.enroll(initial);
    const now = Date.now();
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "verification", data: {
      identifier: "email-only", value: JSON.stringify({ email: f.email }), createdAt: now, updatedAt: now, expiresAt: now + 300000,
    } } });
    const response = await f.request("/magic-link/verify?token=email-only");
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    const mail = await f.caller(body.token);
    expect(mail.session).toMatchObject({ authMethod: "magic-link", strongVerifiedAt: 0 });
    await expect(mail.client.mutation(assuranceApi.write, {})).rejects.toThrow();
    expect((await f.request("/two-factor/enable", { password }, body.token)).status).toBe(403);
    expect((await f.request("/passkey/generate-register-options", undefined, body.token)).status).toBe(403);
    expect((await f.request("/list-sessions", undefined, body.token)).status).toBe(403);
    const sessions = await f.t.fetch("/api/sessions", { headers: { authorization: `Bearer ${body.token}` } });
    expect(sessions.status).toBe(403);
    expect(await sessions.text()).not.toContain(enrolled.token);
    expect((await f.request("/two-factor/verify-totp", { code: totp(enrolled.uri) }, body.token)).status).toBe(200);
    await expect(mail.client.mutation(assuranceApi.write, {})).resolves.toBeTypeOf("string");
    await f.setting("userMagicLinkEnabled", false);
    expect(await mail.client.query(assuranceApi.read, {})).toBeNull();
  });

  test("password reauthentication cannot substitute for a required factor and wrong proofs spend a persistent budget", async () => {
    const f = await fixture();
    const token = (await f.signIn()).body.token;
    const { client } = await f.caller(token);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect((await f.request("/verify-password", { password }, token)).status).toBe(200);
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ recent: true, allowed: true });
    await f.setting("userMfaRequired", true);
    expect((await f.request("/verify-password", { password }, token)).status).toBe(200);
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ recent: false, allowed: false });
    for (let i = 0; i < 3; i++) expect((await f.request("/verify-password", { password: "wrong" }, token)).status).toBe(400);
    expect((await f.request("/verify-password", { password }, token)).status).toBe(429);
  });

  test("backup-code sign-in is restricted until the lost authenticator is replaced and verified", async () => {
    const f = await fixture();
    const enrolled = await f.enroll((await f.signIn()).body.token);
    const signIn = await f.signIn();
    expect(signIn.body.twoFactorRedirect).toBe(true);
    const cookie = signIn.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const result = await f.request("/two-factor/verify-backup-code", { code: enrolled.codes[0] }, undefined, cookie);
    const body = await result.json();
    expect(result.status, JSON.stringify(body)).toBe(200);
    const recovery = await f.caller(body.token);
    expect(await recovery.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "recovery", allowed: false });
    await expect(recovery.client.mutation(assuranceApi.write, {})).rejects.toThrow();
    expect((await f.request("/passkey/generate-register-options", undefined, body.token)).status).toBe(403);
    expect((await f.request("/list-sessions", undefined, body.token)).status).toBe(403);
    const sessions = await f.t.fetch("/api/sessions", { headers: { authorization: `Bearer ${body.token}` } });
    expect(sessions.status).toBe(403);
    expect(await sessions.text()).not.toContain(enrolled.token);
    vi.setSystemTime(Date.now() + 60_000);
    const replacement = await f.enroll(body.token);
    const recovered = await f.caller(replacement.token);
    expect(await recovered.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "ready", strong: true });
    await expect(recovered.client.mutation(assuranceApi.write, {})).resolves.toBeTypeOf("string");
    const former = await f.caller(enrolled.token);
    expect(await former.client.query(assuranceApi.read, {})).toBeNull();
  });

  test("only a cryptographically verified UV passkey assertion satisfies MFA", async () => {
    const f = await fixture();
    await f.setting("userMfaRequired", true);
    const passkey = await passkeyFixture(f);
    expect((await passkey.authenticate(false)).status).toBe(403);
    expect((await passkey.authenticate(false, true)).status).toBeGreaterThanOrEqual(400);
    const response = await passkey.authenticate(true);
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    const { session, client } = await f.caller(result.session.token);
    for (const field of ["assuranceVersion", "authMethod", "authenticatedAt", "primaryVerifiedAt", "strongVerifiedAt", "strongFactorId", "strongFactorType", "recoveryOnly", "recoveryFactorId"]) expect(result.session).not.toHaveProperty(field);
    expect(session).toMatchObject({ authMethod: "passkey", strongFactorId: passkey.key._id, strongFactorType: "passkey", recoveryOnly: false });
    const forged = await f.request("/update-session", { assuranceVersion: 99, authenticatedAt: Date.now() + 86400000, primaryVerifiedAt: 1, strongVerifiedAt: 1, strongFactorId: "forged", strongFactorType: "totp", authMethod: "password", recoveryOnly: true, recoveryFactorId: "forged" }, result.session.token);
    expect(forged.status).toBe(400);
    expect((await f.caller(result.session.token)).session).toEqual(session);
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: true, strong: true, hasTotp: false });
    await expect(client.mutation(assuranceApi.write, {})).resolves.toBeTypeOf("string");
    await f.setting("userPasskeyPolicy", "disabled");
    expect(await client.query(assuranceApi.read, {})).toBeNull();
  });

  test("removing a passkey invalidates sessions authenticated with that credential", async () => {
    const f = await fixture();
    const passkey = await passkeyFixture(f);
    const response = await passkey.authenticate(true);
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    const { client } = await f.caller(result.session.token);
    await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "passkey", where: [{ field: "_id", value: passkey.key._id }] } });
    expect(await client.query(assuranceApi.read, {})).toBeNull();
  });

  test("unverified and compound-role administrators cannot select a weaker user policy", async () => {
    const f = await fixture("admin,user");
    await f.setting("adminMfaRequired", true);
    await f.setting("userMfaRequired", false);
    const token = (await f.signIn()).body.token;
    const { client } = await f.caller(token);
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ scope: "admin", mfaRequired: true, allowed: false });
    expect((await f.request("/admin/list-users", undefined, token)).status).toBe(403);
    const other = await fixture("admin");
    const otherToken = (await other.signIn()).body.token;
    const otherClient = await other.caller(otherToken);
    await other.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: other.user._id }], update: { emailVerified: false } } });
    expect(await otherClient.client.query(api.platform.adminEmails.listProtected, {})).toEqual([]);
    expect((await other.request("/admin/list-users", undefined, otherToken)).status).toBe(403);
  });
  test("required passkeys apply to the current session, including a policy change", async () => {
    const f = await fixture();
    const token = (await f.signIn()).body.token;
    const passwordSession = await f.caller(token);
    await f.setting("userPasskeyPolicy", "required");
    expect(await passwordSession.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "passkey_enrollment", allowed: false });
    const key = await passkeyFixture(f);
    expect(await passwordSession.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "passkey_verification", allowed: false });
    const response = await key.authenticate(true);
    const result = await response.json();
    expect(response.status).toBe(200);
    const proved = await f.caller(result.session.token);
    expect(await proved.client.query(assuranceApi.read, {})).toBe(f.user._id);
    expect(await passwordSession.client.query(assuranceApi.read, {})).toBeNull();
  });

  test("legacy sessions must reauthenticate and password proof cannot clear recovery", async () => {
    const f = await fixture();
    const token = (await f.signIn()).body.token;
    const { session, client } = await f.caller(token);
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: { assuranceVersion: 0, primaryVerifiedAt: 0 } } });
    expect(await client.query(assuranceApi.read, {})).toBeNull();
    expect((await f.request("/verify-password", { password: "wrong" }, token)).status).toBe(400);
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "reauthenticate" });
    expect((await f.request("/verify-password", { password }, token)).status).toBe(200);
    expect(await client.query(assuranceApi.read, {})).toBe(f.user._id);
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: session._id }], update: { recoveryOnly: true } } });
    expect((await f.request("/verify-password", { password }, token)).status).toBe(200);
    expect(await client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "recovery", allowed: false });
  });

  test("administrator password rotation and password step-up preserve the absolute deadline", async () => {
    const f = await fixture("admin");
    const token = (await f.signIn()).body.token;
    const start = Date.now();
    vi.setSystemTime(start + 3 * 3600000);
    expect((await f.request("/verify-password", { password }, token)).status).toBe(200);
    const changed = await f.request("/change-password", { currentPassword: password, newPassword: "orchid quartz lantern telescope meadow violin glacier", revokeOtherSessions: true }, token);
    const body = await changed.json();
    expect(changed.status, JSON.stringify(body)).toBe(200);
    const current = await f.caller(body.token);
    expect(current.session.authenticatedAt).toBe(start);
    vi.setSystemTime(start + 4 * 3600000 + 1);
    expect(await current.client.query(api.platform.auth.getCurrentUser, {})).toBeNull();
    expect((await f.request("/verify-password", { password }, body.token)).status).toBe(403);
  });

  test("every installed sensitive or admin HTTP route rejects a limited session", async () => {
    const f = await fixture("admin");
    const token = (await f.signIn()).body.token;
    await f.setting("adminMfaRequired", true);
    const options = createAuthOptions({} as never);
    const routes = Object.values(getEndpoints({} as never, options).api).filter(endpoint => typeof endpoint.path === "string");
    let checked = 0;
    for (const endpoint of routes) {
      const policy = authRoutePolicy(endpoint.path!);
      if (!["sensitive", "admin", "disabled"].includes(policy) || endpoint.options.metadata?.SERVER_ONLY) continue;
      const method = Array.isArray(endpoint.options.method) ? endpoint.options.method[0] : endpoint.options.method ?? "POST";
      const response = await f.request(endpoint.path!, method === "GET" ? undefined : {
        userId: f.user._id, role: "admin", email: f.email, password, currentPassword: password, newPassword: password,
        name: "Fixture", id: "fixture", providerId: "credential", provider: "google", token: "fixture", callbackURL: "/dashboard",
      }, token);
      expect(response.status, `${method} ${endpoint.path}: ${await response.clone().text()}`).toBe(403);
      checked++;
    }
    expect(checked).toBeGreaterThan(25);
    expect(authRoutePolicy("/future-plugin/privilege")).toBe("disabled");
  });

  test("trusted-device password sign-in still needs fresh session factor proof", async () => {
    const f = await fixture();
    const enrolled = await f.enroll((await f.signIn()).body.token);
    const first = await f.signIn();
    const cookie = first.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const verified = await f.request("/two-factor/verify-totp", { code: totp(enrolled.uri), trustDevice: true }, undefined, cookie);
    expect(verified.status).toBe(200);
    const trust = verified.headers.getSetCookie().filter(value => value.includes("trust_device")).map(value => value.split(";")[0]).join("; ");
    expect(trust).not.toBe("");
    const response = await f.request("/sign-in/email", { email: f.email, password }, undefined, trust);
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.twoFactorRedirect).not.toBe(true);
    const limited = await f.caller(result.token);
    expect(await limited.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "mfa_verification", strong: false });
    expect(await limited.client.query(assuranceApi.read, {})).toBeNull();
    expect((await f.request("/two-factor/verify-totp", { code: totp(enrolled.uri) }, result.token)).status).toBe(200);
    expect(await limited.client.query(assuranceApi.read, {})).toBe(f.user._id);
  });

  test("email OTP in a password challenge never supplies strong authentication", async () => {
    const f = await fixture();
    await f.enroll((await f.signIn()).body.token);
    const first = await f.signIn();
    const cookie = first.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    expect((await f.request("/two-factor/send-otp", {}, undefined, cookie)).status).toBe(200);
    const code = vi.mocked(sendAuthEmail).mock.calls.at(-1)![0].urlOrCode;
    const response = await f.request("/two-factor/verify-otp", { code }, undefined, cookie);
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    const limited = await f.caller(result.token);
    expect(await limited.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "mfa_verification", strong: false });
    expect(await limited.client.query(assuranceApi.read, {})).toBeNull();
    expect((await f.request("/list-sessions", undefined, result.token)).status).toBe(403);
  });

});

const passwordRoutes = [
  ["/verify-password", { password: "wrong" }],
  ["/change-password", { currentPassword: "wrong", newPassword: "orchid quartz lantern telescope meadow violin glacier" }],
  ["/two-factor/enable", { password: "wrong" }],
  ["/two-factor/disable", { password: "wrong" }],
  ["/two-factor/get-totp-uri", { password: "wrong" }],
  ["/two-factor/generate-backup-codes", { password: "wrong" }],
] as const;
test.each(passwordRoutes)("%s spends exactly one durable account attempt per request", async (path, body) => {
  const f = await fixture();
  const enrolled = await f.enroll((await f.signIn()).body.token);
  const login = await f.signIn();
  const challenge = login.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const verified = await f.request("/two-factor/verify-totp", { code: totp(enrolled.uri) }, undefined, challenge);
  expect(verified.status).toBe(200);
  const cookie = verified.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  vi.setSystemTime(Date.now() + 60_000);
  for (let i = 0; i < 5; i++) {
    const response = i % 2 ? await f.request(path, body, undefined, cookie) : await f.request(path, body, enrolled.token);
    expect(response.status, await response.clone().text()).toBe(400);
  }
  expect((await f.request("/verify-password", { password }, enrolled.token)).status).toBe(429);
  expect((await f.request(path, body, undefined, cookie)).status).toBe(429);
  vi.setSystemTime(Date.now() + 60_000);
  expect((await f.request("/verify-password", { password }, enrolled.token)).status).toBe(200);
});
test("recovery TOTP replacement shares the password account budget", async () => {
  const f = await fixture();
  const enrolled = await f.enroll((await f.signIn()).body.token);
  const login = await f.signIn();
  const cookie = login.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const response = await f.request("/two-factor/verify-backup-code", { code: enrolled.codes[0] }, undefined, cookie);
  expect(response.status).toBe(200);
  const recovery = await response.json();
  vi.setSystemTime(Date.now() + 60_000);
  for (let i = 0; i < 5; i++) expect((await f.request("/two-factor/enable", { password: "wrong" }, recovery.token)).status).toBe(400);
  expect((await f.request("/two-factor/enable", { password }, recovery.token)).status).toBe(429);
  expect((await f.request("/verify-password", { password }, enrolled.token)).status).toBe(429);
});

async function recoveryFixture(role = "user") {
  const f = await fixture(role);
  const enrolled = await f.enroll((await f.signIn()).body.token);
  const login = await f.signIn();
  const cookie = login.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const response = await f.request("/two-factor/verify-backup-code", { code: enrolled.codes[0] }, undefined, cookie);
  expect(response.status).toBe(200);
  const recovery = await response.json();
  vi.setSystemTime(Date.now() + 60_000);
  return { ...f, enrolled, recovery, recoveryCaller: await f.caller(recovery.token) };
}

test("an original TOTP, another factor and password reauthentication cannot clear recovery", async () => {
  const f = await recoveryFixture();
  expect((await f.request("/verify-password", { password }, f.recovery.token)).status).toBe(200);
  expect((await f.request("/two-factor/verify-totp", { code: totp(f.enrolled.uri) }, f.recovery.token)).status).toBe(403);
  const factor = await f.t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: f.user._id }] });
  await expect(f.t.mutation(internal.platform.sessionAssurance.recordProof, { userId: f.user._id, sessionId: f.recoveryCaller.session._id, kind: "totp", factorId: factor!._id, factorSecret: factor!.secret })).rejects.toThrow("RECOVERY_REQUIRED");
  await expect(f.t.mutation(internal.platform.sessionAssurance.recordProof, { userId: f.user._id, sessionId: f.recoveryCaller.session._id, kind: "passkey", factorId: "another-factor" })).rejects.toThrow("RECOVERY_REQUIRED");
  expect((await f.request("/update-session", { recoveryOnly: false, recoveryFactorId: factor!._id }, f.recovery.token)).status).toBe(403);
  expect(await f.recoveryCaller.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ reason: "recovery", allowed: false });
  await expect(f.recoveryCaller.client.mutation(assuranceApi.write, {})).rejects.toThrow();
});

test.each([false, true])("password-authorized replacement resumes and preserves its binding through native rotation (rotate=%s)", async rotate => {
  const f = await recoveryFixture();
  if (rotate) {
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "userId", value: f.user._id }], update: { verified: false } } });
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: f.user._id }], update: { twoFactorEnabled: false } } });
  }
  expect((await f.request("/two-factor/enable", { password: "wrong" }, f.recovery.token)).status).toBe(400);
  expect((await f.caller(f.recovery.token)).session.recoveryFactorId).toBeFalsy();
  const enabled = await f.request("/two-factor/enable", { password }, f.recovery.token);
  const replacement = await enabled.json();
  expect(enabled.status, JSON.stringify(replacement)).toBe(200);
  const pending = await f.caller(f.recovery.token);
  const factor = await f.t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: f.user._id }] });
  expect(pending.session).toMatchObject({ recoveryOnly: true, recoveryFactorId: factor!._id });
  expect(await pending.client.query(assuranceApi.read, {})).toBeNull();
  vi.setSystemTime(Date.now() + 6 * 60_000);
  const verified = await f.request("/two-factor/verify-totp", { code: totp(replacement.totpURI) }, f.recovery.token);
  expect(verified.status, await verified.clone().text()).toBe(200);
  const sessions = await f.t.query(components.betterAuth.adapter.findMany, { model: "session", where: [{ field: "userId", value: f.user._id }], paginationOpts: { cursor: null, numItems: 100 } });
  const fresh = sessions.page.find(row => row.strongFactorId === factor!._id)!;
  expect(fresh).toMatchObject({ recoveryOnly: false, recoveryFactorId: "", authenticatedAt: pending.session.authenticatedAt, authMethod: pending.session.authMethod, primaryVerifiedAt: pending.session.primaryVerifiedAt });
  const caller = await f.caller(fresh.token);
  expect(await caller.client.query(assuranceApi.read, {})).toBe(f.user._id);
  await expect(caller.client.action(api.platform.auth.viewBackupCodes, { password })).resolves.toEqual(replacement.backupCodes);
  if (rotate) expect(fresh.token).not.toBe(f.recovery.token);
});

test.each(["password", "secret", "factor", "session", "user"])("replacement binding rejects a racing %s change", async change => {
  const f = await recoveryFixture();
  const response = await f.request("/two-factor/enable", { password }, f.recovery.token);
  expect(response.status).toBe(200);
  const factor = (await f.t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: f.user._id }] }))!;
  const args = { userId: f.user._id, sessionId: f.recoveryCaller.session._id, factorId: factor._id, factorSecret: factor.secret, passwordHash };
  await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: f.recoveryCaller.session._id }], update: { recoveryFactorId: "" } } });
  if (change === "password") await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "account", where: [{ field: "userId", value: f.user._id }], update: { password: "changed-after-check" } } });
  if (change === "secret") await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }], update: { secret: "changed-after-check" } } });
  if (change === "factor") await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }] } });
  if (change === "session") await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: f.recoveryCaller.session._id }] } });
  if (change === "user") await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "twoFactor", where: [{ field: "_id", value: factor._id }], update: { userId: "another-user" } } });
  await expect(f.t.mutation(internal.platform.sessionAssurance.bindRecoveryReplacement, args)).rejects.toThrow();
  await expect(f.t.mutation(internal.platform.sessionAssurance.recordProof, { userId: f.user._id, sessionId: f.recoveryCaller.session._id, kind: "totp", factorId: factor._id, factorSecret: factor.secret })).rejects.toThrow();
  expect(await f.recoveryCaller.client.query(assuranceApi.read, {})).toBeNull();
});

test("a second replacement in another session cannot satisfy the recovery binding", async () => {
  const f = await recoveryFixture();
  const first = await f.request("/two-factor/enable", { password }, f.recovery.token);
  expect(first.status).toBe(200);
  vi.setSystemTime(Date.now() + 60_000);
  expect((await f.request("/two-factor/verify-totp", { code: totp((await first.json()).totpURI) }, f.enrolled.token)).status).toBe(200);
  const second = await f.request("/two-factor/enable", { password }, f.enrolled.token);
  expect(second.status).toBe(200);
  const replacement = await second.json();
  expect((await f.request("/two-factor/verify-totp", { code: totp(replacement.totpURI) }, f.recovery.token)).status).toBe(403);
  expect(await f.recoveryCaller.client.query(assuranceApi.read, {})).toBeNull();
});

test("administrator active-session OTP enrollment and TOTP preserve the four-hour deadline", async () => {
  const f = await fixture("admin");
  const initial = (await f.signIn()).body.token;
  const start = (await f.caller(initial)).session.authenticatedAt!;
  vi.setSystemTime(start + 239 * 60_000);
  expect((await f.request("/verify-password", { password }, initial)).status).toBe(200);
  const source = (await f.caller(initial)).session;
  const enabled = await f.request("/two-factor/enable", { password }, initial);
  const setup = await enabled.json(); expect(enabled.status).toBe(200);
  expect((await f.request("/two-factor/send-otp", {}, initial)).status).toBe(200);
  const code = vi.mocked(sendAuthEmail).mock.calls.at(-1)![0].urlOrCode;
  const verified = await f.request("/two-factor/verify-otp", { code }, initial);
  const body = await verified.json(); expect(verified.status, JSON.stringify(body)).toBe(200);
  expect(body.token).not.toBe(initial);
  const rotated = await f.caller(body.token);
  expect(rotated.session).toMatchObject({ authenticatedAt: source.authenticatedAt, primaryVerifiedAt: source.primaryVerifiedAt, authMethod: source.authMethod, strongVerifiedAt: source.strongVerifiedAt, recoveryOnly: source.recoveryOnly, expiresAt: start + 4 * 3600000 });
  expect(await rotated.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: false, strong: false });
  expect((await f.request("/two-factor/verify-totp", { code: totp(setup.totpURI) }, body.token)).status).toBe(200);
  expect(await rotated.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: true, strong: true });
  await expect(rotated.client.mutation(api.platform.appSettings.set, { key: "adminMfaRequired", value: "true" })).resolves.toBeNull();
  vi.setSystemTime(start + 4 * 3600000 + 1);
  expect(await rotated.client.query(api.platform.auth.getCurrentUser, {})).toBeNull();
  expect((await f.request("/admin/list-users", undefined, body.token)).status).toBe(403);
});

test.each(["password", "factor", "session"])("HTTP replacement cannot complete after a %s race during successful password checking", async change => {
  const f = await recoveryFixture();
  const createHooks = assuranceHooks.createAssuranceHooks;
  let raced = false;
  const spy = vi.spyOn(assuranceHooks, "createAssuranceHooks").mockImplementation(ctx => {
    const action = requireActionCtx(ctx);
    const runMutation: typeof action.runMutation = async (ref, args) => {
      if (!raced && getFunctionName(ref) === "platform/sessionAssurance:bindRecoveryReplacement") {
        raced = true;
        if (change === "password") await action.runMutation(components.betterAuth.adapter.updateOne, { input: { model: "account", where: [{ field: "userId", value: f.user._id }], update: { password: "changed-after-successful-check" } } });
        if (change === "factor") await action.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "twoFactor", where: [{ field: "userId", value: f.user._id }] } });
        if (change === "session") await action.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: f.recoveryCaller.session._id }] } });
      }
      return action.runMutation(ref, args);
    };
    return createHooks({ ...action, runMutation });
  });
  try {
    const response = await f.request("/two-factor/enable", { password }, f.recovery.token);
    expect(raced).toBe(true);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await f.recoveryCaller.client.query(assuranceApi.read, {})).toBeNull();
    const session = await f.t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "_id", value: f.recoveryCaller.session._id }] });
    expect(session?.recoveryFactorId).toBeFalsy();
  } finally { spy.mockRestore(); }
});

test("auth-only-origin login creates a restricted session and cannot access general admin APIs", async () => {
  vi.stubEnv("AGENT_MCP_AUTH_ORIGIN", "http://mcp-auth.localhost:3001");
  vi.stubEnv("SITE_URL", "http://localhost:3001,http://mcp-auth.localhost:3001");
  const f = await fixture("admin");
  const response = await f.t.fetch("/api/auth/sign-in/email", { method: "POST", headers: { origin: "http://mcp-auth.localhost:3001", "content-type": "application/json" }, body: JSON.stringify({ email: f.email, password }) });
  expect(response.status, await response.clone().text()).toBe(200);
  const token = (await response.json()).token;
  const { session, client } = await f.caller(token);
  expect(session.authPurpose).toBe("mcp-authorization");
  expect(await client.query(api.platform.announcements.list, {})).toBeNull();
  await expect(client.mutation(api.platform.announcements.create, { name: "Forbidden", bannerText: "Forbidden" })).rejects.toThrow("NOT_AUTHENTICATED");
  const administrative = await f.request("/admin/list-users", undefined, token);
  expect(administrative.status).toBe(403);
  expect(await administrative.text()).toContain("OPERATOR_API_REQUIRED");
  const verify = await f.request("/verify-password", { password }, token);
  expect(verify.status).toBe(200);
  expect((await f.caller(token)).session.authPurpose).toBe("mcp-authorization");
  const again = await f.request("/sign-in/email", { email: f.email, password }, token);
  expect(again.status).toBe(200);
  const replacement = (await again.json()).token;
  expect((await f.caller(replacement)).session.authPurpose).toBe("mcp-authorization");
});

test("auth-only TOTP verification and JWT issuance preserve isolation through consent", async () => {
  const authOrigin = "http://mcp-auth.localhost:3001";
  const resource = "http://localhost:3001/api/mcp";
  vi.stubEnv("AGENT_MCP_AUTH_ORIGIN", authOrigin);
  vi.stubEnv("AGENT_MCP_RESOURCE", resource);
  vi.stubEnv("SITE_URL", `http://localhost:3001,${authOrigin}`);
  const f = await fixture("admin");
  const enrolled = await f.enroll((await f.signIn()).body.token);
  const application = await f.caller(enrolled.token);
  await application.client.mutation(api.platform.agentSurfaces.setEnabled, { surface: "mcp", enabled: true });
  vi.setSystemTime(Date.now() + 30_000);
  const signIn = await f.t.fetch("/api/auth/sign-in/email", { method: "POST", headers: { origin: authOrigin, "content-type": "application/json" }, body: JSON.stringify({ email: f.email, password }) });
  expect(signIn.status).toBe(200);
  expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
  const cookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const verified = await f.t.fetch("/api/auth/two-factor/verify-totp", { method: "POST", headers: { origin: authOrigin, "content-type": "application/json", cookie }, body: JSON.stringify({ code: totp(enrolled.uri) }) });
  expect(verified.status).toBe(200);
  const token = (await verified.json()).token;
  const authorization = await f.caller(token);
  expect(await authorization.client.query(api.platform.sessionAssurance.status, {})).toMatchObject({ authPurpose: "mcp-authorization", strong: true, recent: true, allowed: true });
  const jwt = await f.request("/convex/token", undefined, token);
  expect(jwt.status).toBe(200);
  expect(typeof (await jwt.json()).token).toBe("string");
  await expect(authorization.client.action(api.platform.auth.viewBackupCodes, { password })).rejects.toThrow("NOT_AUTHENTICATED");
  const backup = await f.t.fetch("/api/two-factor/backup-codes", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ password }) });
  expect(backup.status).toBe(403);
  expect(await backup.json()).toEqual({ error: "REAUTHENTICATION_REQUIRED" });
  expect(await authorization.client.query(api.platform.adminInvitations.getMyOnboardingStatus, {})).toBeNull();
  for (const step of [1, 2, 3]) await expect(authorization.client.mutation(api.platform.adminInvitations.advanceOnboardingStep, { step })).rejects.toThrow("NOT_AUTHENTICATED");
  await expect(authorization.client.mutation(api.platform.adminInvitations.completeOnboarding, {})).rejects.toThrow("NOT_AUTHENTICATED");
  const verifier = "v".repeat(64);
  const request = { clientId: "pi-announcements", redirectUri: "http://127.0.0.1:45991/callback", resource, scope: "admin:manage", challenge: createHash("sha256").update(verifier).digest("base64url") };
  const { code } = await authorization.client.mutation(api.platform.agentAccess.authorize, request);
  expect(await authorization.client.query(api.platform.auth.getCurrentUser, {})).toBeNull();
  const grant = await f.t.mutation(api.platform.agentAccess.exchange, { code, verifier, clientId: request.clientId, redirectUri: request.redirectUri, resource });
  expect(await f.t.query(api.platform.agentCapabilities.catalogue, { token: grant.access_token, resource })).not.toHaveLength(0);
  expect(await application.client.action(api.platform.auth.viewBackupCodes, { password })).toEqual(enrolled.codes);
  expect(await application.client.query(api.platform.adminInvitations.getMyOnboardingStatus, {})).toMatchObject({ completed: true });
});
