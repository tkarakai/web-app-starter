import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestEnv } from "./test.modules";
import { api, components, internal } from "./_generated/api";
import authSchema from "./platform/betterAuth/schema";

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./platform/betterAuth/**/*.*s"));
  async function signIn(name: string, role: string) {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "user", data: { name, email: `${name}@example.test`, emailVerified: true, role, createdAt: now, updatedAt: now } },
    });
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "session", data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now, userId: user._id, token: name, expiresAt: now + 3600_000, createdAt: now, updatedAt: now } },
    });
    return t.withIdentity({ subject: user._id, sessionId: session._id });
  }
  return { t, admin: await signIn("admin", "admin"), member: await signIn("member", "user") };
}

import { sha256Hex } from "./platform/tokenHash";
describe("invitation app boundaries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

  test("admin token exchange never promotes or allowlists an address", async () => {
    const { t, admin, member } = await fixture();
    const email = "future-admin@example.test";
    await expect(member.mutation(api.platform.adminInvitations.invite, { email })).rejects.toThrow("NOT_ADMIN");
    await admin.mutation(api.platform.adminInvitations.invite, { email });
    const page = await admin.query(api.platform.adminInvitations.list, { paginationOpts: { cursor: null, numItems: 10 } });
    expect(page.page).toHaveLength(1);
    expect(await t.query(components.platform.adminEmails.list, {})).toEqual([]);
    await t.mutation(internal.platform.adminInvitations.setToken, { adminInvitationId: page.page[0]._id, tokenHash: sha256Hex("secret"), expiresAt: Date.now() + 3600_000 });
    await expect(t.action(api.platform.adminInvitations.claimInvitation, { token: "wrong" })).rejects.toThrow("INVALID_INVITATION");
    expect(await t.query(components.platform.adminEmails.list, {})).toEqual([]);
    await t.action(api.platform.adminInvitations.claimInvitation, { token: "secret" });
    expect(await t.query(components.platform.adminEmails.list, {})).toEqual([]);
    expect(await t.query(internal.platform.adminInvitations.hasValidAdminInvitation, { email })).toBe(true);
    expect(await t.run(ctx => ctx.db.query("adminInvitations").collect())).toEqual([]);
  });

  test("waitlist wrapper enforces onboarding mode, returns full filtered pages and schedules email in the host", async () => {
    const { t, admin, member } = await fixture();
    const meta = JSON.stringify({ superpowers: ["coffee-to-code"], excitement: ["cant-wait"] });
    await expect(t.mutation(internal.platform.waitlist.join, { email: "buyer@example.test", meta })).rejects.toThrow("WAITLIST_NOT_ENABLED");
    await admin.mutation(api.platform.appSettings.set, { key: "onboardingType", value: "publicWaitlist" });
    await t.mutation(components.platform.adminEmails.ensure, { email: "admin@example.test" });
    for (const email of ["buyer@example.test", "admin@example.test"]) await t.mutation(internal.platform.waitlist.join, { email, meta, clientIp: email });
    const args = { paginationOpts: { cursor: null, numItems: 1 } };
    expect((await member.query(api.platform.waitlist.list, args)).page).toEqual([]);
    const page = await admin.query(api.platform.waitlist.list, args);
    expect(page.page).toMatchObject([{ email: "buyer@example.test" }]);
    const entryId = page.page[0]._id;
    await expect(member.mutation(api.platform.waitlist.invite, { entryId })).rejects.toThrow("NOT_ADMIN");
    await admin.mutation(api.platform.waitlist.invite, { entryId });
    const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toMatchObject([{ name: "platform/waitlistActions:generateTokenAndSendEmail", args: [{ entryId, email: "buyer@example.test" }] }]);
    await t.mutation(internal.platform.waitlistTokens.create, { waitlistEntryId: entryId, email: "buyer@example.test", tokenHash: sha256Hex("buyer-token"), expiresAt: Date.now() + 3600_000 });
    expect(await member.query(api.platform.waitlistTokens.listByEntry, { waitlistEntryId: entryId })).toBeNull();
    expect(await admin.query(api.platform.waitlistTokens.listByEntry, { waitlistEntryId: entryId })).toHaveLength(1);
    expect(await t.query(api.platform.waitlistTokens.validate, { token: "buyer-token" })).toEqual({ valid: true, email: "buyer@example.test" });
    await t.mutation(api.platform.waitlistTokens.beginClaim, { token: "buyer-token" });
    expect(await t.query(api.platform.waitlistTokens.validate, { token: "buyer-token" })).toEqual({ valid: false, reason: "ALREADY_USED" });
    await t.mutation(api.platform.waitlistTokens.finalizeClaim, { token: "buyer-token" });
    expect(await t.query(internal.platform.waitlistTokens.hasValidInvitation, { email: "buyer@example.test" })).toBe(true);
    expect(await t.run(ctx => ctx.db.query("waitlistEntries").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("invitationTokens").collect())).toEqual([]);
  });

  test("the app rate limiter still protects token operations", async () => {
    const { t } = await fixture();
    // Releasing a nonexistent token is a successful no-op, so quota consumption commits.
    for (let i = 0; i < 3; i++) await t.mutation(api.platform.waitlistTokens.releaseClaim, { token: "limited" });
    await expect(t.mutation(api.platform.waitlistTokens.releaseClaim, { token: "limited" })).rejects.toThrow(/rate|limit/i);
  });

  test("development and E2E preparation are idempotent and visible to the signup gates", async () => {
    for (const [key, value] of Object.entries({ DEV_SEED_ENABLED: "true", DEV_FIXTURE_RUNTIME: "anonymous", DEV_FIXTURE_SECRET: "a1".repeat(32), SITE_URL: "http://localhost:3000", CONVEX_CLOUD_URL: "http://127.0.0.1:3210", CONVEX_SITE_URL: "http://127.0.0.1:3211" })) vi.stubEnv(key, value);
    const { t } = await fixture();
    for (let i = 0; i < 2; i++) await t.mutation(internal.platform.devSeed.setupDevUser, { email: "dev@example.test", isAdmin: false });
    expect(await t.query(internal.platform.waitlistTokens.hasValidInvitation, { email: "dev@example.test" })).toBe(true);
    await t.mutation(internal.platform.devSeed.finalizeDevToken, { email: "dev@example.test" });
    const state = await t.query(components.platform.waitlistBootstrap.state, { email: "dev@example.test" });
    expect(state.tokens).toHaveLength(1);
    expect(state.tokens[0].status).toBe("claimed");
    const email = "e2e-invitation@e2e.local";
    await t.mutation(internal.platform.e2eFixtures.prepareE2eInvitation, { email, isAdmin: false });
    await t.mutation(internal.platform.e2eFixtures.finalizeE2eInvitation, { email });
    expect(await t.query(internal.platform.waitlistTokens.hasValidInvitation, { email })).toBe(true);
  });
});
