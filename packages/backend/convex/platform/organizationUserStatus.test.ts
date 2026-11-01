// A user's ability to act (banned or not, platform administrator or not) and organization
// ownership: every change is checked in the user write's own transaction, whichever path makes
// it, and successors are applied with it or not at all.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { createAuth } from "./auth";
import { organizationFixture } from "./organizations.test-helpers";
import { organizationSeats } from "./organizationOwnership";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "organization-user-status-test-secret-at-least-32-chars");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
});
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  const alice = await f.user("alice");
  const bob = await f.user("bob");
  const acme = await alice.provision();
  const post = (path: string, body: unknown, who = "boss") => t.fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: `Bearer ${who}-session` },
    body: JSON.stringify(body),
  });
  const account = async (userId: string) => await t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: userId }] });
  const roles = async (organizationId: string) => Object.fromEntries((await f.members(organizationId)).map((m) => [m.userId, m.role]));
  /** Every organization with a member who can act has an owner who can. */
  const owned = async (organizationId: string) => {
    const seats = await t.query((ctx) => organizationSeats(ctx, organizationId));
    return !seats.some((s) => s.active) || seats.some((s) => s.active && s.role === "owner");
  };
  return { ...f, boss, alice, bob, acme, post, account, roles, owned };
}

describe("HTTP ban", () => {
  test("a demotion that commits between the ban's check and its write fails the ban", async () => {
    // Alice and Bob own Acme with Carol. The ban's request hook passes (Bob is an owner who can act);
    // then Bob is demoted before the ban is written. The user trigger refuses the ban.
    const f = await fixture();
    await f.addMember(f.acme, f.bob.userId, "owner");
    const carol = await f.user("carol");
    await f.addMember(f.acme, carol.userId, "member");
    let interleaved = false;
    const result = await f.t.action(async (ctx) => {
      const wrapped = { ...ctx, runMutation: async (ref: unknown, args: { input?: { model?: string; update?: { banned?: boolean } } }) => {
        if (!interleaved && args?.input?.model === "user" && args.input.update?.banned === true) {
          interleaved = true;
          await f.boss.caller.mutation(api.platform.adminOrganizations.removeOwner, { organizationId: f.acme, userId: f.bob.userId, role: "member" });
        }
        return ctx.runMutation(ref as never, args as never);
      } };
      const response = await createAuth(wrapped as never).handler(new Request("http://localhost:3001/api/auth/admin/ban-user", {
        method: "POST",
        headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: "Bearer boss-session" },
        body: JSON.stringify({ userId: f.alice.userId }),
      }));
      return response.status;
    });
    expect(interleaved).toBe(true);
    expect(result).not.toBe(200);
    expect((await f.account(f.alice.userId))?.banned).not.toBe(true);
    expect(await f.owned(f.acme)).toBe(true);
  });
});

describe("unban", () => {
  test("unbanning a member where every owner is banned needs a successor, who may be that member", async () => {
    const f = await fixture();
    await f.addMember(f.acme, f.bob.userId, "member");
    await f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: f.bob.userId });
    await f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: f.alice.userId });

    await expect(f.boss.caller.mutation(api.platform.agentUsers.unban, { userId: f.bob.userId })).rejects.toThrow("OWNER_SUCCESSOR_REQUIRED");
    const http = await f.post("/admin/unban-user", { userId: f.bob.userId });
    expect(http.status).toBe(409);
    expect(await http.json()).toMatchObject({ code: "OWNER_SUCCESSOR_REQUIRED" });
    expect((await f.account(f.bob.userId))?.banned).toBe(true);

    await f.boss.caller.mutation(api.platform.agentUsers.unban, { userId: f.bob.userId, successors: [{ organizationId: f.acme, userId: f.bob.userId }] });
    expect((await f.account(f.bob.userId))?.banned).toBe(false);
    expect(await f.roles(f.acme)).toMatchObject({ [f.bob.userId]: "owner" });
    expect(await f.owned(f.acme)).toBe(true);
  });

  test("unbanning an owner needs nothing", async () => {
    const f = await fixture();
    await f.addMember(f.acme, f.bob.userId, "member");
    await f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: f.bob.userId });
    await f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: f.alice.userId });
    expect((await f.post("/admin/unban-user", { userId: f.alice.userId })).status).toBe(200);
    await f.boss.caller.mutation(api.platform.agentUsers.unban, { userId: f.bob.userId });
    expect(await f.owned(f.acme)).toBe(true);
  });
});

