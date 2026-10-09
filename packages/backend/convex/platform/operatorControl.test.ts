import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api, components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  async function actor(role: string, customerAdmission?: "public-signup") {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: "Control fixture", email: `${randomUUID()}@example.test`, emailVerified: true, role, customerAdmission, createdAt: now, updatedAt: now,
    } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: user._id, token: randomUUID(), assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
      expiresAt: now + 3_600_000, createdAt: now, updatedAt: now,
    } } });
    return { user, client: t.withIdentity({ subject: user._id, sessionId: session._id }) };
  }
  const operator = await actor("admin"); const customer = await actor("user");
  const organization = await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: customer.user._id });
  await t.mutation(components.platform.appSettings.putRaw, { key: "controlTest", value: '"private control"' });
  return { t, actor, operator, customer, organization };
}

describe("canonical operator authority across shared control builders", () => {
  test("personal organization administrator cannot read or mutate global operator controls", async () => {
    const f = await fixture();
    expect(await f.operator.client.query(api.platform.appSettings.get, { key: "controlTest" })).toBe("private control");
    await expect(f.customer.client.query(api.platform.appSettings.get, { key: "controlTest" })).rejects.toThrow("NOT_ADMIN");
    await expect(f.customer.client.query(api.platform.announcements.list, {})).rejects.toThrow("NOT_ADMIN");
    await expect(f.customer.client.mutation(api.platform.appSettings.set, { key: "controlTest", value: "null" })).rejects.toThrow("NOT_ADMIN");
    expect(await f.operator.client.query(api.platform.appSettings.get, { key: "controlTest" })).toBe("private control");
  });

  test("mixed global roles and durable customer intent are not canonical operator authority", async () => {
    const f = await fixture();
    for (const actor of [await f.actor("admin,user"), await f.actor("admin", "public-signup")]) {
      await expect(actor.client.query(api.platform.appSettings.get, { key: "controlTest" })).rejects.toThrow("NOT_ADMIN");
      await expect(actor.client.mutation(api.platform.appSettings.remove, { key: "controlTest" })).rejects.toThrow("NOT_ADMIN");
      expect((await actor.client.query(api.platform.waitlist.list, { paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
      expect((await actor.client.query(api.platform.adminInvitations.list, { paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
    }
  });

  test("protected-email projection does not turn reservation into an operator identity directory", async () => {
    const f = await fixture();
    const addresses = [f.operator.user.email, f.customer.user.email, "pending-operator@example.test"];
    for (const email of addresses) await f.t.mutation(components.platform.adminEmails.ensure, { email });
    expect(await f.operator.client.query(api.platform.adminEmails.listProtected, {})).toEqual([f.operator.user.email]);
    expect((await f.t.query(components.platform.adminEmails.list, {})).map(row => row.email).sort()).toEqual(addresses.sort());
  });

  test("live membership invalidates a previous operator session without deleting its identity or authority records", async () => {
    const f = await fixture();
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "member", data: {
      userId: f.operator.user._id, organizationId: f.organization.organizationId, role: "member", createdAt: Date.now(),
    } } });
    await expect(f.operator.client.query(api.platform.appSettings.get, { key: "controlTest" })).rejects.toThrow("NOT_ADMIN");
    await expect(f.operator.client.mutation(api.platform.appSettings.remove, { key: "controlTest" })).rejects.toThrow("NOT_ADMIN");
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: f.operator.user._id }] })).toMatchObject({ role: "admin" });
    expect(await f.t.query(components.platform.appSettings.getRaw, { key: "controlTest" })).not.toBeNull();
  });
});
