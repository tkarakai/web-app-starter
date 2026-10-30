// The reference app's projects in organizations: tenant isolation, sharing, switching, removal
// and the upgrade migration. Part of the sample: removed with it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { activeOrganization, organizationFixture } from "./platform/organizations.test-helpers";
import authSchema from "./platform/betterAuth/schema";
import { createTestEnv } from "./test.modules";

function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./platform/betterAuth/**/*.*s"));
  return organizationFixture(t);
}

describe("organization projects", () => {
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
    expect(await bob.caller.query(api.projects.get, { id: projectId })).toBeNull();
    await expect(bob.caller.query(api.tasks.listByProject, { projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.mutation(api.projects.update, { id: projectId, name: "Mine" })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.mutation(api.tasks.update, { id: taskId, title: "Mine" })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.mutation(api.projects.remove, { id: projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.query(api.files.listUploads, { projectId })).rejects.toThrow("PROJECT_NOT_FOUND");

    // A session pointing at an organization Bob doesn't belong to changes nothing.
    await bob.switchTo(await activeOrganization(alice.caller));
    expect(await bob.caller.query(api.projects.list, {})).toEqual([]);
    expect(await bob.caller.query(api.projects.get, { id: projectId })).toBeNull();
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
    expect(await bob.caller.query(api.projects.get, { id: projectId })).toBeNull();
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

  test("never moves private data into a shared organization, even one its creator co-owns", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.caller.mutation(api.platform.organizations.ensure, {});
    // Bob was invited into Acme as an owner before the migration reached his old project.
    await f.addMember(acme, bob.userId, "owner");
    const bobsProject = await legacyProject(f, bob.userId);

    await migrate(f);
    const assigned = (await f.t.run((ctx) => ctx.db.get(bobsProject)))!.organizationId;
    expect(assigned).toBeDefined();
    expect(assigned).not.toBe(acme);
    expect(await alice.caller.query(api.projects.get, { id: bobsProject })).toBeNull();
    expect(await f.members(assigned!)).toMatchObject([{ userId: bob.userId, role: "owner" }]);
  });
});
