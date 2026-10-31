// The reference app's projects in organizations: tenant isolation, sharing, switching, removal
// and the upgrade migration. Part of the sample: removed with it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { defineSchema } from "convex/server";
import { convexTest } from "convex-test";
import { registerPlatform } from "@web-app-starter/convex-platform/test";

import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { activeOrganization, organizationFixture } from "./platform/organizations.test-helpers";
import authSchema from "./platform/betterAuth/schema";
import { requireProjectAccess } from "./projectAccess";
import schema from "./schema";
import { createTestEnv, modules } from "./test.modules";

function fixture(legacy = false) {
  // Only migration tests seed historical documents that predate the required field.
  const t = legacy ? convexTest(defineSchema(schema.tables, { schemaValidation: false }), modules) : createTestEnv();
  if (legacy) registerPlatform(t);
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./platform/betterAuth/**/*.*s"));
  return organizationFixture(t);
}

describe("organization projects", () => {
  test("the database rejects projects without an organization", async () => {
    const t = createTestEnv();
    // @ts-expect-error Deliberately invalid input checks runtime schema enforcement too.
    await expect(t.run((ctx) => ctx.db.insert("projects", {
      name: "Unassigned", description: "", ownerId: "alice", createdAt: Date.now(),
    }))).rejects.toThrow(/organizationId/);
    expect(await t.run((ctx) => ctx.db.query("projects").collect())).toEqual([]);
  });

  test("a user without an organization stays signed in but cannot write app data or create one implicitly", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    expect(await alice.caller.query(api.platform.organizations.mine, {})).toEqual({ activeOrganizationId: null, organizations: [] });
    expect(await alice.caller.query(api.projects.list, {})).toBeNull();

    await expect(alice.caller.mutation(api.projects.create, { name: "Launch", description: "" })).rejects.toThrow("NO_ORGANIZATION");
    expect(await alice.caller.query(api.platform.organizations.mine, {})).toEqual({ activeOrganizationId: null, organizations: [] });
    expect(await f.t.run((ctx) => ctx.db.query("projects").collect())).toEqual([]);

    // The initial sign-up hook provisions a personal organization, not ordinary app writes.
    await alice.provision();
    await alice.caller.mutation(api.projects.create, { name: "Launch", description: "" });
    const mine = await alice.caller.query(api.platform.organizations.mine, {});
    expect(mine!.organizations).toEqual([{ id: mine!.activeOrganizationId, name: "alice", role: "owner" }]);
    expect(await alice.caller.query(api.projects.list, {})).toMatchObject([{ name: "Launch", organizationId: mine!.activeOrganizationId }]);
    // Initial provisioning is idempotent.
    expect(await alice.provision()).toBe(mine!.activeOrganizationId);
  });

  test("organizations are isolated: no read or write reaches another organization's project", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    await alice.provision();
    const projectId = await alice.caller.mutation(api.projects.create, { name: "Secret", description: "" });
    const taskId = await alice.caller.mutation(api.tasks.create, { projectId, title: "T", description: "", status: "todo" });
    await bob.provision();

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
    await alice.provision();
    const projectId = await alice.caller.mutation(api.projects.create, { name: "Shared", description: "" });
    const acme = await activeOrganization(alice.caller);
    const bobsOwn = await bob.provision();
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
    // @ts-expect-error Historical rows lack organizationId; only legacy fixtures accept them.
    return await f.t.run((ctx) => ctx.db.insert("projects", { name: `${ownerId}'s`, description: "", ownerId, createdAt: Date.now() }));
  }
  // Migrations run in scheduled batches, as `npx convex run migrations` does after a deploy.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  async function migrate(f: Awaited<ReturnType<typeof fixture>>) {
    await f.t.mutation(internal.migrations.default, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  }

  test("unassigned legacy projects stay inaccessible even to a caller without an organization", async () => {
    const f = await fixture(true);
    const projectId = await legacyProject(f, "deleted-account");
    await expect(f.t.run((ctx) => requireProjectAccess(
      { db: ctx.db, organizationId: undefined as unknown as string }, projectId,
    ))).rejects.toThrow("PROJECT_NOT_FOUND");
  });

  test("moves each pre-organization project into its creator's personal organization, which keeps working", async () => {
    const f = await fixture(true);
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
    const f = await fixture(true);
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.provision();
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
    const f = await fixture(true);
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.provision();
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

  test("never moves private data into an organization someone else can still join", async () => {
    const f = await fixture(true);
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.provision();
    // Bob became an owner of Acme; Alice invited someone and then left, so Bob is its only member.
    await f.addMember(acme, bob.userId, "owner");
    await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email: "mallory@example.test", role: "member", status: "pending",
        inviterId: alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });
    const alicesMembership = (await f.members(acme)).find((m) => m.userId === alice.userId)!;
    await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "member", where: [{ field: "_id", value: alicesMembership._id }] },
    });
    const bobsProject = await legacyProject(f, bob.userId);

    await migrate(f);
    const assigned = (await f.t.run((ctx) => ctx.db.get(bobsProject)))!.organizationId;
    expect(assigned).toBeDefined();
    expect(assigned).not.toBe(acme);
  });
});

