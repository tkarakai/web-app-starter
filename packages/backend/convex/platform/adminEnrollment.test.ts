import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestEnv } from "../test.modules";
import { api, components, internal } from "../_generated/api";
import schema from "./betterAuth/schema";
import { sha256Hex } from "./tokenHash";

vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
const authModules = import.meta.glob("./betterAuth/**/*.*s");
const password = "orchid quartz lantern telescope meadow violin glacier";
const email = "owner@example.test";
const token = "0123456789abcdef".repeat(4);
function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", schema, authModules);
  return t;
}
type Env = ReturnType<typeof fixture>;
async function invite(t: Env, kind: "bootstrap" | "admin" = "bootstrap") {
  if (kind === "bootstrap") {
    await t.mutation(internal.platform.bootstrap.initialize, { email });
    const state = await t.query(components.platform.waitlistBootstrap.state, { email });
    await t.mutation(components.platform.waitlistTokens.create, { waitlistEntryId: state.waitlistEntry!._id, email, tokenHash: sha256Hex(token), expiresAt: Date.now() + 3600000 });
  } else {
    const row = await t.mutation(components.platform.adminInvitations.invite, { email, identity: { userId: "existing-admin", actor: "existing@example.test" } });
    await t.mutation(components.platform.adminInvitations.setToken, { adminInvitationId: row.adminInvitationId, tokenHash: sha256Hex(token), expiresAt: Date.now() + 3600000 });
  }
}
async function user(t: Env) {
  return t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] });
}
async function session(t: Env, id: string) {
  const now = Date.now();
  const row = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
    userId: id, token: `session-${id}`, expiresAt: now + 86400000, createdAt: now, updatedAt: now,
  } } });
  return t.withIdentity({ subject: id, sessionId: row._id });
}

