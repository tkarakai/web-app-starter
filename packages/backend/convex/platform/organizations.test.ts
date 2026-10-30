// Organizations: membership resolution, the settings view, invitations, sign-up admission,
// last-organization memory, ownership succession and the route allowlist, against the real
// Better Auth component tables. Project scoping is tested in ../organization-projects.test.ts.
import { describe, expect, test } from "vitest";

import { api, components, internal } from "../_generated/api";
import { authRoutePolicy } from "./authAssurance";
import { activeOrganization, organizationFixture } from "./organizations.test-helpers";
import authSchema from "./betterAuth/schema";
import { createTestEnv } from "../test.modules";

function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  return organizationFixture(t);
}

describe("organizations", () => {
  test("signed-in users get a personal organization; the active one follows membership, never just the session", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    expect(await alice.caller.query(api.platform.organizations.mine, {})).toEqual({ activeOrganizationId: null, organizations: [] });
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    expect(await alice.caller.mutation(api.platform.organizations.ensure, {})).toBe(acme);
    expect((await alice.caller.query(api.platform.organizations.mine, {}))!.organizations)
      .toEqual([{ id: acme, name: "alice", role: "owner" }]);

    const bobsOwn = await bob.caller.mutation(api.platform.organizations.ensure, {});
    // A session pointing at an organization Bob doesn't belong to is ignored.
    await bob.switchTo(acme);
    expect(await activeOrganization(bob.caller)).toBe(bobsOwn);
    expect(await bob.caller.query(api.platform.organizations.active, {})).toMatchObject({ id: bobsOwn });

    const membership = await f.addMember(acme, bob.userId, "member");
    expect(await activeOrganization(bob.caller)).toBe(acme);
    expect(await bob.caller.query(api.platform.organizations.active, {})).toMatchObject({ id: acme, role: "member" });

    await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "member", where: [{ field: "_id", value: membership._id }] },
    });
    expect(await activeOrganization(bob.caller)).toBe(bobsOwn);
  });

  test("the settings view lists members for everyone and pending invitations for owners and admins", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    await f.addMember(acme, bob.userId, "member");
    await bob.switchTo(acme);
    await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email: "carol@example.test", role: "member", status: "pending",
        inviterId: alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });

    const asOwner = await alice.caller.query(api.platform.organizations.active, {});
    expect(asOwner).toMatchObject({ id: acme, role: "owner", memberCount: 2, invitations: [{ email: "carol@example.test", expired: false }] });
    expect(asOwner!.members.map((m) => [m.name, m.role, m.isYou])).toEqual([["alice", "owner", true], ["bob", "member", false]]);
    const asMember = await bob.caller.query(api.platform.organizations.active, {});
    expect(asMember).toMatchObject({ role: "member", memberCount: 2, invitations: [] });
  });

  test("invitations are shown to their recipient only as theirs, and admit the address to sign up", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const carol = await f.user("carol");
    const mallory = await f.user("mallory");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    const invitation = await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email: "carol@example.test", role: "admin", status: "pending",
        inviterId: alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });

    expect(await carol.caller.query(api.platform.organizations.myInvitations, {})).toMatchObject([
      { id: invitation._id, organizationName: "alice", inviterName: "alice", role: "admin", isRecipient: true },
    ]);
    expect(await mallory.caller.query(api.platform.organizations.myInvitations, {})).toEqual([]);
    expect(await mallory.caller.query(api.platform.organizations.invitation, { id: invitation._id }))
      .toMatchObject({ isRecipient: false, email: "carol@example.test" });
    expect(await carol.caller.query(api.platform.organizations.invitation, { id: "not-an-id" })).toBeNull();

    expect(await f.t.query(internal.platform.organizations.hasPendingInvitation, { email: " Carol@Example.test " })).toBe(true);
    await f.t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "invitation", where: [{ field: "_id", value: invitation._id }], update: { expiresAt: Date.now() - 1 } },
    });
    expect(await f.t.query(internal.platform.organizations.hasPendingInvitation, { email: "carol@example.test" })).toBe(false);
    expect(await carol.caller.query(api.platform.organizations.myInvitations, {})).toEqual([]);
  });

  test("a new session starts in the organization the user last switched to, while still a member", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    await bob.caller.mutation(api.platform.organizations.ensure, {});
    await f.addMember(acme, bob.userId, "member");

    await f.t.mutation(internal.platform.organizations.rememberActive, { userId: bob.userId, organizationId: acme });
    expect(await f.t.query(internal.platform.organizations.startingOrganization, { userId: bob.userId })).toBe(acme);
    // Remembering an organization the user isn't in is ignored.
    await f.t.mutation(internal.platform.organizations.rememberActive, { userId: alice.userId, organizationId: "foreign" });
    expect(await f.t.query(internal.platform.organizations.startingOrganization, { userId: alice.userId })).toBeNull();
  });

  test("deleting an account passes ownership on rather than leaving an organization without an owner", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const carol = await f.user("carol");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    await f.addMember(acme, bob.userId, "member");
    await f.addMember(acme, carol.userId, "admin");

    await f.t.mutation(internal.platform.organizations.removeUserMemberships, { userId: alice.userId });
    const remaining = await f.members(acme);
    expect(remaining.map((m) => [m.userId, m.role]).sort()).toEqual([[bob.userId, "member"], [carol.userId, "owner"]].sort());
  });

  test("only the organization routes the UI uses pass the session-assurance plugin", () => {
    for (const path of ["/organization/create", "/organization/set-active", "/organization/invite-member", "/organization/accept-invitation", "/organization/leave"]) {
      expect(authRoutePolicy(path)).toBe("organization");
    }
    for (const path of ["/organization/delete", "/organization/add-member", "/organization/create-team", "/organization/create-role", "/organization/list"]) {
      expect(authRoutePolicy(path)).toBe("disabled");
    }
  });
});
