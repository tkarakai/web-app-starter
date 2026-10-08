import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { sendAuthEmail } from "./sendAuthEmail";

vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
const authModules = import.meta.glob("./betterAuth/**/*.*s");
const password = "violet compass timber waterfall oyster constellation";
const newPassword = "orchid quartz lantern telescope meadow violin glacier";
const codes = ["fixture-first-code", "fixture-second-code"];
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword(password); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("BETTER_AUTH_SECRET", "recovery-fixture-secret-at-least-32-characters");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.pwnedpasswords.com/range/")) return new Response("00000000000000000000000000000000000:0");
    throw new Error("Unexpected outbound request");
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture(encrypted = true) {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, authModules);
  const now = Date.now();
  const user = await t.mutation(components.betterAuth.adapter.create, { input: {
    model: "user", data: { name: "Recovery", email: "recovery@example.test", emailVerified: true,
      createdAt: now, updatedAt: now, twoFactorEnabled: true },
  } });
  const account = await t.mutation(components.betterAuth.adapter.create, { input: {
    model: "account", data: { userId: user._id, accountId: user._id, providerId: "credential",
      password: passwordHash, createdAt: now, updatedAt: now },
  } });
  const factor = await t.mutation(components.betterAuth.adapter.create, { input: {
    model: "twoFactor", data: { userId: user._id, secret: "unused-by-these-tests", verified: true,
      backupCodes: encrypted ? await symmetricEncrypt({ key: process.env.BETTER_AUTH_SECRET!, data: JSON.stringify(codes) }) : JSON.stringify(codes) },
  } });
  async function addSession(token: string) {
    const session = await t.mutation(components.betterAuth.adapter.create, { input: {
      model: "session", data: { strongVerifiedAt: now, strongFactorId: factor._id, strongFactorType: "totp", assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now, userId: user._id, token, createdAt: now, updatedAt: now, expiresAt: now + 7 * 86400000 },
    } });
    return { session, caller: t.withIdentity({ subject: user._id, sessionId: session._id }) };
  }
  const first = await addSession("first-session");
  const second = await addSession("second-session");
  const http = (path: string, body?: unknown, token = first.session.token) => t.fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { t, user, account, first, second, http };
}

describe("recovery-secret reauthentication", () => {
  test.each([true, false])("authorization-only sessions cannot disclose recovery secrets through either transport (encrypted=%s)", async encrypted => {
    const f = await fixture(encrypted);
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: f.user._id }], update: { role: "admin" } } });
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: f.first.session._id }], update: { authPurpose: "mcp-authorization" } } });
    const factor = () => f.t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: f.user._id }] });
    const before = await factor();
    await expect(f.t.query(internal.platform.recoveryCodes.snapshot, { userId: f.user._id, sessionId: f.first.session._id })).rejects.toThrow("NOT_AUTHENTICATED");
    await expect(f.first.caller.action(api.platform.auth.viewBackupCodes, { password })).rejects.toThrow("NOT_AUTHENTICATED");
    const response = await f.http("/api/two-factor/backup-codes", { password });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "REAUTHENTICATION_REQUIRED" });
    expect(await factor()).toEqual(before);
    expect(await f.first.caller.query(api.platform.sessionAssurance.status, {})).toMatchObject({ allowed: true, recent: true, strong: true, authPurpose: "mcp-authorization" });
    await expect(f.second.caller.action(api.platform.auth.viewBackupCodes, { password })).resolves.toEqual(codes);
    const normal = await f.http("/api/two-factor/backup-codes", { password }, f.second.session.token);
    expect(normal.status).toBe(200);
    expect(await normal.json()).toEqual({ backupCodes: codes });
  });
  test.each([true, false])("current password also needs recent factor proof (encrypted=%s)", async (encrypted) => {
    const f = await fixture(encrypted);
    vi.setSystemTime(Date.now() + 86400000);
    await expect(f.first.caller.action(api.platform.auth.viewBackupCodes, { password })).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "_id", value: f.first.session._id }], update: { strongVerifiedAt: Date.now() } } });
    await expect(f.first.caller.action(api.platform.auth.viewBackupCodes, { password })).resolves.toEqual(codes);
    await expect(f.first.caller.action(api.platform.auth.viewBackupCodes, {})).rejects.toThrow("REAUTHENTICATION_REQUIRED");
  });
  test("anonymous, wrong-password and missing-password calls never disclose codes", async () => {
    const f = await fixture();
    await expect(f.t.action(api.platform.auth.viewBackupCodes, { password })).rejects.toThrow("NOT_AUTHENTICATED");
    for (const args of [{}, { password: "wrong" }]) {
      await expect(f.first.caller.action(api.platform.auth.viewBackupCodes, args)).rejects.toThrow("REAUTHENTICATION_REQUIRED");
    }
  });
  test("HTTP GET is retired and POST requires the same proof", async () => {
    const f = await fixture();
    expect((await f.http("/api/two-factor/backup-codes")).status).toBe(405);
    for (const args of [{}, { password: "wrong" }]) {
      expect((await f.http("/api/two-factor/backup-codes", args)).status).toBe(403);
    }
    const response = await f.http("/api/two-factor/backup-codes", { password });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ backupCodes: codes });
  });
  test("failed guesses share a durable per-user budget across transports and sessions", async () => {
    const f = await fixture();
    await Promise.all(Array.from({ length: 5 }, () =>
      expect(f.first.caller.action(api.platform.auth.viewBackupCodes, { password: "wrong" })).rejects.toThrow("REAUTHENTICATION_REQUIRED")));
    expect((await f.http("/api/two-factor/backup-codes", { password }, f.second.session.token)).status).toBe(429);
    await expect(f.second.caller.action(api.platform.auth.viewBackupCodes, { password })).rejects.toThrow("RATE_LIMITED");
  });
  test.each([true, false])("when email verification is optional, unverified accounts still need password and factor proof (encrypted=%s)", async (encrypted) => {
    const f = await fixture(encrypted);
    await f.t.mutation(components.platform.appSettings.putRaw, { key: "userEmailVerificationRequired", value: "false" });
    await f.t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "user", where: [{ field: "_id", value: f.user._id }], update: { emailVerified: false } },
    });
    for (const args of [{}, { password: "wrong" }]) {
      await expect(f.first.caller.action(api.platform.auth.viewBackupCodes, args)).rejects.toThrow("REAUTHENTICATION_REQUIRED");
      expect((await f.http("/api/two-factor/backup-codes", args)).status).toBe(403);
    }
    await expect(f.first.caller.action(api.platform.auth.viewBackupCodes, { password })).resolves.toEqual(codes);
    const response = await f.http("/api/two-factor/backup-codes", { password });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ backupCodes: codes });
  });
  test.each(["revoked", "expired", "banned"])("a %s session cannot disclose codes even with the correct password", async (state) => {
    const f = await fixture();
    if (state === "revoked") await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "session", where: [{ field: "_id", value: f.first.session._id }] },
    });
    if (state === "expired") vi.setSystemTime(Date.now() + 8 * 86400000);
    if (state === "banned") await f.t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "user", where: [{ field: "_id", value: f.user._id }], update: { banned: true } },
    });
    await expect(f.first.caller.action(api.platform.auth.viewBackupCodes, { password })).rejects.toThrow("NOT_AUTHENTICATED");
  });
  test("factor enrollment and code regeneration still require an actual current password over HTTP", async () => {
    const f = await fixture();
    for (const path of ["/api/auth/two-factor/enable", "/api/auth/two-factor/generate-backup-codes"]) {
      for (const body of [{}, { password: "wrong" }]) {
        const response = await f.http(path, body);
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
    }
    const response = await f.http("/api/auth/two-factor/generate-backup-codes", { password });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.backupCodes).toHaveLength(10);
    expect(result.backupCodes).not.toEqual(codes);
    expect(await f.first.caller.action(api.platform.auth.viewBackupCodes, { password })).toEqual(result.backupCodes);
  });
});

