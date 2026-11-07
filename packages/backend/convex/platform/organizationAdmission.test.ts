// Joining an organization: never one that is gone or being deleted, never past the membership
// limit, never where no owner can act; and every membership is seen, however many there are.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { createAuth } from "./auth";
import { organizationFixture } from "./organizations.test-helpers";
import { MAX_MEMBERSHIPS_PER_USER } from "./organizationAccess";
import { organizationSeats } from "./organizationOwnership";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "organization-admission-test-secret-at-least-32-chars");
  vi.stubEnv("SITE_URL", "http://localhost:3001");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
});
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  const alice = await f.user("alice");
  const bob = await f.user("bob");
  const acme = await alice.provision();
  const request = (path: string, body: unknown, who: string) => new Request(`http://localhost:3001/api/auth${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: `Bearer ${who}-session` },
    body: JSON.stringify(body),
  });
  const post = (path: string, body: unknown, who: string) => t.fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: `Bearer ${who}-session` },
    body: JSON.stringify(body),
  });
  /**
   * Accept an invitation through Better Auth, running `interleave` just before the member row is
   * written: Better Auth checks the organization and marks the invitation accepted first, in
   * separate transactions, so other writes can commit in between.
   */
  const acceptWith = async (invitationId: string, who: string, userId: string, interleave: () => Promise<void>) => {
    let interleaved = false;
    const result = await t.action(async (ctx) => {
      const wrapped = { ...ctx, runMutation: async (ref: unknown, args: { input?: { model?: string; data?: { userId?: string } } }) => {
        if (!interleaved && args?.input?.model === "member" && args.input.data?.userId === userId) {
          interleaved = true;
          await interleave();
        }
        return ctx.runMutation(ref as never, args as never);
      } };
      const response = await createAuth(wrapped as never).handler(request("/organization/accept-invitation", { invitationId }, who));
      return { status: response.status, body: await response.text() };
    });
    expect(interleaved).toBe(true);
    return result;
  };
  return { ...f, boss, alice, bob, acme, post, acceptWith };
}

describe("joining a deleted organization", () => {
  test("an invitation accepted while its organization is deleted adds nobody", async () => {
    const f = await fixture();
    const invitation = await f.invite(f.acme, "bob@example.test", f.alice.userId);
    const result = await f.acceptWith(invitation._id, "bob", f.bob.userId, async () => {
      const deleted = await f.post("/organization/delete", { organizationId: f.acme }, "alice");
      expect(deleted.status, await deleted.clone().text()).toBe(200);
    });
    // The member trigger refuses the write in its own transaction (the before-hook saw a live organization).
    expect(result.status, result.body).not.toBe(200);
    expect(await f.organization(f.acme)).toBeNull();
    expect(await f.members(f.acme)).toEqual([]);
    expect(await f.bob.caller.query(api.platform.organizations.mine, {})).toMatchObject({ activeOrganizationId: null, organizations: [] });
  });

  test("an invitation accepted while its last member's account is deleted adds nobody", async () => {
    const f = await fixture();
    const invitation = await f.invite(f.acme, "bob@example.test", f.alice.userId);
    const result = await f.acceptWith(invitation._id, "bob", f.bob.userId, async () => {
      await f.boss.caller.mutation(api.platform.agentUsers.remove, { userId: f.alice.userId });
    });
    expect(result.status, result.body).not.toBe(200);
    expect(await f.organization(f.acme)).toBeNull();
    expect(await f.members(f.acme)).toEqual([]);
  });

  test("a membership left behind in a deleted organization grants nothing", async () => {
    // Rows written before the member trigger refused them: the active organization ignores them.
    const f = await fixture();
    const bobsOwn = await f.bob.provision();
    await f.addMember(f.acme, f.bob.userId, "member");
    await f.bob.switchTo(f.acme);
    await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "organization", where: [{ field: "_id", value: f.acme }] },
    });
    expect(await f.bob.caller.query(api.platform.organizations.mine, {})).toEqual({
      activeOrganizationId: bobsOwn, selectionStale: true, organizations: [{ id: bobsOwn, name: "bob", role: "owner" }],
    });
  });
});

describe("joining where no owner can act", () => {
  test("someone who can sign in can't join an organization whose only owner is banned", async () => {
    const f = await fixture();
    const invitation = await f.invite(f.acme, "bob@example.test", f.alice.userId);
    await f.boss.caller.mutation(api.platform.agentUsers.ban, { userId: f.alice.userId });
    const accepted = await f.post("/organization/accept-invitation", { invitationId: invitation._id }, "bob");
    expect(accepted.status).not.toBe(200);
    expect(await accepted.text()).toContain("ORGANIZATION_OWNER_REQUIRED");
    const seats = await f.t.query((ctx) => organizationSeats(ctx, f.acme));
    expect(seats.map((s) => s.member.userId)).toEqual([f.alice.userId]);
  });
});

describe("many memberships", () => {
  test("joining is limited per user, and every membership past the first page is seen and removed", async () => {
    const f = await fixture();
    const host = await f.user("host");
    const invitee = await f.user("invitee");
    // Seed past both the limit and one page of 200: these rows predate the limit.
    const orgIds: string[] = [];
    for (let i = 0; i < 202; i++) {
      const org = await f.t.mutation(components.betterAuth.adapter.create, { input: {
        model: "organization", data: { name: `Organization ${i}`, slug: `org-${i}`, createdAt: Date.now() + i },
      } });
      orgIds.push(org._id);
      await f.addMember(org._id, host.userId, "owner");
      if (i < 201) await f.addMember(org._id, invitee.userId, i === 200 ? "owner" : "member");
    }

    // A user at or over the limit can't join another organization.
    const invitation = await f.invite(orgIds[201]!, "invitee@example.test", host.userId);
    const accepted = await f.post("/organization/accept-invitation", { invitationId: invitation._id }, "invitee");
    expect(accepted.status).not.toBe(200);
    expect(await accepted.text()).toContain("MEMBERSHIP_LIMIT_REACHED");
    expect(MAX_MEMBERSHIPS_PER_USER).toBeLessThan(201);

    // Every existing membership is listed, including the owner role past the first page.
    const mine = await invitee.caller.query(api.platform.organizations.mine, {});
    expect(mine!.organizations).toHaveLength(201);
    expect(mine!.organizations.filter((o) => o.role === "owner").map((o) => o.id)).toEqual([orgIds[200]]);

    // Deleting the account removes every membership.
    await f.boss.caller.mutation(api.platform.agentUsers.remove, { userId: invitee.userId });
    const left = await f.t.query(components.betterAuth.adapter.findMany, {
      model: "member", where: [{ field: "userId", value: invitee.userId }], paginationOpts: { numItems: 1000, cursor: null },
    });
    expect(left.page).toEqual([]);
    expect(await f.t.query(internal.platform.organizations.startingOrganization, { userId: invitee.userId })).toBeNull();
  });
});
