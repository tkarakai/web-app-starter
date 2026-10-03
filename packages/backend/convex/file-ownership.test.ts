import { TextEncoder } from "node:util";
import { describe, expect, test } from "vitest";

import { api, components, internal } from "./_generated/api";
import authSchema from "./platform/betterAuth/schema";
import { createTestEnv } from "./test.modules";

const authModules = import.meta.glob("./platform/betterAuth/**/*.*s");
const bytes = (value = "private bytes") => new TextEncoder().encode(value).buffer;

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, authModules);
  async function user(name: string) {
    const now = Date.now();
    const account = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "user", data: {
        name, email: `${name}@example.test`, emailVerified: true, createdAt: now, updatedAt: now,
      } },
    });
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "session", data: {
        userId: account._id, token: `${name}-session`, createdAt: now, updatedAt: now,
        expiresAt: now + 3600_000,
      } },
    });
    const caller = t.withIdentity({ subject: account._id, sessionId: session._id });
    const projectId = await caller.mutation(api.projects.create, { name, description: "" });
    return { caller, projectId, userId: account._id };
  }
  const alice = await user("alice");
  const bob = await user("bob");
  const id = await alice.caller.action(api.files.uploadFile, {
    projectId: alice.projectId, name: "private.txt", contentType: "text/plain", bytes: bytes(),
  });
  const upload = await t.run(async (ctx) => (await ctx.db.get(id))!);
  return { t, alice, bob, id, upload };
}