describe("deleting an organization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("BETTER_AUTH_SECRET", "organization-projects-test-secret-at-least-32-characters");
    vi.stubEnv("SITE_URL", "http://localhost:3001");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("removes its projects, tasks and files in batches, and nothing of any other organization", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    await alice.provision();
    await bob.provision();
    const doomed = await alice.caller.mutation(api.projects.create, { name: "Doomed", description: "" });
    const alsoDoomed = await alice.caller.mutation(api.projects.create, { name: "Also doomed", description: "" });
    const kept = await bob.caller.mutation(api.projects.create, { name: "Kept", description: "" });
    const acme = await activeOrganization(alice.caller);
    const addFiles = (projectId: Id<"projects">, count: number) => f.t.run(async (ctx) => {
      const stored = [];
      for (let i = 0; i < count; i++) {
        const storageId = await ctx.storage.store(new Blob([`file ${i}`]));
        await ctx.db.insert("uploads", {
          storageId, name: `f${i}.txt`, contentType: "text/plain", size: 6, projectId, ownerId: "x", createdAt: Date.now(), ownershipVersion: 1,
        });
        stored.push(storageId);
      }
      return stored;
    });
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 150; i++) {
        await ctx.db.insert("tasks", { title: `T${i}`, description: "", status: "todo", projectId: doomed, ownerId: "x", createdAt: Date.now() });
      }
    });
    const doomedFiles = await addFiles(doomed, 3);
    const keptFiles = await addFiles(kept, 1);
    await bob.caller.mutation(api.tasks.create, { projectId: kept, title: "Stays", description: "", status: "todo" });

    // The owner deletes it through Better Auth; the platform then runs organizationData.ts.
    const response = await f.t.fetch("/api/auth/organization/delete", {
      method: "POST",
      headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: "Bearer alice-session" },
      body: JSON.stringify({ organizationId: acme }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    const left = await f.t.run(async (ctx) => ({
      projects: (await ctx.db.query("projects").collect()).map((project) => project._id),
      tasks: (await ctx.db.query("tasks").collect()).map((task) => task.projectId),
      uploads: (await ctx.db.query("uploads").collect()).map((upload) => upload.projectId),
      doomedFiles: await Promise.all(doomedFiles.map((id) => ctx.storage.getUrl(id))),
      keptFiles: await Promise.all(keptFiles.map((id) => ctx.storage.getUrl(id))),
    }));
    expect(left.projects).toEqual([kept]);
    expect(left.projects).not.toContain(alsoDoomed);
    expect(left.tasks).toEqual([kept]);
    expect(left.uploads).toEqual([kept]);
    expect(left.doomedFiles).toEqual([null, null, null]);
    expect(left.keptFiles[0]).not.toBeNull();
  });
});
