import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

/** The pre-onboarding-type `waitlistEnabled` setting never opens public sign-up by itself. */
describe("legacy waitlistEnabled", () => {
  const withLegacy = async (value: string) => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("appSettings", { key: "waitlistEnabled", value, updatedAt: Date.now() }));
    return await t.query(api.appSettings.get, { key: "onboardingType" });
  };

  test("true still means a public waitlist", async () => {
    expect(await withLegacy("true")).toBe("publicWaitlist");
  });

  test.each(["false", "0", "garbage"])("%s falls back to invite only, not public sign-up", async (value) => {
    expect(await withLegacy(value)).toBe("inviteOnly");
  });
});
