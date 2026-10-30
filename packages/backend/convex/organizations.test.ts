// Organizations: tenant isolation, switching, removal, roles, invitations and the upgrade
// migration, against the real Better Auth component tables.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authRoutePolicy } from "./platform/authAssurance";
import authSchema from "./platform/betterAuth/schema";
import { createTestEnv } from "./test.modules";

const authModules = import.meta.glob("./platform/betterAuth/**/*.*s");

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, authModules);

  async function user(name: string, extra: { emailVerified?: boolean; userId?: string } = {}) {
    const now = Date.now();
    const account = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "user", data: {
        name, email: `${name}@example.test`, emailVerified: extra.emailVerified ?? true,
        createdAt: now, updatedAt: now, ...(extra.userId ? { userId: extra.userId } : {}),
      } },
    });
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "session", data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
        userId: account._id, token: `${name}-session`, createdAt: now, updatedAt: now, expiresAt: now + 3600_000,
      } },
    });
    const caller = t.withIdentity({ subject: account._id, sessionId: session._id });
    return {
      caller,
      userId: account._id,
      sessionId: session._id,
      /** What Better Auth's `organization.setActive` does to the session row. */
      switchTo: (organizationId: string | null) => t.mutation(components.betterAuth.adapter.updateOne, {
        input: { model: "session", where: [{ field: "_id", value: session._id }], update: { activeOrganizationId: organizationId } },
      }),
    };
  }

  const addMember = (organizationId: string, userId: string, role: string) =>
    t.mutation(components.betterAuth.adapter.create, {
      input: { model: "member", data: { organizationId, userId, role, createdAt: Date.now() } },
    });

  const members = async (organizationId: string) => (await t.query(components.betterAuth.adapter.findMany, {
    model: "member", where: [{ field: "organizationId", value: organizationId }], paginationOpts: { numItems: 100, cursor: null },
  })).page as { _id: string; userId: string; role: string }[];

  return { t, user, addMember, members };
}

type Caller = Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["user"]>>["caller"];
const activeOrganization = async (caller: Caller) => (await caller.query(api.platform.organizations.mine, {}))!.activeOrganizationId!;

