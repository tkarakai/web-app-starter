import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

describe("protected admin addresses", () => {
  test("ensuring an address is idempotent; bootstrap rescue replaces the same row", async () => {
    const t = convexTest(schema, modules);
    const email = "admin@example.test";
    const id = await t.mutation(api.adminEmails.ensure, { email });
    expect(await t.mutation(api.adminEmails.ensure, { email })).toBe(id);
    expect(await t.query(api.adminEmails.list, {})).toHaveLength(1);
    expect(await t.query(api.adminEmails.contains, { email })).toBe(true);
    await t.mutation(api.adminEmails.replace, { id, email: "correct@example.test" });
    expect(await t.query(api.adminEmails.contains, { email })).toBe(false);
    expect(await t.query(api.adminEmails.list, {})).toMatchObject([{ _id: id, email: "correct@example.test" }]);
  });

  test("seeding an onboarding record does not grant protected-admin status", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.adminInvitations.createForSeed, { email: "seed@example.test" });
    expect(await t.query(api.adminEmails.list, {})).toEqual([]);
    // Seed invitations do not silently grant privileges: the host explicitly seeds protection.
    await t.mutation(api.adminEmails.ensure, { email: "seed@example.test" });
    expect(await t.query(api.adminEmails.contains, { email: "seed@example.test" })).toBe(true);
  });
});
