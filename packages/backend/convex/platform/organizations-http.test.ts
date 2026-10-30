// Organization routes through the real Better Auth HTTP handlers: the role, budget and
// verification rules the session-assurance plugin and auth hooks add to the organization plugin.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { organizationFixture } from "./organizations.test-helpers";
import { sendAuthEmail } from "./sendAuthEmail";

vi.mock("./sendAuthEmail", async (original) => ({
  ...await original<typeof import("./sendAuthEmail")>(),
  sendAuthEmail: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "organizations-http-test-secret-at-least-32-characters");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.mocked(sendAuthEmail).mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  /** POST an auth route as the user owning `sessionToken`. */
  const post = (path: string, body: unknown, sessionToken: string) => t.fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(body),
  });
  const token = (name: string) => `${name}-session`;
  return { ...f, post, token };
}

describe("organization routes", () => {
  test("only one canonical role is accepted, so an admin cannot mint an owner", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    const admin = await f.addMember(acme, bob.userId, "admin");

    for (const role of ["admin, owner", "owner,admin", ["admin", "owner"], "superuser"]) {
      const invite = await f.post("/organization/invite-member", { organizationId: acme, email: "mallory@example.test", role }, f.token("bob"));
      expect(invite.status, JSON.stringify(role)).toBe(403);
      expect(await invite.json()).toMatchObject({ code: "INVALID_ROLE" });
    }
    const promote = await f.post("/organization/update-member-role", { organizationId: acme, memberId: admin._id, role: "admin, owner" }, f.token("bob"));
    expect(promote.status).toBe(403);
    // An admin still can't use the canonical owner role either (Better Auth's rule).
    const owner = await f.post("/organization/invite-member", { organizationId: acme, email: "mallory@example.test", role: "owner" }, f.token("bob"));
    expect(owner.status).toBe(403);
    expect((await f.members(acme)).map((m) => m.role).sort()).toEqual(["admin", "owner"]);

    const ok = await f.post("/organization/invite-member", { organizationId: acme, email: "carol@example.test", role: "member" }, f.token("bob"));
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(sendAuthEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "carol@example.test", type: "custom" }));
  });

  test("every invitation email counts against the inviter, resends included", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    for (let i = 0; i < 10; i++) {
      const invite = await f.post("/organization/invite-member", { organizationId: acme, email: `person${i}@example.test`, role: "member" }, f.token("alice"));
      expect(invite.status, await invite.clone().text()).toBe(200);
    }
    const resend = await f.post("/organization/invite-member", { organizationId: acme, email: "person0@example.test", role: "member", resend: true }, f.token("alice"));
    expect(resend.status).toBe(429);
    expect(sendAuthEmail).toHaveBeenCalledTimes(10);
  });

  test("an unverified invitee can verify on request even when the verification policy is off", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    await f.user("bob", { emailVerified: false });
    await f.t.mutation(components.platform.appSettings.putRaw, { key: "userEmailVerificationRequired", value: "false" });
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    const invitation = await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email: "bob@example.test", role: "member", status: "pending",
        inviterId: alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });
    const accept = await f.post("/organization/accept-invitation", { invitationId: invitation._id }, f.token("bob"));
    expect(accept.status).toBe(403);

    const send = await f.post("/send-verification-email", { email: "bob@example.test", callbackURL: "http://localhost:3001/dashboard" }, f.token("bob"));
    expect(send.status, await send.clone().text()).toBe(200);
    expect(sendAuthEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "bob@example.test", type: "verification" }));
  });
});

describe("invitation lookups", () => {
  test("a pending invitation is found however many old invitations the address has", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    const invite = (status: string) => f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email: "new@example.test", role: "member", status,
        inviterId: alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });
    for (let i = 0; i < 210; i++) await invite("canceled");
    expect(await f.t.query(internal.platform.organizations.hasPendingInvitation, { email: "new@example.test" })).toBe(false);
    await invite("pending");
    expect(await f.t.query(internal.platform.organizations.hasPendingInvitation, { email: "new@example.test" })).toBe(true);
  });

  test("the invitation page tells a not-yet-verified recipient what is missing instead of 'not found'", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob", { emailVerified: false });
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    const invitation = await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email: "bob@example.test", role: "member", status: "pending",
        inviterId: alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });
    // The default policy requires a verified email, so Bob's session isn't fully assured yet.
    expect(await bob.caller.query(api.platform.organizations.myInvitations, {})).toBeNull();
    expect(await bob.caller.query(api.platform.organizations.invitation, { id: invitation._id }))
      .toMatchObject({ isRecipient: true, emailVerified: false, ready: false, organizationName: "alice" });
    expect(await f.t.query(api.platform.organizations.invitation, { id: invitation._id })).toBeNull();
  });
});