describe("organizations", () => {
  test("a user without an organization gets a personal one on first write, named after them", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    expect(await alice.caller.query(api.platform.organizations.mine, {})).toEqual({ activeOrganizationId: null, organizations: [] });
    expect(await alice.caller.query(api.projects.list, {})).toBeNull();

    await alice.caller.mutation(api.projects.create, { name: "Launch", description: "" });
    const mine = await alice.caller.query(api.platform.organizations.mine, {});
    expect(mine!.organizations).toEqual([{ id: mine!.activeOrganizationId, name: "alice", role: "owner" }]);
    expect(await alice.caller.query(api.projects.list, {})).toMatchObject([{ name: "Launch", organizationId: mine!.activeOrganizationId }]);
    // `ensure` is idempotent.
    expect(await alice.caller.mutation(api.platform.organizations.ensure, {})).toBe(mine!.activeOrganizationId);
  });

  test("organizations are isolated: no read or write reaches another organization's project", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const projectId = await alice.caller.mutation(api.projects.create, { name: "Secret", description: "" });
    const taskId = await alice.caller.mutation(api.tasks.create, { projectId, title: "T", description: "", status: "todo" });
    await bob.caller.mutation(api.platform.organizations.ensure, {});

    expect(await bob.caller.query(api.projects.list, {})).toEqual([]);
    await expect(bob.caller.query(api.projects.get, { id: projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.query(api.tasks.listByProject, { projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.mutation(api.projects.update, { id: projectId, name: "Mine" })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.mutation(api.tasks.update, { id: taskId, title: "Mine" })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.mutation(api.projects.remove, { id: projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.query(api.files.listUploads, { projectId })).rejects.toThrow("PROJECT_NOT_FOUND");

    // A session pointing at an organization Bob doesn't belong to changes nothing.
    await bob.switchTo(await activeOrganization(alice.caller));
    expect(await bob.caller.query(api.projects.list, {})).toEqual([]);
    await expect(bob.caller.query(api.projects.get, { id: projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
  });

  test("members share the organization's data, switch between organizations, and lose access when removed", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const projectId = await alice.caller.mutation(api.projects.create, { name: "Shared", description: "" });
    const acme = await activeOrganization(alice.caller);
    const bobsOwn = await bob.caller.mutation(api.platform.organizations.ensure, {});
    const membership = await f.addMember(acme, bob.userId, "member");

    // Bob still works in his own organization until he switches.
    expect(await bob.caller.query(api.projects.list, {})).toEqual([]);
    await bob.switchTo(acme);
    const mine = await bob.caller.query(api.platform.organizations.mine, {});
    expect(mine!.activeOrganizationId).toBe(acme);
    expect(mine!.organizations.map((o) => o.role).sort()).toEqual(["member", "owner"]);

    // Every member can read and edit the organization's data.
    expect(await bob.caller.query(api.projects.list, {})).toMatchObject([{ _id: projectId }]);
    await bob.caller.mutation(api.tasks.create, { projectId, title: "By Bob", description: "", status: "todo" });
    await bob.caller.mutation(api.projects.update, { id: projectId, name: "Renamed by Bob" });
    expect(await alice.caller.query(api.tasks.listByProject, { projectId })).toMatchObject([{ title: "By Bob", ownerId: bob.userId }]);
    // New rows land in the active organization.
    const bobsProject = await bob.caller.mutation(api.projects.create, { name: "Acme second", description: "" });
    expect(await alice.caller.query(api.projects.get, { id: bobsProject })).toMatchObject({ organizationId: acme });

    // Removal takes effect on the next request: Bob falls back to his own organization.
    await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "member", where: [{ field: "_id", value: membership._id }] },
    });
    expect(await activeOrganization(bob.caller)).toBe(bobsOwn);
    expect(await bob.caller.query(api.projects.list, {})).toEqual([]);
    await expect(bob.caller.query(api.projects.get, { id: projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
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

describe("upgrade migration", () => {
  async function legacyProject(f: Awaited<ReturnType<typeof fixture>>, ownerId: string): Promise<Id<"projects">> {
    return await f.t.run((ctx) => ctx.db.insert("projects", { name: `${ownerId}'s`, description: "", ownerId, createdAt: Date.now() }));
  }
  // Migrations run in scheduled batches, as `npx convex run migrations` does after a deploy.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  async function migrate(f: Awaited<ReturnType<typeof fixture>>) {
    await f.t.mutation(internal.migrations.default, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  }

  test("moves each pre-organization project into its creator's personal organization, which keeps working", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const legacy = await f.user("legacy", { userId: "legacy-owner-id" });
    const aliceProject = await legacyProject(f, alice.userId);
    const legacyOwned = await legacyProject(f, "legacy-owner-id");
    const orphan = await legacyProject(f, "deleted-account");

    // Before the migration the rows are unreachable, never exposed.
    expect(await alice.caller.query(api.projects.list, {})).toBeNull();

    await migrate(f);
    expect(await alice.caller.query(api.projects.list, {})).toMatchObject([{ _id: aliceProject }]);
    expect(await legacy.caller.query(api.projects.list, {})).toMatchObject([{ _id: legacyOwned }]);
    expect((await f.t.run((ctx) => ctx.db.get(orphan)))!.organizationId).toBeUndefined();
    // Idempotent.
    await migrate(f);
    expect((await alice.caller.query(api.platform.organizations.mine, {}))!.organizations).toHaveLength(1);
  });

  test("never moves private data into an organization its creator was only invited to", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    // Bob joined Acme before the migration reached his old project.
    await f.addMember(acme, bob.userId, "member");
    const bobsProject = await legacyProject(f, bob.userId);

    await migrate(f);
    const assigned = (await f.t.run((ctx) => ctx.db.get(bobsProject)))!.organizationId;
    expect(assigned).toBeDefined();
    expect(assigned).not.toBe(acme);
    expect(await alice.caller.query(api.projects.list, {})).toEqual([]);
    const bobsOrganizations = (await bob.caller.query(api.platform.organizations.mine, {}))!.organizations;
    expect(bobsOrganizations.find((o) => o.id === assigned)).toMatchObject({ role: "owner", name: "bob" });
  });
});
