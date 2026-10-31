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
    expect(asOwner).toMatchObject({ id: acme, role: "owner", memberCount: 2, invitations: [{ email: "carol@example.test", status: "pending" }] });
    expect(asOwner!.members.map((m) => [m.name, m.role, m.isYou])).toEqual([["alice", "owner", true], ["bob", "member", false]]);
    const asMember = await bob.caller.query(api.platform.organizations.active, {});
    expect(asMember).toMatchObject({ role: "member", memberCount: 2, invitations: [] });
  });

  test("the invitation list shows what became of each address: pending, expired or declined", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    await f.addMember(acme, bob.userId, "member");
    const day = 86_400_000;
    const invite = (email: string, status: string, sentDaysAgo: number) => f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email, role: "member", status, inviterId: alice.userId,
        createdAt: Date.now() - sentDaysAgo * day, expiresAt: Date.now() + (7 - sentDaysAgo) * day,
      } },
    });
    await invite("carol@example.test", "pending", 1);
    await invite("dave@example.test", "pending", 9);
    await invite("erin@example.test", "rejected", 2);
    // Superseded by a later invitation to the same address.
    await invite("frank@example.test", "rejected", 5);
    await invite("frank@example.test", "pending", 1);
    // Declined long ago, joined since, or canceled: not listed.
    await invite("gina@example.test", "rejected", 40);
    await invite("bob@example.test", "rejected", 3);
    await invite("hank@example.test", "canceled", 1);

    const { invitations } = (await alice.caller.query(api.platform.organizations.active, {}))!;
    expect(invitations.map((i) => [i.email, i.status]).sort()).toEqual([
      ["carol@example.test", "pending"], ["dave@example.test", "expired"],
      ["erin@example.test", "declined"], ["frank@example.test", "pending"],
    ]);
  });

  test("the invitation page tells only the invited address about the invitation", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const carol = await f.user("carol");
    const mallory = await f.user("mallory");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    const create = (status: string, expiresAt = Date.now() + 86_400_000) => f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email: "carol@example.test", role: "admin", status, inviterId: alice.userId, createdAt: Date.now(), expiresAt,
      } },
    });
    const pending = await create("pending");
    const view = (who: { caller: typeof carol.caller }, id: string) => who.caller.query(api.platform.organizations.invitation, { id });

    expect(await view(carol, pending._id)).toEqual({
      state: "open", organizationName: "alice", inviterName: "alice", role: "admin", email: "carol@example.test",
    });
    // Someone else holding the link learns only that it isn't theirs.
    expect(await view(mallory, pending._id)).toEqual({ state: "wrongAccount", signedInAs: "mallory@example.test" });
    expect(await f.t.query(api.platform.organizations.invitation, { id: pending._id })).toBeNull();

    // Spent, expired and unknown links all read the same, for the recipient too.
    for (const id of [(await create("rejected"))._id, (await create("canceled"))._id, (await create("pending", Date.now() - 1))._id, "not-an-id"]) {
      expect(await view(carol, id)).toEqual({ state: "invalid" });
      expect(await view(mallory, id)).toEqual({ state: "invalid" });
    }

    // Once the recipient has joined, the link just says so.
    await f.addMember(acme, carol.userId, "admin");
    await f.t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "invitation", where: [{ field: "_id", value: pending._id }], update: { status: "accepted" } },
    });
    expect(await view(carol, pending._id)).toEqual({ state: "member", organizationId: acme, organizationName: "alice" });
    expect(await view(mallory, pending._id)).toEqual({ state: "invalid" });
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
      { id: invitation._id, organizationName: "alice", inviterName: "alice", role: "admin" },
    ]);
    expect(await mallory.caller.query(api.platform.organizations.myInvitations, {})).toEqual([]);

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
    for (const path of ["/organization/create", "/organization/set-active", "/organization/invite-member", "/organization/accept-invitation", "/organization/leave", "/organization/delete"]) {
      expect(authRoutePolicy(path)).toBe("organization");
    }
    for (const path of ["/organization/add-member", "/organization/create-team", "/organization/create-role", "/organization/list"]) {
      expect(authRoutePolicy(path)).toBe("disabled");
    }
  });
});
