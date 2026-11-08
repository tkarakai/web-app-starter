// Organizations: membership resolution, the settings view, invitations, sign-up admission,
// last-organization memory, ownership succession, account deletion and the route allowlist, against the real
// Better Auth component tables. Project scoping is tested in ../organization-projects.test.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "../_generated/api";
import { authRoutePolicy } from "./authAssurance";
import { activeOrganization, countReads, organizationFixture } from "./organizations.test-helpers";
import authSchema from "./betterAuth/schema";
import { createTestEnv } from "../test.modules";

function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  return organizationFixture(t);
}

describe("organizations", () => {
  test("initial sign-up provisions a personal organization; the active one follows membership, never just the session", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    expect(await alice.caller.query(api.platform.organizations.mine, {})).toMatchObject({ activeOrganizationId: null, organizations: [] });
    const acme = await alice.provision();
    expect(await alice.provision()).toBe(acme);
    expect((await alice.caller.query(api.platform.organizations.mine, {}))!.organizations)
      .toEqual([{ id: acme, name: "alice", role: "owner" }]);

    const bobsOwn = await bob.provision();
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
    const acme = await alice.provision();
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
    const acme = await alice.provision();
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

  test("a live invitation is listed and counted however much expired history comes first", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const boss = await f.user("boss", { role: "admin" });
    const acme = await alice.provision();
    const day = 86_400_000;
    const seed = (email: string, status: string, sentDaysAgo: number) => f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email, role: "member", status, inviterId: alice.userId,
        createdAt: Date.now() - sentDaysAgo * day, expiresAt: Date.now() + (7 - sentDaysAgo) * day,
      } },
    });
    // More expired-but-pending and declined rows than one page, all inside the listing window.
    for (let i = 0; i < 210; i++) await seed(`expired${i}@example.test`, "pending", 8 + (i % 20));
    for (let i = 0; i < 5; i++) await seed(`declined${i}@example.test`, "rejected", 2);
    await seed("ancient@example.test", "pending", 60);
    const live = await seed("live@example.test", "pending", 1);

    const asOwner = await alice.caller.query(api.platform.organizations.active, {});
    const statuses = new Map(asOwner!.invitations.map((row) => [row.email, row.status]));
    expect(statuses.get("live@example.test")).toBe("pending");
    expect(asOwner!.invitations.find((row) => row.email === "live@example.test")!.id).toBe(live._id);
    expect([...statuses.values()].filter((s) => s === "declined")).toHaveLength(5);
    expect(statuses.get("expired209@example.test")).toBe("expired");
    // History last sent before the listing window drops off; every live invitation was sent within it.
    expect(statuses.has("ancient@example.test")).toBe(false);

    const view = await boss.caller.query(api.platform.adminOrganizations.get, { organizationId: acme });
    expect(view!.pendingInvitations).toBe(1);
  });

  test("invitation listings read live and recent invitations only, however much older history there is", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const boss = await f.user("boss", { role: "admin" });
    const carol = await f.user("carol");
    const acme = await alice.provision();
    const row = (email: string, status: string, sentDaysAgo: number, organizationId = acme) =>
      ({ organizationId, email, status, sentDaysAgo, inviterId: alice.userId });
    await f.seedInvitations([
      // Older than the listing window: sent more than 30 days ago.
      ...Array.from({ length: 2000 }, (_, i) => row(`old-expired${i}@example.test`, "pending", 31 + (i % 60))),
      ...Array.from({ length: 1000 }, (_, i) => row(`old-declined${i}@example.test`, "rejected", 31 + (i % 60))),
      // Inside it, each status more than one page (200 rows).
      ...Array.from({ length: 250 }, (_, i) => row(`expired${i}@example.test`, "pending", 8 + (i % 22))),
      ...Array.from({ length: 250 }, (_, i) => row(`declined${i}@example.test`, "rejected", 1 + (i % 29))),
      row("live0@example.test", "pending", 1),
      row("live1@example.test", "pending", 6),
      // Carol's address: one live invitation, after a thousand expired ones elsewhere.
      ...Array.from({ length: 1000 }, (_, i) => row("carol@example.test", "pending", 8 + (i % 80), `elsewhere${i}`)),
      row("carol@example.test", "pending", 2),
    ]);
    const windowRows = 250 + 250 + 3;

    const page = await countReads(alice.caller, (ctx) => ctx.runQuery(api.platform.organizations.active, {}));
    const statuses = page.result!.invitations.map((i) => i.status);
    expect(page.result!.invitations).toHaveLength(windowRows);
    expect(statuses.filter((s) => s === "pending")).toHaveLength(3);
    expect(statuses.filter((s) => s === "expired")).toHaveLength(250);
    expect(statuses.filter((s) => s === "declined")).toHaveLength(250);
    expect(page.result!.invitations.some((i) => i.email.startsWith("old-"))).toBe(false);
    expect(page.documentsRead).toBeLessThan(windowRows + 50);

    const detail = await countReads(boss.caller, (ctx) => ctx.runQuery(api.platform.adminOrganizations.get, { organizationId: acme }));
    expect(detail.result).toMatchObject({ pendingInvitations: 3, morePendingInvitations: false });
    expect(detail.result.invitations).toHaveLength(windowRows);
    expect(detail.documentsRead).toBeLessThan(windowRows + 50);

    const list = await countReads(boss.caller, (ctx) => ctx.runQuery(api.platform.adminOrganizations.list, { paginationOpts: { numItems: 10, cursor: null } }));
    expect(list.result.page.find((o) => o.id === acme)).toMatchObject({ pendingInvitations: 3, morePendingInvitations: false });
    expect(list.documentsRead).toBeLessThan(50);

    const banner = await countReads(carol.caller, (ctx) => ctx.runQuery(api.platform.organizations.myInvitations, {}));
    expect(banner.result).toMatchObject([{ organizationName: "alice", email: "carol@example.test" }]);
    expect(banner.documentsRead).toBeLessThan(20);
    const gate = await countReads(f.t, (ctx) => ctx.runQuery(internal.platform.organizations.hasPendingInvitation, { email: "carol@example.test" }));
    expect(gate).toMatchObject({ result: true });
    expect(gate.documentsRead).toBeLessThan(5);
  }, 60_000);

  test("an invitation kept alive by resends is listed however long ago it was first sent", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const boss = await f.user("boss", { role: "admin" });
    const acme = await alice.provision();
    // First sent 45 days ago, last resent 2 days ago; declined 40 days after first being sent, last sent 25 days ago.
    await f.seedInvitations([
      { organizationId: acme, email: "carol@example.test", status: "pending", inviterId: alice.userId, createdDaysAgo: 45, sentDaysAgo: 2 },
      { organizationId: acme, email: "dave@example.test", status: "rejected", inviterId: alice.userId, createdDaysAgo: 40, sentDaysAgo: 25 },
    ]);
    const { invitations } = (await alice.caller.query(api.platform.organizations.active, {}))!;
    expect(invitations.map((i) => [i.email, i.status])).toEqual([["carol@example.test", "pending"], ["dave@example.test", "declined"]]);
    expect(await boss.caller.query(api.platform.adminOrganizations.get, { organizationId: acme })).toMatchObject({ pendingInvitations: 1 });
    const list = await boss.caller.query(api.platform.adminOrganizations.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(list.page.find((o) => o.id === acme)).toMatchObject({ pendingInvitations: 1 });
  });

  test("owners and admins delete an invitation in any state; nobody else, and only their organization's", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const carol = await f.user("carol");
    const acme = await alice.provision();
    await f.addMember(acme, bob.userId, "member");
    await bob.switchTo(acme);
    const other = await carol.provision();
    const invite = (organizationId: string, email: string, status: string) => f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId, email, role: "member", status, inviterId: alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });
    // Dave was invited before and declined: the list shows only his latest invitation.
    await invite(acme, "dave@example.test", "rejected");
    for (let i = 0; i < 101; i++) await invite(acme, "dave@example.test", "canceled");
    const pending = await invite(acme, "dave@example.test", "pending");
    const declined = await invite(acme, "erin@example.test", "rejected");
    // Erin joined through an earlier invitation: that record stays.
    await invite(acme, "erin@example.test", "accepted");
    const foreign = await invite(other, "frank@example.test", "pending");
    await invite(other, "erin@example.test", "pending");

    await expect(bob.caller.mutation(api.platform.organizations.deleteInvitation, { invitationId: pending._id })).rejects.toThrow("NOT_ALLOWED");
    await expect(alice.caller.mutation(api.platform.organizations.deleteInvitation, { invitationId: foreign._id })).rejects.toThrow("INVITATION_NOT_FOUND");
    await expect(alice.caller.mutation(api.platform.organizations.deleteInvitation, { invitationId: "not-an-id" })).rejects.toThrow("INVITATION_NOT_FOUND");

    // One delete removes the row: an older invitation to the same address doesn't take its place.
    await alice.caller.mutation(api.platform.organizations.deleteInvitation, { invitationId: pending._id });
    expect((await alice.caller.query(api.platform.organizations.active, {}))!.invitations.map((i) => i.email)).toEqual(["erin@example.test"]);
    await alice.caller.mutation(api.platform.organizations.deleteInvitation, { invitationId: declined._id });
    expect((await alice.caller.query(api.platform.organizations.active, {}))!.invitations).toEqual([]);
    const left = (await f.t.query(components.betterAuth.adapter.findMany, {
      model: "invitation", where: [{ field: "organizationId", value: acme }], paginationOpts: { numItems: 100, cursor: null },
    })).page as { email: string; status: string }[];
    expect(left.map((row) => [row.email, row.status])).toEqual([["erin@example.test", "accepted"]]);
    // The deleted pending invitation's link no longer works; the other organization's is untouched.
    expect(await f.t.query(internal.platform.organizations.hasPendingInvitation, { email: "dave@example.test" })).toBe(false);
    expect(await f.t.query(internal.platform.organizations.hasPendingInvitation, { email: "frank@example.test" })).toBe(true);
    expect(await f.t.query(internal.platform.organizations.hasPendingInvitation, { email: "erin@example.test" })).toBe(true);
  });

  test("the invitation page tells only the invited address about the invitation", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const carol = await f.user("carol");
    const mallory = await f.user("mallory");
    const acme = await alice.provision();
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
    const acme = await alice.provision();
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
    const acme = await alice.provision();
    await bob.provision();
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
    const acme = await alice.provision();
    await f.addMember(acme, bob.userId, "member");
    await f.addMember(acme, carol.userId, "admin");
    await f.invite(acme, "dave@example.test", alice.userId);

    await f.t.mutation(internal.platform.organizations.removeUserMemberships, { userId: alice.userId, email: "alice@example.test" });
    const remaining = await f.members(acme);
    expect(remaining.map((m) => [m.userId, m.role]).sort()).toEqual([[bob.userId, "member"], [carol.userId, "owner"]].sort());
    expect(await f.organization(acme)).not.toBeNull();
    expect(await f.invitations(acme)).toHaveLength(1);
  });

  describe("an organization its last member's account deletion leaves empty", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const auditEvents = async (f: Awaited<ReturnType<typeof fixture>>) => (await f.t.query(components.platform.auditTrail.list, {
      paginationOpts: { numItems: 100, cursor: null },
    })).page.filter((row) => row.action === "organization.deleted");

    test("is deleted with all its invitations when Better Auth deletes the account", async () => {
      const f = await fixture();
      const alice = await f.user("alice");
      const bob = await f.user("bob");
      const acme = await alice.provision();
      const bobsOwn = await bob.provision();
      await f.addMember(bobsOwn, alice.userId, "member");
      await alice.switchTo(acme);
      // More invitation history than one batch deletes.
      for (let i = 0; i < 201; i++) await f.invite(acme, `guest${i}@example.test`, alice.userId, i % 2 ? "canceled" : "rejected");
      await f.invite(acme, "carol@example.test", alice.userId);
      await f.invite(bobsOwn, "carol@example.test", bob.userId);

      await f.t.mutation(internal.platform.organizations.removeUserMemberships, { userId: alice.userId, email: "alice@example.test" });
      expect(await f.organization(acme)).toBeNull();
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await f.invitations(acme)).toEqual([]);
      // Bob's organization, where Alice was a member, stays with its owner and invitation.
      expect(await f.organization(bobsOwn)).not.toBeNull();
      expect((await f.members(bobsOwn)).map((m) => m.userId)).toEqual([bob.userId]);
      expect(await f.invitations(bobsOwn)).toHaveLength(1);
      expect(await auditEvents(f)).toMatchObject([{
        actor: "alice@example.test", authenticatedUserId: alice.userId, source: "server:account-deletion",
        resource: `organization:${acme}`, reason: "last_member_deleted",
      }]);
    });

    test("is deleted when an administrator agent deletes the account", async () => {
      const f = await fixture();
      const admin = await f.user("admin", { role: "admin" });
      const alice = await f.user("alice");
      const acme = await alice.provision();
      await f.invite(acme, "carol@example.test", alice.userId);

      await admin.caller.mutation(api.platform.agentUsers.remove, { userId: alice.userId });
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await f.organization(acme)).toBeNull();
      expect(await f.invitations(acme)).toEqual([]);
      expect(await f.t.query(internal.platform.organizations.hasPendingInvitation, { email: "carol@example.test" })).toBe(false);
      expect(await auditEvents(f)).toMatchObject([{
        actor: "admin@example.test", authenticatedUserId: admin.userId, resource: `organization:${acme}`, reason: "last_member_deleted",
      }]);
    });

    test("is deleted whatever the last member's role, once ownership has passed on", async () => {
      const f = await fixture();
      const alice = await f.user("alice");
      const bob = await f.user("bob");
      const acme = await alice.provision();
      await f.addMember(acme, bob.userId, "member");

      await f.t.mutation(internal.platform.organizations.removeUserMemberships, { userId: alice.userId, email: "alice@example.test" });
      expect((await f.members(acme)).map((m) => [m.userId, m.role])).toEqual([[bob.userId, "owner"]]);
      // A member left alone without the owner role (e.g. by an earlier removal) is cleaned up too.
      await f.t.mutation(components.betterAuth.adapter.updateOne, {
        input: { model: "member", where: [{ field: "organizationId", value: acme }], update: { role: "member" } },
      });
      await f.t.mutation(internal.platform.organizations.removeUserMemberships, { userId: bob.userId, email: "bob@example.test" });
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await f.organization(acme)).toBeNull();
      expect(await f.members(acme)).toEqual([]);
    });
  });

  test("only the organization routes the UI uses pass the session-assurance plugin", () => {
    for (const path of ["/organization/create", "/organization/set-active", "/organization/invite-member", "/organization/accept-invitation", "/organization/leave", "/organization/delete"]) {
      expect(authRoutePolicy(path)).toBe("organization");
    }
    for (const path of ["/organization/cancel-invitation", "/organization/add-member", "/organization/create-team", "/organization/create-role", "/organization/list"]) {
      expect(authRoutePolicy(path)).toBe("disabled");
    }
  });
});