describe("password reset session containment", () => {
  test("an invalid reset leaves legitimate sessions intact", async () => {
    const f = await fixture();
    expect((await f.http("/api/auth/reset-password", { token: "invalid", newPassword })).status).toBe(400);
    expect(await f.first.caller.query(api.projects.list, {})).toEqual([]);
    expect(await f.second.caller.query(api.projects.list, {})).toEqual([]);
  });
  test("the installed email-OTP reset route also revokes all existing sessions", async () => {
    const f = await fixture();
    expect((await f.http("/api/auth/email-otp/request-password-reset", { email: f.user.email })).status).toBe(200);
    const otp = vi.mocked(sendAuthEmail).mock.calls.at(-1)?.[0].urlOrCode;
    expect(otp).toMatch(/^\d{6}$/);
    const response = await f.http("/api/auth/email-otp/reset-password", { email: f.user.email, otp, password: newPassword });
    expect(response.status).toBe(200);
    expect(await f.first.caller.query(api.projects.list, {})).toBeNull();
    expect(await f.second.caller.query(api.projects.list, {})).toBeNull();
  });
  test("reset evicts every old session from HTTP and Convex, but permits a new password sign-in", async () => {
    const f = await fixture();
    // This case isolates credential reset from the independently enforced TOTP challenge.
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: {
      model: "user", where: [{ field: "_id", value: f.user._id }], update: { twoFactorEnabled: false },
    } });
    await f.t.mutation(components.betterAuth.adapter.create, { input: {
      model: "verification", data: { identifier: "reset-password:reset-fixture", value: f.user._id,
        expiresAt: Date.now() + 300000, createdAt: Date.now(), updatedAt: Date.now() },
    } });
    expect(await f.first.caller.query(api.projects.list, {})).toEqual([]);
    const reset = await f.http("/api/auth/reset-password", { token: "reset-fixture", newPassword });
    expect(reset.status).toBe(200);
    await Promise.all([f.first, f.second].map(async ({ session, caller }) => {
      expect(await caller.query(api.projects.list, {})).toBeNull();
      await expect(caller.mutation(api.projects.create, { name: "Denied", description: "" })).rejects.toThrow("NOT_AUTHENTICATED");
      await expect(caller.action(api.platform.auth.viewBackupCodes, { password: newPassword })).rejects.toThrow("NOT_AUTHENTICATED");
      expect((await f.http("/api/sessions", undefined, session.token)).status).toBe(401);
      expect(await (await f.http("/api/auth/get-session", undefined, session.token)).json()).toBeNull();
    }));
    const signedIn = await f.http("/api/auth/sign-in/email", { email: f.user.email, password: newPassword });
    expect(signedIn.status).toBe(200);
    const { token } = await signedIn.json();
    const session = await f.t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "token", value: token }] });
    expect(session).not.toBeNull();
    expect(await f.t.withIdentity({ subject: f.user._id, sessionId: session!._id }).query(api.projects.list, {})).toEqual([]);
    expect((await f.http("/api/auth/reset-password", { token: "reset-fixture", newPassword })).status).toBe(400);
  });
});
