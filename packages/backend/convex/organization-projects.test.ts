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
import { createAuth } from "./platform/auth";
import { requireProjectAccess } from "./projectAccess";
import schema from "./schema";
import { createTestEnv, modules } from "./test.modules";

/** One page of a paginated list, enough for every test here. */
const PAGE = { numItems: 100, cursor: null };

function fixture(legacy = false) {
  // Only migration tests seed historical documents that predate the required field.
  const t = legacy ? convexTest(defineSchema(schema.tables, { schemaValidation: false }), modules) : createTestEnv();
  if (legacy) registerPlatform(t);
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./platform/betterAuth/**/*.*s"));
  return organizationFixture(t);
}

describe("organization projects", () => {
  test("project subscriptions never replay an old organization's cursors after a session switch", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const original = await alice.provision();
    await alice.caller.mutation(api.projects.create, { name: "Personal project", description: "" });
    const previousPage = await alice.caller.query(api.projects.list, {
      expectedOrganizationId: original, paginationOpts: { numItems: 12, cursor: null },
    });
    const bob = await f.user("bob");
    const destination = await bob.provision();
    await f.addMember(destination, alice.userId, "member");
    await bob.caller.mutation(api.projects.create, { name: "Shared roadmap", description: "" });
    await alice.switchTo(destination);

    for (const query of [api.projects.list, api.projects.listWithStats]) {
      // A still-mounted old subscription can re-evaluate before mine updates in React.
      // The stale cursor must never reach the new organization's index query.
      expect(await alice.caller.query(query, {
        expectedOrganizationId: original,
        paginationOpts: { numItems: 12, cursor: previousPage.continueCursor },
      })).toEqual({ page: [], isDone: true, continueCursor: "" });
      expect((await alice.caller.query(query, {
        expectedOrganizationId: destination,
        paginationOpts: { numItems: 12, cursor: null },
      })).page).toMatchObject([{ name: "Shared roadmap", organizationId: destination }]);
      // A client-supplied organization is a consistency check, never authorization.
      expect((await alice.caller.query(query, {
        expectedOrganizationId: original, paginationOpts: { numItems: 12, cursor: null },
      })).page).toEqual([]);
    }
  });

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
    expect(await alice.caller.query(api.platform.organizations.mine, {})).toMatchObject({ activeOrganizationId: null, organizations: [] });
    expect((await alice.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);

    await expect(alice.caller.mutation(api.projects.create, { name: "Launch", description: "" })).rejects.toThrow("NO_ORGANIZATION");
    expect(await alice.caller.query(api.platform.organizations.mine, {})).toMatchObject({ activeOrganizationId: null, organizations: [] });
    expect(await f.t.run((ctx) => ctx.db.query("projects").collect())).toEqual([]);

    // The initial sign-up hook provisions a personal organization, not ordinary app writes.
    await alice.provision();
    await alice.caller.mutation(api.projects.create, { name: "Launch", description: "" });
    const mine = await alice.caller.query(api.platform.organizations.mine, {});
    expect(mine!.organizations).toEqual([{ id: mine!.activeOrganizationId, name: "alice", role: "owner" }]);
    expect((await alice.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toMatchObject([{ name: "Launch", organizationId: mine!.activeOrganizationId }]);
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

    expect((await bob.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);
    expect(await bob.caller.query(api.projects.get, { id: projectId })).toBeNull();
    await expect(bob.caller.query(api.tasks.listByProject, { projectId, paginationOpts: PAGE })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.mutation(api.projects.update, { id: projectId, name: "Mine" })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.mutation(api.tasks.update, { id: taskId, title: "Mine" })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.mutation(api.projects.remove, { id: projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(bob.caller.query(api.files.listUploads, { projectId })).rejects.toThrow("PROJECT_NOT_FOUND");

    // A session pointing at an organization Bob doesn't belong to changes nothing.
    await bob.switchTo(await activeOrganization(alice.caller));
    expect((await bob.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);
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
    expect((await bob.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);
    await bob.switchTo(acme);
    const mine = await bob.caller.query(api.platform.organizations.mine, {});
    expect(mine!.activeOrganizationId).toBe(acme);
    expect(mine!.organizations.map((o) => o.role).sort()).toEqual(["member", "owner"]);

    // Every member can read and edit the organization's data.
    expect((await bob.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toMatchObject([{ _id: projectId }]);
    await bob.caller.mutation(api.tasks.create, { projectId, title: "By Bob", description: "", status: "todo" });
    await bob.caller.mutation(api.projects.update, { id: projectId, name: "Renamed by Bob" });
    expect((await alice.caller.query(api.tasks.listByProject, { projectId, paginationOpts: PAGE })).page).toMatchObject([{ title: "By Bob", ownerId: bob.userId }]);
    // New rows land in the active organization.
    const bobsProject = await bob.caller.mutation(api.projects.create, { name: "Acme second", description: "" });
    expect(await alice.caller.query(api.projects.get, { id: bobsProject })).toMatchObject({ organizationId: acme });

    // Removal takes effect on the next request: Bob falls back to his own organization.
    await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "member", where: [{ field: "_id", value: membership._id }] },
    });
    expect(await activeOrganization(bob.caller)).toBe(bobsOwn);
    expect((await bob.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);
    expect(await bob.caller.query(api.projects.get, { id: projectId })).toBeNull();
  });

  test("a create composed for one organization never lands in another the caller fell back to", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const carol = await f.user("carol");
    const shared = await alice.provision();
    await f.addMember(shared, carol.userId, "member");
    const target = await bob.provision();
    const membership = await f.addMember(target, alice.userId, "member");
    await alice.switchTo(target);
    expect(await activeOrganization(alice.caller)).toBe(target);

    // Alice composes a project for the target organization; she is removed before submitting.
    await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "member", where: [{ field: "_id", value: membership._id }] },
    });
    const draft = { name: "Confidential", description: "For target only", expectedOrganizationId: target };
    await expect(alice.caller.mutation(api.projects.create, draft)).rejects.toThrow("ORGANIZATION_CHANGED");
    expect(await f.t.run((ctx) => ctx.db.query("projects").collect())).toEqual([]);

    // The same holds when the active organization changed on purpose (another tab switched).
    const third = await f.user("dave");
    const daves = await third.provision();
    await f.addMember(daves, alice.userId, "member");
    await alice.switchTo(daves);
    await expect(alice.caller.mutation(api.projects.create, { ...draft, expectedOrganizationId: shared })).rejects.toThrow("ORGANIZATION_CHANGED");

    // A matching precondition writes where it says, and it never chooses the organization.
    const id = await alice.caller.mutation(api.projects.create, { ...draft, expectedOrganizationId: daves });
    expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({ organizationId: daves });
    await expect(alice.caller.mutation(api.projects.create, { ...draft, expectedOrganizationId: target })).rejects.toThrow("ORGANIZATION_CHANGED");
    expect((await carol.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);
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
    expect((await alice.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);

    await migrate(f);
    expect((await alice.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toMatchObject([{ _id: aliceProject }]);
    expect((await legacy.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toMatchObject([{ _id: legacyOwned }]);
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
    expect((await alice.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);
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

  test("an invitation accepted while the organization is deleted reaches none of its data, before or after cleanup", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.provision();
    await alice.caller.mutation(api.projects.create, { name: "Before deletion", description: "" });
    const invitation = await f.invite(acme, "bob@example.test", alice.userId);
    // Better Auth checks the organization and accepts the invitation before writing the member, in
    // separate transactions: delete the organization in between.
    let interleaved = false;
    const result = await f.t.action(async (ctx) => {
      const wrapped = { ...ctx, runMutation: async (ref: unknown, args: { input?: { model?: string; data?: { userId?: string } } }) => {
        if (!interleaved && args?.input?.model === "member" && args.input.data?.userId === bob.userId) {
          interleaved = true;
          const deleted = await f.t.fetch("/api/auth/organization/delete", {
            method: "POST",
            headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: "Bearer alice-session" },
            body: JSON.stringify({ organizationId: acme }),
          });
          expect(deleted.status, await deleted.clone().text()).toBe(200);
        }
        return ctx.runMutation(ref as never, args as never);
      } };
      const response = await createAuth(wrapped as never).handler(new Request("http://localhost:3001/api/auth/organization/accept-invitation", {
        method: "POST",
        headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: "Bearer bob-session" },
        body: JSON.stringify({ invitationId: invitation._id }),
      }));
      return response.status;
    });
    expect(interleaved).toBe(true);
    expect(result).not.toBe(200);
    expect((await bob.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(bob.caller.mutation(api.projects.create, { name: "After deletion", description: "" })).rejects.toThrow("NO_ORGANIZATION");
    expect(await f.t.run((ctx) => ctx.db.query("projects").collect())).toEqual([]);
  });

  test("a membership left behind in a deleted organization reaches none of its data", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.provision();
    const secret = await alice.caller.mutation(api.projects.create, { name: "Secret", description: "" });
    const bobsOwn = await bob.provision();
    await f.addMember(acme, bob.userId, "member");
    await bob.switchTo(acme);
    await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "organization", where: [{ field: "_id", value: acme }] },
    });
    expect(await bob.caller.query(api.projects.get, { id: secret })).toBeNull();
    // Writes wait for an explicit switch to the organization the reads now show.
    await expect(bob.caller.mutation(api.projects.create, { name: "Mine", description: "" })).rejects.toThrow("ORGANIZATION_CHANGED");
    await bob.switchTo(bobsOwn);
    const id = await bob.caller.mutation(api.projects.create, { name: "Mine", description: "" });
    expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({ organizationId: bobsOwn });
  });

  test("losing the selected organization stops writes, not reads, until the session switches", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const carol = await f.user("carol");
    const shared = await alice.provision();
    await f.addMember(shared, carol.userId, "member");
    const target = await bob.provision();
    const membership = await f.addMember(target, alice.userId, "member");
    await alice.switchTo(target);
    await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "member", where: [{ field: "_id", value: membership._id }] },
    });

    // Reads move to the oldest membership and say the selection is stale.
    expect(await alice.caller.query(api.platform.organizations.mine, {})).toMatchObject({ activeOrganizationId: shared, selectionStale: true });
    expect((await alice.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);
    // A write without any precondition is refused too, and nothing lands in the shared organization.
    await expect(alice.caller.mutation(api.projects.create, { name: "Draft for target", description: "" })).rejects.toThrow("ORGANIZATION_CHANGED");
    expect((await carol.caller.query(api.projects.list, { paginationOpts: PAGE })).page).toEqual([]);

    // Re-admission restores the selection only because the session never switched; once the UI
    // switches (OrganizationAccessNotice), the old selection is gone for good.
    await alice.switchTo(shared);
    expect(await alice.caller.query(api.platform.organizations.mine, {})).toMatchObject({ activeOrganizationId: shared, selectionStale: false });
    await f.addMember(target, alice.userId, "member");
    expect(await activeOrganization(alice.caller)).toBe(shared);
    const id = await alice.caller.mutation(api.projects.create, { name: "Shared", description: "" });
    expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({ organizationId: shared });

    // A session that never selected an organization still starts in the oldest membership.
    const dave = await f.user("dave");
    const daves = await dave.provision();
    await dave.switchTo(null);
    const own = await dave.caller.mutation(api.projects.create, { name: "Dave's", description: "" });
    expect(await f.t.run((ctx) => ctx.db.get(own))).toMatchObject({ organizationId: daves });
  });

  test("an administrator deleting the organization removes its projects too", async () => {
    const f = await fixture();
    const boss = await f.user("boss", { role: "admin" });
    const alice = await f.user("alice");
    await alice.provision();
    await alice.caller.mutation(api.projects.create, { name: "Doomed", description: "" });
    const acme = await activeOrganization(alice.caller);
    await boss.caller.mutation(api.platform.adminOrganizations.remove, { organizationId: acme });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.run((ctx) => ctx.db.query("projects").collect())).toEqual([]);
    // The cleanup records that it finished, and a duplicate delivery does nothing.
    const cleanup = () => f.t.run((ctx) => ctx.db.query("organizationCleanups").collect());
    expect(await cleanup()).toMatchObject([{ organizationId: acme, state: "done", attempts: 0 }]);
    await f.t.action(internal.platform.organizations.deleteOrganizationAppData, { organizationId: acme });
    expect(await cleanup()).toMatchObject([{ state: "done" }]);
  });

  test("deleting its last member's account removes its projects, tasks and files, through either deletion path", async () => {
    const f = await fixture();
    const admin = await f.user("admin", { role: "admin" });
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const carol = await f.user("carol");
    await alice.provision();
    await bob.provision();
    await carol.provision();
    const seed = async (who: typeof alice, name: string) => {
      const projectId = await who.caller.mutation(api.projects.create, { name, description: "" });
      await who.caller.mutation(api.tasks.create, { projectId, title: "T", description: "", status: "todo" });
      const storageId = await f.t.run(async (ctx) => {
        const id = await ctx.storage.store(new Blob(["file"]));
        await ctx.db.insert("uploads", {
          storageId: id, name: "f.txt", contentType: "text/plain", size: 4, projectId, ownerId: "x", createdAt: Date.now(), ownershipVersion: 1,
        });
        return id;
      });
      return { projectId, storageId };
    };
    const alices = await seed(alice, "Alice's");
    const bobs = await seed(bob, "Bob's");
    const carols = await seed(carol, "Carol's");

    // Better Auth's user.delete hook, and an administrator agent's adapter delete.
    await f.t.mutation(internal.platform.organizations.removeUserMemberships, { userId: alice.userId, email: "alice@example.test" });
    await admin.caller.mutation(api.platform.agentUsers.remove, { userId: bob.userId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    const left = await f.t.run(async (ctx) => ({
      projects: (await ctx.db.query("projects").collect()).map((project) => project._id),
      tasks: (await ctx.db.query("tasks").collect()).map((task) => task.projectId),
      uploads: (await ctx.db.query("uploads").collect()).map((upload) => upload.projectId),
      files: await Promise.all([alices, bobs, carols].map(({ storageId }) => ctx.storage.getUrl(storageId))),
    }));
    expect(left.projects).toEqual([carols.projectId]);
    expect(left.tasks).toEqual([carols.projectId]);
    expect(left.uploads).toEqual([carols.projectId]);
    expect(left.files.map((url) => url !== null)).toEqual([false, false, true]);
  });
});

describe("the sample's bounded lists and deletion", () => {
  afterEach(() => { vi.useRealTimers(); });

  async function project(taskCount: number, done: number) {
    const f = await fixture();
    const alice = await f.user("alice");
    await alice.provision();
    const projectId = await alice.caller.mutation(api.projects.create, { name: "Big", description: "" });
    await f.t.run(async (ctx) => {
      for (let i = 0; i < taskCount; i++) {
        await ctx.db.insert("tasks", { title: `T${i}`, description: "", status: i < done ? "done" : "todo", projectId, ownerId: alice.userId, createdAt: i });
      }
    });
    return { ...f, alice, projectId };
  }

  test("lists page and counts stop at 99", async () => {
    const f = await project(150, 120);
    const [summary] = (await f.alice.caller.query(api.projects.listWithStats, { paginationOpts: { numItems: 12, cursor: null } })).page;
    expect(summary).toMatchObject({ taskCount: 99, doneCount: 99, uploadCount: 0, countsCapped: true });
    expect(await f.alice.caller.query(api.tasks.stats, { projectId: f.projectId })).toMatchObject({ taskCount: 99, countsCapped: true });
    await expect(f.alice.caller.query(api.projects.listWithStats, { paginationOpts: { numItems: 25, cursor: null } })).rejects.toThrow("INVALID_PAGE_SIZE");

    const first = await f.alice.caller.query(api.tasks.listByProject, { projectId: f.projectId, paginationOpts: { numItems: 100, cursor: null } });
    expect(first.page).toHaveLength(100);
    expect(first.isDone).toBe(false);
    const todo = await f.alice.caller.query(api.tasks.listByProject, { projectId: f.projectId, status: "todo", paginationOpts: PAGE });
    expect(todo.page).toHaveLength(30);
    expect(todo.page.every((task) => task.status === "todo")).toBe(true);
    await expect(f.alice.caller.query(api.tasks.listByProject, { projectId: f.projectId, paginationOpts: { numItems: 101, cursor: null } })).rejects.toThrow("INVALID_PAGE_SIZE");
    // A URL with something that isn't a project ID finds nothing.
    expect(await f.alice.caller.query(api.projects.get, { id: "not-a-project" })).toBeNull();
  });

  test("a large project goes at once; its remaining rows go in background batches", async () => {
    vi.useFakeTimers();
    const f = await project(650, 0);
    await f.alice.caller.mutation(api.projects.remove, { id: f.projectId });
    expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toBeNull();
    // 500 went in the deleting call; the rest are unreachable without their project.
    expect(await f.t.run(async (ctx) => (await ctx.db.query("tasks").collect()).length)).toBe(150);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.run((ctx) => ctx.db.query("tasks").collect())).toEqual([]);
  });

  test("a small project goes in the one call", async () => {
    const f = await project(40, 10);
    await f.alice.caller.mutation(api.projects.remove, { id: f.projectId });
    expect(await f.t.run((ctx) => ctx.db.query("tasks").collect())).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });
});
