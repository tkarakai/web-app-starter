import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { sha256Hex } from "./tokenHash";

const modules = import.meta.glob("./**/*.ts");
const identity = { userId: "admin-id", actor: "admin@example.test" };
const meta = JSON.stringify({ superpowers: ["coffee-to-code"], excitement: ["cant-wait"] });
function fixture() { return convexTest(schema, modules); }
async function invited(t: ReturnType<typeof fixture>, token = "secret") {
  const entryId = await t.run(ctx => ctx.db.insert("waitlistEntries", { email: "buyer@example.test", meta, status: "invited", invitedAt: Date.now(), createdAt: Date.now() }));
  await t.mutation(api.waitlistTokens.create, { waitlistEntryId: entryId, email: "buyer@example.test", tokenHash: sha256Hex(token), expiresAt: Date.now() + 3600_000 });
  return entryId;
}

describe("component invitations", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("waitlist pages exclude admins before pagination and never repeat or lose entries", async () => {
    const t = fixture();
    await t.run(async ctx => {
      for (let i = 0; i < 11; i++) await ctx.db.insert("waitlistEntries", { email: `${i % 2 ? "member" : "admin"}${i}@example.test`, meta, status: "waiting", createdAt: i });
    });
    for (const i of [0, 2, 4, 6, 8, 10]) await t.mutation(api.adminEmails.ensure, { email: `ADMIN${i}@example.test` });
    let cursor: string | null = null;
    const emails: string[] = [];
    const sizes: number[] = [];
    for (let page = 0; page < 10; page++) {
      const result: FunctionReturnType<typeof api.waitlist.list> = await t.query(api.waitlist.list, { paginationOpts: { cursor, numItems: 2 } });
      sizes.push(result.page.length);
      emails.push(...result.page.map(row => row.email));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(sizes).toEqual([2, 2, 1]);
    expect(emails).toEqual([9, 7, 5, 3, 1].map(i => `member${i}@example.test`));
  });

  test("full admin invitation page needs a final empty page", async () => {
    const t = fixture();
    for (const email of ["a@example.test", "b@example.test"]) await t.mutation(api.adminInvitations.createForSeed, { email });
    const first = await t.query(api.adminInvitations.list, { paginationOpts: { cursor: null, numItems: 2 } });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const last = await t.query(api.adminInvitations.list, { paginationOpts: { cursor: first.continueCursor, numItems: 2 } });
    expect(last.page).toEqual([]);
    expect(last.isDone).toBe(true);
  });

  test("joining twice is idempotent and validates metadata", async () => {
    const t = fixture();
    const args = { email: "buyer@example.test", meta };
    expect(await t.mutation(api.waitlist.join, args)).toEqual({ alreadyJoined: false });
    expect(await t.mutation(api.waitlist.join, args)).toEqual({ alreadyJoined: true });
    await expect(t.mutation(api.waitlist.join, { ...args, meta: "[]" })).rejects.toThrow("INVALID_META");
    expect(await t.run(ctx => ctx.db.query("waitlistEntries").collect())).toHaveLength(1);
  });

  test("bulk invite normalizes, deduplicates and reports invalid and already invited emails", async () => {
    const t = fixture();
    const first = await t.mutation(api.waitlist.inviteMany, { identity, emails: [" BUYER@example.test ", "buyer@example.test", "bad"] });
    expect(first.invited).toEqual(["buyer@example.test"]);
    expect(first.deliveries).toHaveLength(1);
    expect(first.skipped).toEqual([{ email: "bad", reason: "INVALID_EMAIL" }]);
    expect((await t.mutation(api.waitlist.inviteMany, { identity, emails: ["buyer@example.test"] })).skipped).toEqual([{ email: "buyer@example.test", reason: "ALREADY_INVITED" }]);
    await expect(t.mutation(api.waitlist.inviteMany, { identity, emails: Array(101).fill("a@example.test") })).rejects.toThrow("TOO_MANY_EMAILS");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.query(api.auditTrail.list, { paginationOpts: { cursor: null, numItems: 10 } })).page).toMatchObject([{ action: "waitlist.invitation.sent", authenticatedUserId: identity.userId }]);
  });

  test("tokens are hashed, claimed once, and update the parent waitlist row", async () => {
    const t = fixture();
    const entryId = await invited(t);
    expect(await t.query(api.waitlistTokens.validate, { token: "secret" })).toEqual({ valid: true, email: "buyer@example.test" });
    expect(await t.query(api.waitlistTokens.validate, { token: "wrong" })).toEqual({ valid: false, reason: "NOT_FOUND" });
    await t.mutation(api.waitlistTokens.beginClaim, { token: "secret" });
    await expect(t.mutation(api.waitlistTokens.beginClaim, { token: "secret" })).rejects.toThrow("TOKEN_ALREADY_USED");
    await t.mutation(api.waitlistTokens.finalizeClaim, { token: "secret" });
    expect((await t.run(ctx => ctx.db.get(entryId)))?.status).toBe("claimed");
    expect(await t.query(api.waitlistTokens.validate, { token: "secret" })).toEqual({ valid: false, reason: "ALREADY_USED" });
    await expect(t.mutation(api.waitlist.remove, { entryId, identity })).rejects.toThrow("CANNOT_DELETE_CLAIMED");
  });

  test("failed signup can release a claim, and an abandoned claim can be reclaimed after its TTL", async () => {
    const t = fixture();
    await invited(t);
    await t.mutation(api.waitlistTokens.beginClaim, { token: "secret" });
    await t.mutation(api.waitlistTokens.releaseClaim, { token: "secret" });
    expect((await t.query(api.waitlistTokens.validate, { token: "secret" })).valid).toBe(true);
    await t.mutation(api.waitlistTokens.beginClaim, { token: "secret" });
    vi.setSystemTime(Date.now() + 15 * 60_000);
    expect(await t.mutation(api.waitlistTokens.beginClaim, { token: "secret" })).toEqual({ email: "buyer@example.test" });
  });

  test("expired tokens fail; uninvite revokes active tokens; deletion removes their rows", async () => {
    const t = fixture();
    const entryId = await invited(t);
    vi.setSystemTime(Date.now() + 3600_001);
    expect(await t.query(api.waitlistTokens.validate, { token: "secret" })).toEqual({ valid: false, reason: "EXPIRED" });
    await expect(t.mutation(api.waitlistTokens.beginClaim, { token: "secret" })).rejects.toThrow("TOKEN_EXPIRED");
    await t.mutation(api.waitlist.uninvite, { entryId, identity });
    expect(await t.query(api.waitlistTokens.validate, { token: "secret" })).toEqual({ valid: false, reason: "REVOKED" });
    expect((await t.run(ctx => ctx.db.get(entryId)))?.status).toBe("waiting");
    await t.mutation(api.waitlist.remove, { entryId, identity });
    expect(await t.run(ctx => ctx.db.query("invitationTokens").collect())).toEqual([]);
  });

  test("admin token validation, expiration, claiming and onboarding retain their state machine", async () => {
    const t = fixture();
    const delivery = await t.mutation(api.adminInvitations.invite, { email: " New@example.test ", identity });
    await t.mutation(api.adminInvitations.setToken, { adminInvitationId: delivery.adminInvitationId, tokenHash: sha256Hex("admin-secret"), expiresAt: Date.now() + 1000 });
    expect(await t.query(api.adminInvitations.validateToken, { token: "admin-secret" })).toEqual({ valid: true, email: "new@example.test" });
    expect(await t.mutation(api.adminInvitations.claimInvitation, { token: "admin-secret" })).toEqual({ email: "new@example.test" });
    await expect(t.mutation(api.adminInvitations.claimInvitation, { token: "admin-secret" })).rejects.toThrow("ALREADY_CLAIMED");
    await t.mutation(api.adminInvitations.advanceOnboardingStep, { email: "new@example.test", step: 3 });
    expect(await t.query(api.adminInvitations.getMyOnboardingStatus, { email: "new@example.test" })).toEqual({ completed: false, step: 3 });
    await t.mutation(api.adminInvitations.completeOnboarding, { email: "new@example.test" });
    expect(await t.query(api.adminInvitations.getMyOnboardingStatus, { email: "new@example.test" })).toEqual({ completed: true, step: null });
    expect(await t.query(api.adminInvitations.hasValidAdminInvitation, { email: "new@example.test" })).toBe(true);
    await expect(t.mutation(api.adminInvitations.remove, { entryId: delivery.adminInvitationId, identity })).rejects.toThrow("CANNOT_DELETE_CLAIMED");
  });

  test("expired admin invitations can be reissued with a fresh token", async () => {
    const t = fixture();
    const first = await t.mutation(api.adminInvitations.invite, { email: "new@example.test", identity });
    await t.mutation(api.adminInvitations.setToken, { adminInvitationId: first.adminInvitationId, tokenHash: sha256Hex("expired"), expiresAt: Date.now() - 1 });
    expect(await t.query(api.adminInvitations.validateToken, { token: "expired" })).toEqual({ valid: false, reason: "EXPIRED" });
    await expect(t.mutation(api.adminInvitations.claimInvitation, { token: "expired" })).rejects.toThrow("TOKEN_EXPIRED");
    expect(await t.mutation(api.adminInvitations.invite, { email: "new@example.test", identity })).toEqual(first);
    expect(await t.query(api.adminInvitations.validateToken, { token: "expired" })).toEqual({ valid: false, reason: "NOT_FOUND" });
  });
});
