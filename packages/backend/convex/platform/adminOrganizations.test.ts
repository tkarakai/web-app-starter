// Administrator view and support actions over every organization (admin app and agents).
import { describe, expect, test, vi } from "vitest";

import { api, components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { organizationFixture } from "./organizations.test-helpers";

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const boss = await f.user("boss", { role: "admin" });
  const alice = await f.user("alice");
  const bob = await f.user("bob");
  const acme = await alice.provision();
  await f.addMember(acme, bob.userId, "admin");
  return { ...f, boss, alice, bob, acme };
}

const orgs = api.platform.adminOrganizations;

describe("admin organizations", () => {
  test("administrators list and inspect every organization; nobody else can", async () => {
    const f = await fixture();
    const carol = await f.user("carol");
    const carols = await carol.provision();
    await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: f.acme, email: "carol@example.test", role: "member", status: "pending",
        inviterId: f.alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });

    const page = await f.boss.caller.query(orgs.list, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page.map((o) => o.id).sort()).toEqual([f.acme, carols].sort());
    expect(page.page.find((o) => o.id === f.acme)).toMatchObject({
      name: "alice", memberCount: 2, pendingInvitations: 1, owners: [{ userId: f.alice.userId, email: "alice@example.test" }],
    });
    expect((await f.boss.caller.query(orgs.list, { paginationOpts: { numItems: 10, cursor: null }, search: "ali" })).page.map((o) => o.id)).toEqual([f.acme]);

    const detail = await f.boss.caller.query(orgs.get, { organizationId: f.acme });
    expect(detail.members.map((m) => [m.email, m.role])).toEqual([["alice@example.test", "owner"], ["bob@example.test", "admin"]]);
    expect(detail.invitations).toMatchObject([{ email: "carol@example.test", status: "pending" }]);

    await expect(f.alice.caller.query(orgs.list, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("NOT_ADMIN");
    await expect(f.alice.caller.query(orgs.get, { organizationId: f.acme })).rejects.toThrow("NOT_ADMIN");
    await expect(f.alice.caller.mutation(orgs.remove, { organizationId: f.acme })).rejects.toThrow("NOT_ADMIN");
  });

  test("forUser shows what deleting the account would do to each organization", async () => {
    const f = await fixture();
    const solo = await f.user("solo");
    const own = await solo.provision();
    await f.addMember(f.acme, solo.userId, "member");
    const dave = await f.user("dave");
    const daves = await dave.provision();
    await f.addMember(daves, solo.userId, "owner");

    expect(await f.boss.caller.query(orgs.forUser, { userId: f.alice.userId })).toMatchObject([
      { organizationId: f.acme, role: "owner", soleOwner: true, onAccountDeletion: "ownershipPasses", successor: { userId: f.bob.userId } },
    ]);
    const solos = await f.boss.caller.query(orgs.forUser, { userId: solo.userId });
    expect(Object.fromEntries(solos.map((m) => [m.organizationId, m.onAccountDeletion]))).toEqual({
      [own]: "organizationDeleted", [f.acme]: "membershipRemoved", [daves]: "membershipRemoved",
    });
  });

  test("ownership can be transferred, but the only owner can never be removed", async () => {
    const f = await fixture();
    await expect(f.boss.caller.mutation(orgs.removeOwner, { organizationId: f.acme, userId: f.alice.userId, role: "admin" })).rejects.toThrow("LAST_OWNER");
    await expect(f.boss.caller.mutation(orgs.addOwner, { organizationId: f.acme, userId: f.boss.userId })).rejects.toThrow("MEMBER_NOT_FOUND");

    await f.boss.caller.mutation(orgs.addOwner, { organizationId: f.acme, userId: f.bob.userId });
    await f.boss.caller.mutation(orgs.removeOwner, { organizationId: f.acme, userId: f.alice.userId, role: "member" });
    expect((await f.members(f.acme)).map((m) => [m.userId, m.role])).toEqual([[f.alice.userId, "member"], [f.bob.userId, "owner"]]);
    await expect(f.boss.caller.mutation(orgs.removeOwner, { organizationId: f.acme, userId: f.bob.userId, role: "admin" })).rejects.toThrow("LAST_OWNER");
  });

  test("an administrator cancels a pending invitation", async () => {
    const f = await fixture();
    const invitation = await f.t.mutation(components.betterAuth.adapter.create, {
      input: { model: "invitation", data: {
        organizationId: f.acme, email: "carol@example.test", role: "member", status: "pending",
        inviterId: f.alice.userId, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000,
      } },
    });
    await f.boss.caller.mutation(orgs.cancelInvitation, { invitationId: invitation._id });
    expect((await f.boss.caller.query(orgs.get, { organizationId: f.acme })).invitations).toEqual([]);
    await expect(f.boss.caller.mutation(orgs.cancelInvitation, { invitationId: invitation._id })).rejects.toThrow("INVITATION_NOT_PENDING");
  });

  // App data cleanup is the app's organizationData.ts; the sample tests it in organization-projects.test.ts.
  test("deleting an organization removes memberships and invitations, and keeps accounts", async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      await f.boss.caller.mutation(orgs.remove, { organizationId: f.acme });
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await f.members(f.acme)).toEqual([]);
      expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "organization", where: [{ field: "_id", value: f.acme }] })).toBeNull();
      expect(await f.alice.caller.query(api.platform.organizations.mine, {})).toMatchObject({ activeOrganizationId: null, organizations: [] });
      await expect(f.boss.caller.query(orgs.get, { organizationId: f.acme })).rejects.toThrow("ORGANIZATION_NOT_FOUND");
    } finally {
      vi.useRealTimers();
    }
  });

  test("deleting an organization ends its plan, so its payer and the payer's last member can go", async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      const actor = { email: "test" };
      const carol = await f.user("carol");
      const payer = await carol.provision();
      await f.t.mutation(components.platform.billing.ensureSeeded, {});
      const free = (await f.t.query(components.platform.billing.listPlans, {})).find((plan) => plan.isSeeded)!;
      const payerBilling = await f.t.mutation(components.platform.billing.createBilling, { organizationId: payer, organizationName: "Payer", paymentMethod: "cash", actor });
      // Acme is paid for by carol's organization and has a billing row of its own.
      const acmeBilling = await f.t.mutation(components.platform.billing.createBilling, { organizationId: f.acme, organizationName: "Acme", actor });
      await f.t.mutation(components.platform.billing.startPlan, { organizationId: f.acme, organizationName: "Acme", planId: free._id, billingOrganizationId: payerBilling, actor });
      await expect(f.boss.caller.mutation(orgs.remove, { organizationId: payer })).rejects.toThrow("BILLING_ORGANIZATION_IN_USE");

      await f.boss.caller.mutation(orgs.remove, { organizationId: f.acme });
      expect(await f.t.query(components.platform.billing.currentPlan, { organizationId: f.acme })).toBeNull();
      expect(await f.t.query(components.platform.billing.paidBy, { billingOrganizationId: payerBilling })).toEqual([]);
      const acmeRow = await f.t.query(components.platform.billing.billingByOrganization, { organizationId: f.acme });
      expect(acmeRow).toMatchObject({ _id: acmeBilling, deletedAt: expect.any(Number) });

      expect(await f.t.query(internal.platform.userDeletion.blockerFor, { userId: carol.userId })).toBeNull();
      await f.boss.caller.mutation(orgs.remove, { organizationId: payer });
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await f.organization(payer)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