async function verifiedFactor(t: Env, userId: string) {
  const factor = await t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: { userId, secret: "fixture", backupCodes: "fixture", verified: true } } });
  await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "token", value: `session-${userId}` }], update: { strongVerifiedAt: Date.now(), strongFactorId: factor._id, strongFactorType: "totp" } } });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("BETTER_AUTH_SECRET", "enrollment-test-secret-at-least-32-characters");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.stubEnv("ADMIN_SITE_URL", "http://localhost:3001");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("00000000000000000000000000000000000:0")));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("administrator enrollment", () => {
  test.each(["bootstrap", "admin"] as const)("authorization-only sessions cannot read or mutate %s onboarding", async kind => {
    const t = fixture(); await invite(t, kind);
    const claim = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await t.action(api.platform.adminInvitations.register, { capability: claim.capability, email, name: "Owner", password });
    const account = (await user(t))!;
    const owner = await session(t, account._id);
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: account._id }], update: { twoFactorEnabled: true } } });
    await verifiedFactor(t, account._id);
    const onboarding = () => t.query(components.platform.adminInvitations.boundOnboarding, { email, userId: account._id });
    const before = await onboarding();
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "token", value: `session-${account._id}` }], update: { authPurpose: "mcp-authorization" } } });
    expect(await owner.query(api.platform.adminInvitations.getMyOnboardingStatus, {})).toBeNull();
    for (const step of [1, 2, 3]) {
      await expect(owner.mutation(api.platform.adminInvitations.advanceOnboardingStep, { step })).rejects.toThrow("NOT_AUTHENTICATED");
      expect(await onboarding()).toEqual(before);
    }
    await expect(owner.mutation(api.platform.adminInvitations.completeOnboarding, {})).rejects.toThrow("NOT_AUTHENTICATED");
    expect(await onboarding()).toEqual(before);
    expect(await user(t)).toMatchObject({ role: "user" });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "token", value: `session-${account._id}` }], update: { authPurpose: "application" } } });
    await owner.mutation(api.platform.adminInvitations.advanceOnboardingStep, { step: 3 });
    await owner.mutation(api.platform.adminInvitations.completeOnboarding, {});
    expect(await owner.query(api.platform.adminInvitations.getMyOnboardingStatus, {})).toMatchObject({ completed: true });
    expect(await user(t)).toMatchObject({ role: "admin" });
  });
  test("backup-step progress rejects stale authentication and persists on authenticated retry", async () => {
    const t = fixture(); await invite(t, "admin");
    const claim = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await t.action(api.platform.adminInvitations.register, { capability: claim.capability, email, name: "Owner", password });
    const account = (await user(t))!;
    const owner = await session(t, account._id);
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: account._id }], update: { twoFactorEnabled: true } } });
    await expect(t.mutation(api.platform.adminInvitations.advanceOnboardingStep, { step: 2 })).rejects.toThrow("NOT_AUTHENTICATED");
    expect(await owner.query(api.platform.adminInvitations.getMyOnboardingStatus, {})).toEqual({ completed: false, step: 1 });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "session", where: [{ field: "userId", value: account._id }], update: { expiresAt: Date.now() - 1, token: "expired-session" } } });
    await expect(owner.mutation(api.platform.adminInvitations.advanceOnboardingStep, { step: 2 })).rejects.toThrow("NOT_AUTHENTICATED");
    const refreshed = await session(t, account._id);
    await verifiedFactor(t, account._id);
    await refreshed.mutation(api.platform.adminInvitations.advanceOnboardingStep, { step: 2 });
    expect(await refreshed.query(api.platform.adminInvitations.getMyOnboardingStatus, {})).toEqual({ completed: false, step: 2 });
  });

  test.each(["bootstrap", "admin"] as const)("%s enforces required passkeys for both stored policy representations", async kind => {
    const t = fixture(); await invite(t, kind);
    const claim = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await t.action(api.platform.adminInvitations.register, { capability: claim.capability, email, name: "Owner", password });
    const account = (await user(t))!;
    const owner = await session(t, account._id);
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: account._id }], update: { twoFactorEnabled: true } } });
    await verifiedFactor(t, account._id);
    await owner.mutation(api.platform.adminInvitations.advanceOnboardingStep, { step: 3 });
    for (const value of ["required", JSON.stringify("required")]) {
      await t.mutation(components.betterAuth.organizationSecurity.setPolicy, { key: "adminPasskeyPolicy", value });
      expect(await owner.query(api.platform.appSettings.getPublic, { key: "adminPasskeyPolicy" })).toBe("required");
      await expect(owner.mutation(api.platform.adminInvitations.completeOnboarding, {})).rejects.toThrow("PASSKEY_REQUIRED");
      expect(await user(t)).toMatchObject({ role: "user" });
      expect(await owner.query(api.platform.adminInvitations.getMyOnboardingStatus, {})).toEqual({ completed: false, step: 3 });
    }
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: account._id, publicKey: "fixture", credentialID: "owner-passkey", counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    await owner.mutation(api.platform.adminInvitations.completeOnboarding, {});
    expect(await user(t)).toMatchObject({ role: "admin" });
    expect(await owner.query(api.platform.adminInvitations.getMyOnboardingStatus, {})).toMatchObject({ completed: true });
  });

  test.each(["sent", "claiming"] as const)("old bootstrap links in %s state redirect and enroll through public APIs", async status => {
    const t = fixture(); await invite(t);
    if (status === "claiming") await t.mutation(api.platform.waitlistTokens.beginClaim, { token });
    const validation = await t.query(api.platform.waitlistTokens.validate, { token });
    expect(validation).toEqual({ valid: true, email, adminOnboardingUrl: `http://localhost:3001/onboarding?token=${token}` });
    if (!validation.valid || !("adminOnboardingUrl" in validation)) throw new Error("Missing admin redirect");
    const redirectedToken = new URL(validation.adminOnboardingUrl).searchParams.get("token")!;
    expect(await t.query(api.platform.adminInvitations.validateToken, { token: redirectedToken })).toEqual({ valid: true, email });
    const claim = await t.action(api.platform.adminInvitations.claimInvitation, { token: redirectedToken });
    await t.action(api.platform.adminInvitations.register, { capability: claim.capability, email, name: "Owner", password });
    expect(await user(t)).toMatchObject({ role: "user" });
    expect(await t.query(api.platform.waitlistTokens.validate, { token })).toMatchObject({ valid: false });
  });

  test.each(["expired", "revoked"] as const)("invalid %s bootstrap links do not redirect", async status => {
    const t = fixture(); await invite(t);
    await t.mutation(api.platform.waitlistTokens.beginClaim, { token });
    if (status === "expired") vi.setSystemTime(Date.now() + 3600001);
    else await t.mutation(internal.platform.bootstrap.rescue, { currentEmail: email, newEmail: email });
    expect(await t.query(api.platform.waitlistTokens.validate, { token })).toMatchObject({ valid: false });
  });

  test("competing registration requests cannot both consume the invitation", async () => {
    const t = fixture(); await invite(t);
    const first = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    const second = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    const attempts = await Promise.allSettled([first, second].map(claim => t.action(api.platform.adminInvitations.register, { capability: claim.capability, email, name: "Owner", password })));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    const accounts = await t.query(components.betterAuth.adapter.findMany, { model: "user", where: [{ field: "email", value: email }], paginationOpts: { cursor: null, numItems: 10 } });
    expect(accounts.page).toHaveLength(1);
    expect(accounts.page[0].role).toBe("user");
  });

  test("real password sign-in and TOTP verification complete the bound enrollment", async () => {
    const t = fixture(); await invite(t);
    const claim = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await t.action(api.platform.adminInvitations.register, { capability: claim.capability, email, name: "Owner", password });
    const post = (path: string, body: unknown, cookie = "") => t.fetch(`/api/auth${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3001", cookie }, body: JSON.stringify(body),
    });
    const signedIn = await post("/sign-in/email", { email, password });
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const enabled = await post("/two-factor/enable", { password }, cookie);
    expect(enabled.status).toBe(200);
    const { totpURI } = await enabled.json();
    const secret = new URL(totpURI).searchParams.get("secret")!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...secret.toUpperCase().replace(/=+$/, "")].map(char => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
    const bytes = Buffer.from(bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const digest = createHmac("sha1", bytes).update(counter).digest();
    const code = ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
    const verified = await post("/two-factor/verify-totp", { code }, cookie);
    expect(verified.status).toBe(200);
    const account = (await user(t))!;
    expect(account).toMatchObject({ role: "user", twoFactorEnabled: true });
    const live = await t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "userId", value: account._id }] });
    expect(live).toMatchObject({ strongFactorType: "totp" });
    const owner = t.withIdentity({ subject: account._id, sessionId: live!._id });
    await owner.mutation(api.platform.adminInvitations.advanceOnboardingStep, { step: 3 });
    await owner.mutation(api.platform.adminInvitations.completeOnboarding, {});
    expect(await user(t)).toMatchObject({ role: "admin" });
  });

  test("a failed final binding rolls back both Better Auth account records", async () => {
    const t = fixture(); await invite(t);
    const claim = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    // Simulate an inconsistent legacy record detected after credential insertion.
    await t.mutation(components.platform.adminInvitations.createForSeed, { email });
    await expect(t.action(api.platform.adminInvitations.register, { capability: claim.capability, email, name: "Owner", password })).rejects.toThrow("ENROLLMENT_ALREADY_EXISTS");
    expect(await user(t)).toBeNull();
    expect((await t.query(components.platform.waitlistBootstrap.state, { email })).tokens[0].status).toBe("sent");
    expect(await t.query(components.platform.adminInvitations.enrollment, { capabilityHash: sha256Hex(claim.capability), email })).toEqual({ email });
  });

  test("rescue rejects stale queued deliveries and expires the original link", async () => {
    const t = fixture(); await invite(t);
    const state = await t.query(components.platform.waitlistBootstrap.state, { email });
    await t.mutation(internal.platform.bootstrap.rescue, { currentEmail: email, newEmail: email });
    await expect(t.mutation(components.platform.waitlistTokens.create, { waitlistEntryId: state.waitlistEntry!._id, email, tokenHash: "stale-delivery", expiresAt: Date.now() + 3600000 })).rejects.toThrow("STALE_INVITATION_DELIVERY");
    await expect(t.action(api.platform.adminInvitations.claimInvitation, { token })).rejects.toThrow("INVALID_INVITATION");
  });

  test("an expired original invitation cannot be exchanged", async () => {
    const t = fixture(); await invite(t);
    vi.setSystemTime(Date.now() + 3600001);
    await expect(t.action(api.platform.adminInvitations.claimInvitation, { token })).rejects.toThrow("INVALID_INVITATION");
    expect(await user(t)).toBeNull();
  });

  test.each(["bootstrap", "admin"] as const)("%s cannot be seized by anonymous email signup, even after token exchange", async kind => {
    const t = fixture(); await invite(t, kind);
    await t.action(api.platform.adminInvitations.claimInvitation, { token });
    for (const onboardingType of ["inviteOnly", "publicSignup"]) {
      await t.mutation(components.platform.appSettings.putRaw, { key: "onboardingType", value: JSON.stringify(onboardingType), updatedBy: "fixture" });
      const response = await t.fetch("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, name: "Attacker" }) });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(await user(t)).toBeNull();
    }
  });

  test.each(["bootstrap", "admin"] as const)("%s binds a credential account and grants admin only after verified MFA", async kind => {
    const t = fixture(); await invite(t, kind);
    const claim = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await t.action(api.platform.adminInvitations.register, { capability: claim.capability, email: "OWNER@example.test", name: "Owner", password });
    const account = (await user(t))!;
    expect(account).toMatchObject({ emailVerified: true, role: "user", email });
    const owner = await session(t, account._id);
    await expect(t.mutation(internal.platform.bootstrap.rescue, { currentEmail: email, newEmail: email })).rejects.toThrow("BOOTSTRAP_ACCOUNT_EXISTS");
    expect(await owner.query(api.platform.adminInvitations.getMyOnboardingStatus, {})).toEqual({ completed: false, step: 1 });
    await expect(owner.mutation(api.platform.adminAuth.setMfaPolicy, { required: false })).rejects.toThrow("NOT_AUTHENTICATED");
    await expect(owner.mutation(api.platform.adminInvitations.completeOnboarding, {})).rejects.toThrow("MFA_REQUIRED");
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: account._id }], update: { twoFactorEnabled: true } } });
    await expect(owner.mutation(api.platform.adminInvitations.completeOnboarding, {})).rejects.toThrow("MFA_REQUIRED");
    await verifiedFactor(t, account._id);
    await owner.mutation(api.platform.adminInvitations.advanceOnboardingStep, { step: 3 });
    await owner.mutation(api.platform.adminInvitations.completeOnboarding, {});
    expect(await user(t)).toMatchObject({ role: "admin" });
    await owner.mutation(api.platform.adminAuth.setMfaPolicy, { required: true });
    await expect(t.action(api.platform.adminInvitations.claimInvitation, { token })).rejects.toThrow();
    await expect(t.mutation(internal.platform.bootstrap.rescue, { currentEmail: email, newEmail: "other@example.test" })).rejects.toThrow();
  });

  test("capabilities reject cross-email use, expire, and can be replaced after abandonment", async () => {
    const t = fixture(); await invite(t);
    const first = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await expect(t.action(api.platform.adminInvitations.register, { capability: first.capability, email: "other@example.test", name: "Other", password })).rejects.toThrow("INVALID_ENROLLMENT");
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    await expect(t.action(api.platform.adminInvitations.register, { capability: first.capability, email, name: "Owner", password })).rejects.toThrow("INVALID_ENROLLMENT");
    const next = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await t.action(api.platform.adminInvitations.register, { capability: next.capability, email, name: "Owner", password });
    expect(await user(t)).toMatchObject({ role: "user" });
  });

  test("one invitation authorizes one account; retries never replace its credentials", async () => {
    const t = fixture(); await invite(t);
    const first = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    const second = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await t.action(api.platform.adminInvitations.register, { capability: first.capability, email, name: "Owner", password });
    await expect(t.action(api.platform.adminInvitations.register, { capability: second.capability, email, name: "Other", password })).rejects.toThrow();
    const original = (await user(t))!;
    await t.action(api.platform.adminInvitations.register, { capability: first.capability, email, name: "Changed", password: "ignored" });
    expect(await user(t)).toEqual(original);
    const signedIn = await t.fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    expect(signedIn.status).toBe(200);
  });

  test("rescue revokes exchanged capabilities and accepts a replacement invitation", async () => {
    const t = fixture(); await invite(t);
    const first = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await t.mutation(internal.platform.bootstrap.rescue, { currentEmail: email, newEmail: email });
    await expect(t.action(api.platform.adminInvitations.register, { capability: first.capability, email, name: "Owner", password })).rejects.toThrow();
    const state = await t.query(components.platform.waitlistBootstrap.state, { email });
    expect(state.tokens[0].status).toBe("revoked");
    const replacement = "replacement-secret";
    await t.mutation(components.platform.waitlistTokens.create, { waitlistEntryId: state.waitlistEntry!._id, email, generation: state.waitlistEntry?.invitationGeneration, tokenHash: sha256Hex(replacement), expiresAt: Date.now() + 3600000 });
    const next = await t.action(api.platform.adminInvitations.claimInvitation, { token: replacement });
    await t.action(api.platform.adminInvitations.register, { capability: next.capability, email, name: "Owner", password });
    expect(await user(t)).toMatchObject({ role: "user" });
  });

  test("password validation failures preserve the invitation and create no account", async () => {
    const t = fixture(); await invite(t);
    const claim = await t.action(api.platform.adminInvitations.claimInvitation, { token });
    await expect(t.action(api.platform.adminInvitations.register, { capability: claim.capability, email, name: "Owner", password: "short" })).rejects.toThrow();
    expect(await user(t)).toBeNull();
    expect(await t.query(api.platform.adminInvitations.validateToken, { token })).toMatchObject({ valid: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(t.action(api.platform.adminInvitations.register, { capability: claim.capability, email, name: "Owner", password })).rejects.toThrow("PASSWORD_CHECK_UNAVAILABLE");
    expect(await user(t)).toBeNull();
  });
});
