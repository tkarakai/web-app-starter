// The ownership invariant: an organization with members always has an owner, whichever path
// writes the membership (Better Auth routes, account deletion, admin support actions).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { organizationFixture } from "./organizations.test-helpers";
import { deleteMember, OWNER_REQUIRED, setMemberRole } from "./organizationOwnership";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "organization-ownership-test-secret-at-least-32-chars");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
});
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const post = (path: string, body: unknown, name: string) => t.fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: `Bearer ${name}-session` },
    body: JSON.stringify(body),
  });
  return { ...f, post };
}

describe("every organization with members has an owner", () => {
  test("Better Auth's own membership writes run the guard in their transaction", async () => {
    // Better Auth checks the owner count and then writes in a separate step, so concurrent
    // requests could each pass its check. The guard runs with the write instead; to show that
    // Better Auth's writes reach it, start from a state its checks would never produce.
    const f = await fixture();
    const alice = await f.user("alice");
    await f.user("bob");
    const acme = await alice.provision();
    await f.t.mutation(components.betterAuth.adapter.updateOne, {
      input: { model: "member", where: [{ field: "organizationId", value: acme }], update: { role: "member" } },
    });
    const invited = await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: acme, email: "bob@example.test", role: "member", status: "pending",
        inviterId: alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });
    const accepted = await f.post("/organization/accept-invitation", { invitationId: invited._id }, "bob");
    expect(accepted.status).not.toBe(200);
    expect((await f.members(acme)).map((m) => m.userId)).toEqual([alice.userId]);
  });

  test("platform membership writes refuse to leave members without an owner and roll back", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.provision();
    await f.addMember(acme, bob.userId, "member");
    const owner = (await f.members(acme)).find((m) => m.role === "owner")!;

    await expect(f.t.run((ctx) => setMemberRole(ctx, owner._id, "admin"))).rejects.toThrow(OWNER_REQUIRED);
    await expect(f.t.run((ctx) => deleteMember(ctx, owner._id))).rejects.toThrow(OWNER_REQUIRED);
    expect((await f.members(acme)).map((m) => m.role).sort()).toEqual(["member", "owner"]);

    // The sole member may go: an organization without members has nobody to own it for.
    const solo = await f.user("solo");
    const own = await solo.provision();
    await f.t.run(async (ctx) => deleteMember(ctx, (await f.members(own))[0]!._id));
    expect(await f.members(own)).toEqual([]);
  });

  test("an owner deleting the organization takes every member with it", async () => {
    const f = await fixture();
    const alice = await f.user("alice");
    const bob = await f.user("bob");
    const acme = await alice.provision();
    await f.addMember(acme, bob.userId, "member");
    const deleted = await f.post("/organization/delete", { organizationId: acme }, "alice");
    expect(deleted.status, await deleted.clone().text()).toBe(200);
    expect(await f.members(acme)).toEqual([]);
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "_id", value: acme }] })).toBeNull();
  });
});