describe("platform administrators", () => {
  test("making the only owner who can act an administrator needs a successor, on every path", async () => {
    const f = await fixture();
    await f.addMember(f.acme, f.bob.userId, "member");
    await expect(f.boss.caller.mutation(api.platform.agentUsers.setRole, { userId: f.alice.userId, role: "admin" })).rejects.toThrow("OWNER_SUCCESSOR_REQUIRED");
    const http = await f.post("/admin/set-role", { userId: f.alice.userId, role: "admin" });
    expect(http.status).toBe(409);
    expect((await f.account(f.alice.userId))?.role ?? "user").not.toBe("admin");

    await f.boss.caller.mutation(api.platform.agentUsers.setRole, { userId: f.alice.userId, role: "admin", successors: [{ organizationId: f.acme, userId: f.bob.userId }] });
    expect((await f.account(f.alice.userId))?.role).toBe("admin");
    expect(await f.roles(f.acme)).toMatchObject({ [f.bob.userId]: "owner" });
    expect(await f.owned(f.acme)).toBe(true);
  });

  test("an administrator gets no organization context and can't be made an owner", async () => {
    const f = await fixture();
    const admin = await f.user("ops", { role: "admin" });
    await f.addMember(f.acme, admin.userId, "member");
    await admin.switchTo(f.acme);
    expect(await admin.caller.query(api.platform.organizations.active, {})).toBeNull();
    await expect(f.boss.caller.mutation(api.platform.adminOrganizations.addOwner, { organizationId: f.acme, userId: admin.userId }))
      .rejects.toThrow("MEMBER_IS_ADMINISTRATOR");
  });
});

describe("ban successors", () => {
  test("successors only for organizations that need one, one each; a failure commits nothing", async () => {
    const f = await fixture();
    await f.addMember(f.acme, f.bob.userId, "member");
    const carol = await f.user("carol");
    const dave = await f.user("dave");
    const second = await f.t.mutation(components.betterAuth.adapter.create, { input: {
      model: "organization", data: { name: "Second", slug: "second", createdAt: Date.now() },
    } });
    await f.addMember(second._id, f.alice.userId, "owner");
    await f.addMember(second._id, carol.userId, "member");
    const unrelated = await dave.provision();
    await f.addMember(unrelated, carol.userId, "member");
    const ban = (successors: { organizationId: string; userId: string }[]) =>
      f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: f.alice.userId, successors });

    // An organization that needs no successor, or two for one organization, are refused.
    await expect(ban([{ organizationId: f.acme, userId: f.bob.userId }, { organizationId: unrelated, userId: carol.userId }])).rejects.toThrow("INVALID_SUCCESSOR");
    await expect(ban([{ organizationId: f.acme, userId: f.bob.userId }, { organizationId: f.acme, userId: f.bob.userId }])).rejects.toThrow("INVALID_SUCCESSOR");
    // Covering only the first organization fails after its promotion, which is rolled back.
    await expect(ban([{ organizationId: f.acme, userId: f.bob.userId }])).rejects.toThrow("OWNER_SUCCESSOR_REQUIRED");
    expect(await f.roles(f.acme)).toMatchObject({ [f.bob.userId]: "member" });
    expect(await f.roles(unrelated)).toMatchObject({ [carol.userId]: "member" });
    expect((await f.account(f.alice.userId))?.banned).not.toBe(true);

    await ban([{ organizationId: f.acme, userId: f.bob.userId }, { organizationId: second._id, userId: carol.userId }]);
    expect((await f.account(f.alice.userId))?.banned).toBe(true);
    expect(await f.owned(f.acme)).toBe(true);
    expect(await f.owned(second._id)).toBe(true);
  });
});