describe("private file ownership", () => {
  test("the upload action binds ownership and reads return bytes without storage URLs", async () => {
    const f = await fixture();
    expect(f.upload).toMatchObject({ ownerId: f.alice.userId, ownershipVersion: 1, size: 13 });
    const listed = await f.alice.caller.query(api.files.listUploads, { projectId: f.alice.projectId });
    expect(listed).toEqual([{ _id: f.id, name: "private.txt", size: 13, contentType: "text/plain", available: true }]);
    expect(await f.alice.caller.action(api.files.downloadFile, { id: f.id }))
      .toEqual({ bytes: bytes(), name: "private.txt", contentType: "text/plain" });
  });

  test("a foreign storage ID cannot be attached to the caller's own project", async () => {
    const f = await fixture();
    await expect(f.bob.caller.mutation(api.files.saveUpload, {
      storageId: f.upload.storageId, projectId: f.bob.projectId, name: "alias.txt",
    })).rejects.toThrow("USE_AUTHENTICATED_UPLOAD");
    await f.bob.caller.mutation(api.projects.remove, { id: f.bob.projectId });
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(f.upload.storageId))?.text())).toBe("private bytes");
  });

  test("unregistered objects and old upload URLs cannot be claimed, even concurrently", async () => {
    const f = await fixture();
    const orphan = await f.t.run((ctx) => ctx.storage.store(new Blob(["old upload"])));
    const claims = await Promise.allSettled([f.alice, f.bob].map(({ caller, projectId }) =>
      caller.mutation(api.files.saveUpload, { storageId: orphan, projectId, name: "claim.txt" })));
    expect(claims.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(orphan))?.text())).toBe("old upload");
    await expect(f.alice.caller.mutation(api.files.generateUploadUrl, {})).rejects.toThrow("USE_AUTHENTICATED_UPLOAD");
  });

  test("concurrent authentic uploads remain separate; finalization cannot register an ID twice", async () => {
    const f = await fixture();
    const ids = await Promise.all([f.alice, f.bob].map(({ caller, projectId }) =>
      caller.action(api.files.uploadFile, { projectId, name: "same.txt", contentType: "text/plain", bytes: bytes() })));
    const rows = await f.t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
    expect(new Set(rows.map((row) => row!.storageId)).size).toBe(2);
    await expect(f.alice.caller.mutation(internal.files.finishUpload, {
      projectId: f.alice.projectId, storageId: f.upload.storageId, name: "duplicate.txt",
      contentType: "text/plain", size: 13, ownerId: f.alice.userId,
    })).rejects.toThrow("FILE_ALREADY_REGISTERED");
  });

  test.each(["anonymous", "non-owner"] as const)("%s cannot download or upload private bytes", async (persona) => {
    const f = await fixture();
    const caller = persona === "anonymous" ? f.t : f.bob.caller;
    await expect(caller.action(api.files.downloadFile, { id: f.id })).rejects.toThrow(
      persona === "anonymous" ? "NOT_AUTHENTICATED" : "PROJECT_NOT_FOUND",
    );
    await expect(caller.action(api.files.uploadFile, {
      projectId: f.alice.projectId, name: "injected.txt", contentType: "text/plain", bytes: bytes(),
    })).rejects.toThrow(persona === "anonymous" ? "NOT_AUTHENTICATED" : "PROJECT_NOT_FOUND");
    expect(await f.t.run((ctx) => ctx.db.query("uploads").collect())).toHaveLength(1);
  });

  test("project permission changes deny previously authorized downloads", async () => {
    const f = await fixture();
    await f.alice.caller.action(api.files.downloadFile, { id: f.id });
    await f.t.run((ctx) => ctx.db.patch(f.alice.projectId, { ownerId: f.bob.userId }));
    await expect(f.alice.caller.action(api.files.downloadFile, { id: f.id })).rejects.toThrow("PROJECT_NOT_FOUND");
    await expect(f.bob.caller.action(api.files.downloadFile, { id: f.id })).rejects.toThrow("FILE_QUARANTINED");
  });

  test("banning an owner denies future file operations", async () => {
    const f = await fixture();
    await f.t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "user", where: [{ field: "_id", value: f.alice.userId }], update: { banned: true } },
    });
    await expect(f.alice.caller.action(api.files.downloadFile, { id: f.id })).rejects.toThrow("NOT_AUTHENTICATED");
    await expect(f.alice.caller.mutation(api.files.deleteUpload, { id: f.id })).rejects.toThrow("NOT_AUTHENTICATED");
    expect(await f.alice.caller.query(api.files.listUploads, { projectId: f.alice.projectId })).toBeNull();
  });

  test.each(["same owner", "foreign owner"])("%s legacy aliases block direct and cascade deletion", async (kind) => {
    const f = await fixture();
    const target = kind === "same owner" ? f.alice : f.bob;
    const projectId = await target.caller.mutation(api.projects.create, { name: "Alias", description: "" });
    const alias = await f.t.run((ctx) => ctx.db.insert("uploads", {
      storageId: f.upload.storageId, name: "legacy.txt", contentType: "text/plain", size: 13,
      projectId, ownerId: target.userId, createdAt: Date.now(),
    }));
    await expect(target.caller.mutation(api.files.deleteUpload, { id: alias })).rejects.toThrow("FILE_QUARANTINED");
    await expect(target.caller.mutation(api.projects.remove, { id: projectId })).rejects.toThrow("FILE_QUARANTINED");
    await expect(f.alice.caller.mutation(api.files.deleteUpload, { id: f.id })).rejects.toThrow("FILE_QUARANTINED");
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(f.upload.storageId))?.text())).toBe("private bytes");
    expect(await f.t.run((ctx) => ctx.db.get(projectId))).not.toBeNull();
    const inventory = await f.t.query(internal.files.inventoryLegacyUploads, { paginationOpts: { numItems: 100, cursor: null } });
    expect(inventory.page).toHaveLength(2);
    expect(inventory.page.every((row) => row.references.length === 2)).toBe(true);
    expect(inventory.page.find((row) => row.uploadId === alias)?.ownershipVerified).toBe(false);
  });

  test("legacy singleton rows remain unavailable and bytes are preserved for operator review", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.id, { ownershipVersion: undefined }));
    expect(await f.alice.caller.query(api.files.listUploads, { projectId: f.alice.projectId }))
      .toMatchObject([{ available: false }]);
    await expect(f.alice.caller.action(api.files.downloadFile, { id: f.id })).rejects.toThrow("FILE_QUARANTINED");
    await expect(f.alice.caller.mutation(api.projects.remove, { id: f.alice.projectId })).rejects.toThrow("FILE_QUARANTINED");
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(f.upload.storageId))?.text())).toBe("private bytes");
  });

  test("cleanup preserves committed uploads and removes only unattached objects", async () => {
    const f = await fixture();
    await f.t.mutation(internal.files.discardUnattachedUpload, { storageId: f.upload.storageId });
    expect(await f.alice.caller.action(api.files.downloadFile, { id: f.id })).toMatchObject({ bytes: bytes() });
    const orphan = await f.t.run((ctx) => ctx.storage.store(new Blob(["unattached"])));
    await f.t.mutation(internal.files.discardUnattachedUpload, { storageId: orphan });
    expect(await f.t.run((ctx) => ctx.storage.get(orphan))).toBeNull();
  });

  test("the size limit accepts 1 MiB and rejects oversize or disallowed input before storage", async () => {
    const f = await fixture();
    const id = await f.alice.caller.action(api.files.uploadFile, {
      projectId: f.alice.projectId, name: "limit.txt", contentType: "text/plain", bytes: new ArrayBuffer(1_048_576),
    });
    expect((await f.alice.caller.action(api.files.downloadFile, { id })).bytes.byteLength).toBe(1_048_576);
    for (const [contentType, size, error] of [["text/plain", 1_048_577, "FILE_TOO_LARGE"], ["text/html", 10, "FILE_TYPE_NOT_ALLOWED"]] as const) {
      await expect(f.alice.caller.action(api.files.uploadFile, {
        projectId: f.alice.projectId, name: "invalid.txt", contentType, bytes: new ArrayBuffer(size),
      })).rejects.toThrow(error);
    }
    expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(2);
  });
});
