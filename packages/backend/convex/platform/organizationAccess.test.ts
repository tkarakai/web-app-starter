// Looking rows up by caller-supplied ID: a malformed ID or another table's ID is "not found";
// nothing else is quietly turned into null.
import { expect, test } from "vitest";

import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { findById, isMalformedIdError } from "./organizationAccess";
import { organizationFixture } from "./organizations.test-helpers";

test("an ID from another table, or no ID at all, is not found", async () => {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  const f = await organizationFixture(t);
  const alice = await f.user("alice");
  const acme = await alice.provision();
  await t.run(async (ctx) => {
    expect(await findById(ctx, "organization", acme)).toMatchObject({ _id: acme });
    expect(await findById(ctx, "user", alice.userId)).toMatchObject({ _id: alice.userId });
    // db.get accepts any table's ID; a user is never returned as an organization.
    expect(await findById(ctx, "organization", alice.userId)).toBeNull();
    expect(await findById(ctx, "invitation", acme)).toBeNull();
    expect(await findById(ctx, "organization", "not-an-id")).toBeNull();
  });
});

test("only Convex's refusal of a malformed ID counts as not found", () => {
  expect(isMalformedIdError(new Error("Invalid argument `id` for `db.get`: Unable to decode ID: Invalid ID length 9"))).toBe(true);
  expect(isMalformedIdError(new Error("Too many reads in a single function execution"))).toBe(false);
  expect(isMalformedIdError("Unable to decode ID")).toBe(false);
});
