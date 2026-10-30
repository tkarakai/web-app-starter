import { TextEncoder } from "node:util";
import { createTestEnv as createPlatformTest } from "./test.modules";
import { describe, expect, test } from "vitest";

import { api, components } from "./_generated/api";
import authSchema from "./platform/betterAuth/schema";

const authModules = import.meta.glob("./platform/betterAuth/**/*.*s");

async function createFixture() {
  const t = createPlatformTest();
  // Use this application's local component schema and adapter, including its
  // custom fields, rather than mocking getAuth or the ownership helper.
  t.registerComponent("betterAuth", authSchema, authModules);

  async function signIn(name: string) {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name,
          email: `${name}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
          userId: user._id,
          token: `${name}-test-session`,
          expiresAt: now + 60 * 60 * 1000,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
    return t.withIdentity({ subject: user._id, sessionId: session._id });
  }

  const owner = await signIn("alice");
  const nonOwner = await signIn("bob");
  const projectId = await owner.mutation(api.projects.create, {
    name: "Private project",
    description: "Owner only",
  });
  const otherProjectId = await nonOwner.mutation(api.projects.create, {
    name: "Other project",
    description: "Independent tenant",
  });
  const taskId = await owner.mutation(api.tasks.create, {
    projectId,
    title: "Private task",
    description: "Owner only",
    status: "todo",
  });
  const uploadId = await owner.action(api.files.uploadFile, {
    projectId, name: "private.txt", contentType: "text/plain",
    bytes: new TextEncoder().encode("private attachment").buffer,
  });
  const storageId = await t.run(async (ctx) => (await ctx.db.get(uploadId))!.storageId);

  async function snapshot() {
    return t.run(async (ctx) => ({
      projects: await ctx.db.query("projects").collect(),
      tasks: await ctx.db.query("tasks").collect(),
      uploads: await ctx.db.query("uploads").collect(),
      attachment: await (await ctx.storage.get(storageId))?.text(),
    }));
  }

  return { t, owner, nonOwner, projectId, otherProjectId, taskId, storageId, uploadId, snapshot };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;
type Caller = Fixture["owner"];

const protectedWrites = [
  ["project update", (caller: Caller, f: Fixture) =>
    caller.mutation(api.projects.update, { id: f.projectId, name: "Changed" })],
  ["project cascade deletion", (caller: Caller, f: Fixture) =>
    caller.mutation(api.projects.remove, { id: f.projectId })],
  ["task creation", (caller: Caller, f: Fixture) =>
    caller.mutation(api.tasks.create, {
      projectId: f.projectId, title: "Injected", description: "", status: "todo",
    })],
  ["task update", (caller: Caller, f: Fixture) =>
    caller.mutation(api.tasks.update, { id: f.taskId, status: "done" })],
  ["task deletion", (caller: Caller, f: Fixture) =>
    caller.mutation(api.tasks.remove, { id: f.taskId })],
  ["upload attachment", (caller: Caller, f: Fixture) =>
    caller.mutation(api.files.saveUpload, {
      projectId: f.projectId, storageId: f.storageId, name: "Injected.txt",
    })],
  ["upload deletion", (caller: Caller, f: Fixture) =>
    caller.mutation(api.files.deleteUpload, { id: f.uploadId })],
] as const;

describe("registered backend authorization contract", () => {
  test("anonymous queries return null for existing private resources", async () => {
    const f = await createFixture();
    expect(await f.t.query(api.platform.auth.getCurrentUser, {})).toBeNull();
    expect(await f.t.query(api.projects.list, {})).toBeNull();
    expect(await f.t.query(api.projects.get, { id: f.projectId })).toBeNull();
    expect(await f.t.query(api.tasks.listByProject, { projectId: f.projectId })).toBeNull();
    expect(await f.t.query(api.files.listUploads, { projectId: f.projectId })).toBeNull();
  });

  test("owners can read their resources and lists isolate tenants", async () => {
    const f = await createFixture();
    expect(await f.owner.query(api.projects.get, { id: f.projectId })).toMatchObject({
      _id: f.projectId, name: "Private project",
    });
    expect((await f.owner.query(api.projects.list, {}))?.map((p) => p._id)).toEqual([f.projectId]);
    expect((await f.nonOwner.query(api.projects.list, {}))?.map((p) => p._id)).toEqual([f.otherProjectId]);
    expect(await f.owner.query(api.tasks.listByProject, { projectId: f.projectId })).toMatchObject([
      { _id: f.taskId, title: "Private task" },
    ]);
    expect(await f.owner.query(api.files.listUploads, { projectId: f.projectId })).toMatchObject([
      { _id: f.uploadId, name: "private.txt", available: true },
    ]);
  });

  test("a signed-in non-owner cannot read project, task or upload details", async () => {
    const f = await createFixture();
    expect(await f.nonOwner.query(api.projects.get, { id: f.projectId })).toBeNull();
    await expect(f.nonOwner.query(api.tasks.listByProject, { projectId: f.projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(f.nonOwner.query(api.files.listUploads, { projectId: f.projectId })).rejects.toThrow("PROJECT_NOT_FOUND");
  });

  describe.each(["anonymous", "non-owner"] as const)("%s writes", (persona) => {
    test.each(protectedWrites)("denies %s and preserves records and stored bytes", async (_name, mutate) => {
      const f = await createFixture();
      const before = await f.snapshot();
      const caller = persona === "anonymous" ? f.t : f.nonOwner;
      await expect(mutate(caller, f)).rejects.toThrow(
        persona === "anonymous" ? "NOT_AUTHENTICATED" : "PROJECT_NOT_FOUND",
      );
      expect(await f.snapshot()).toEqual(before);
    });
  });

  test("anonymous callers cannot create projects or mint upload URLs", async () => {
    const f = await createFixture();
    const before = await f.snapshot();
    await expect(f.t.mutation(api.projects.create, { name: "Injected", description: "" })).rejects.toThrow("NOT_AUTHENTICATED");
    await expect(f.t.mutation(api.files.generateUploadUrl, {})).rejects.toThrow("NOT_AUTHENTICATED");
    expect(await f.snapshot()).toEqual(before);
  });

  test("owners can update and delete tasks and uploads", async () => {
    const f = await createFixture();
    await f.owner.mutation(api.projects.update, { id: f.projectId, name: "Renamed" });
    await f.owner.mutation(api.tasks.update, { id: f.taskId, status: "done" });
    expect(await f.owner.query(api.projects.get, { id: f.projectId })).toMatchObject({ name: "Renamed" });
    expect(await f.owner.query(api.tasks.listByProject, { projectId: f.projectId })).toMatchObject([{ status: "done" }]);
    await expect(f.owner.mutation(api.files.generateUploadUrl, {})).rejects.toThrow("USE_AUTHENTICATED_UPLOAD");

    await f.owner.mutation(api.tasks.remove, { id: f.taskId });
    await f.owner.mutation(api.files.deleteUpload, { id: f.uploadId });
    expect(await f.owner.query(api.tasks.listByProject, { projectId: f.projectId })).toEqual([]);
    expect(await f.owner.query(api.files.listUploads, { projectId: f.projectId })).toEqual([]);
    expect(await f.t.run((ctx) => ctx.storage.get(f.storageId))).toBeNull();
  });

  test("owner project deletion removes its children and bytes, preserving the other tenant", async () => {
    const f = await createFixture();
    const otherProject = await f.nonOwner.query(api.projects.get, { id: f.otherProjectId });
    await f.owner.mutation(api.projects.remove, { id: f.projectId });
    expect(await f.snapshot()).toEqual({
      projects: [otherProject], tasks: [], uploads: [], attachment: undefined,
    });
  });
});
