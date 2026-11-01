// Banning and organization ownership: every organization with members who can sign in keeps an
// owner who can. Both ban paths (Better Auth's admin route and the admin agent mutation) require
// a successor first; membership writes and account deletion respect banned owners.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { organizationFixture } from "./organizations.test-helpers";
import { deleteMember, OWNER_REQUIRED } from "./organizationOwnership";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "organization-bans-test-secret-at-least-32-characters");
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
  const carol = await f.user("carol");
  const acme = await alice.provision();
  await f.addMember(acme, bob.userId, "admin");
  await f.addMember(acme, carol.userId, "member");
  const post = (path: string, body: unknown) => t.fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: "Bearer boss-session" },
    body: JSON.stringify(body),
  });
  const ban = (userId: string) => t.mutation(components.betterAuth.adapter.updateOne, {
    input: { model: "user", where: [{ field: "_id", value: userId }], update: { banned: true } },
  });
  const roles = async () => Object.fromEntries((await f.members(acme)).map((m) => [m.userId, m.role]));
  const banned = async (userId: string) => (await t.query(components.betterAuth.adapter.findOne, {
    model: "user", where: [{ field: "_id", value: userId }],
  }))?.banned === true;
  return { ...f, boss, alice, bob, carol, acme, post, ban, roles, banned };
}

describe("banning an organization's only owner who can act", () => {
  test("the admin route refuses until a successor is an owner", async () => {
    const f = await fixture();
    const refused = await f.post("/admin/ban-user", { userId: f.alice.userId, banReason: "abuse" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "OWNER_SUCCESSOR_REQUIRED" });
    expect(await f.banned(f.alice.userId)).toBe(false);

    const blockers = await f.boss.caller.query(api.platform.adminOrganizations.forUser, { userId: f.alice.userId });
    expect(blockers![0]!.banSuccessor).toMatchObject({ suggested: f.bob.userId });
    expect(blockers![0]!.banSuccessor!.candidates.map((c) => c.userId).sort()).toEqual([f.bob.userId, f.carol.userId].sort());

    await f.boss.caller.mutation(api.platform.adminOrganizations.addOwner, { organizationId: f.acme, userId: f.carol.userId });
    const allowed = await f.post("/admin/ban-user", { userId: f.alice.userId, banReason: "abuse" });
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect(await f.banned(f.alice.userId)).toBe(true);
  });

  test("a sole owner without other members who can sign in is banned freely", async () => {
    const f = await fixture();
    const solo = await f.user("solo");
    await solo.provision();
    expect((await f.post("/admin/ban-user", { userId: solo.userId, banReason: "abuse" })).status).toBe(200);
  });

  test("the agent ban names successors and bans in one step, or changes nothing", async () => {
    const f = await fixture();
    const ban = api.platform.agentUsers.ban;
    await expect(f.boss.caller.mutation(ban, { userId: f.alice.userId, reason: "abuse" })).rejects.toThrow("OWNER_SUCCESSOR_REQUIRED");
    await f.ban(f.carol.userId);
    await expect(f.boss.caller.mutation(ban, { userId: f.alice.userId, successors: [{ organizationId: f.acme, userId: f.carol.userId }] }))
      .rejects.toThrow("MEMBER_BANNED");
    expect(await f.roles()).toMatchObject({ [f.alice.userId]: "owner", [f.bob.userId]: "admin" });
    expect(await f.banned(f.alice.userId)).toBe(false);

    await f.boss.caller.mutation(ban, { userId: f.alice.userId, successors: [{ organizationId: f.acme, userId: f.bob.userId }] });
    expect(await f.roles()).toMatchObject({ [f.alice.userId]: "owner", [f.bob.userId]: "owner" });
    expect(await f.banned(f.alice.userId)).toBe(true);
  });
});

describe("banned owners", () => {
  test("the last owner who can sign in cannot leave or be demoted while members can sign in", async () => {
    const f = await fixture();
    await f.boss.caller.mutation(api.platform.adminOrganizations.addOwner, { organizationId: f.acme, userId: f.bob.userId });
    await f.ban(f.bob.userId);
    const alicesRow = (await f.members(f.acme)).find((m) => m.userId === f.alice.userId)!;
    await expect(f.t.run((ctx) => deleteMember(ctx, alicesRow._id))).rejects.toThrow(OWNER_REQUIRED);
    await expect(f.boss.caller.mutation(api.platform.adminOrganizations.removeOwner, { organizationId: f.acme, userId: f.alice.userId, role: "admin" }))
      .rejects.toThrow("LAST_OWNER");
    await expect(f.boss.caller.mutation(api.platform.adminOrganizations.addOwner, { organizationId: f.acme, userId: f.carol.userId })).resolves.toBeNull();
    // The banned owner can be demoted: owners who can act remain.
    await f.boss.caller.mutation(api.platform.adminOrganizations.removeOwner, { organizationId: f.acme, userId: f.bob.userId, role: "member" });
    expect((await f.alice.caller.query(api.platform.organizations.active, {}))!.lastOwner).toBe(false);
  });

  test("the web page tells the last owner who can act that they cannot leave", async () => {
    const f = await fixture();
    await f.boss.caller.mutation(api.platform.adminOrganizations.addOwner, { organizationId: f.acme, userId: f.bob.userId });
    expect((await f.alice.caller.query(api.platform.organizations.active, {}))!.lastOwner).toBe(false);
    await f.ban(f.bob.userId);
    expect((await f.alice.caller.query(api.platform.organizations.active, {}))!.lastOwner).toBe(true);
  });

  test("an organization whose only owner was already banned keeps working, and is repaired when that account is deleted", async () => {
    const f = await fixture();
    await f.ban(f.alice.userId);
    // Members still come and go: the write does not make the organization worse.
    const dave = await f.user("dave");
    await f.addMember(f.acme, dave.userId, "member");
    const davesRow = (await f.members(f.acme)).find((m) => m.userId === dave.userId)!;
    await f.t.run((ctx) => deleteMember(ctx, davesRow._id));

    await f.ban(f.bob.userId);
    await f.t.mutation(internal.platform.organizations.removeUserMemberships, { userId: f.alice.userId, email: "alice@example.test" });
    // Ownership passes to someone who can sign in, ahead of the longer-standing banned admin.
    expect(await f.roles()).toEqual({ [f.bob.userId]: "admin", [f.carol.userId]: "owner" });
  });
});
