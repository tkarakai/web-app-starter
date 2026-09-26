import { createTestEnv as createPlatformTest } from "../test.modules";
import { describe, expect, test } from "vitest";
import { api, components } from "../_generated/api";
import authSchema from "./betterAuth/schema";
import { evaluatePasswordStrength, validatePasswordStrength } from "./passwordStrength";

const authModules = import.meta.glob("./betterAuth/**/*.*s");

async function resetAccount(role: "admin" | "user", expiresAt = Date.now() + 60_000) {
  const t = createPlatformTest();
  t.registerComponent("betterAuth", authSchema, authModules);
  const email = "orchidquartz@example.com";
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "user", data: { email, name: "Test", emailVerified: true, createdAt: Date.now(), updatedAt: Date.now() } },
  });
  await t.mutation(components.betterAuth.adapter.create, {
    input: { model: "verification", data: { identifier: "reset-password:test-token", value: user._id, expiresAt, createdAt: Date.now(), updatedAt: Date.now() } },
  });
  if (role === "admin") await t.mutation(components.platform.adminEmails.ensure, { email });
  return { t, email };
}

describe("consistent password evaluation", () => {
  test.each(["admin", "user"] as const)("reset and settings produce identical feedback for %s", async (role) => {
    const { t, email } = await resetAccount(role);
    for (const password of ["orchidquartz", "orchid-quartz-river-lantern", "orchid quartz lantern telescope meadow violin glacier"]) {
      const reset = await t.query(api.platform.passwordStrength.evaluate, { password, email: "wrong@example.com", role: role === "admin" ? "user" : "admin", resetToken: "test-token" });
      const settings = await t.query(api.platform.passwordStrength.evaluate, { password, email, role });
      expect(reset).toEqual(settings);
      expect(reset?.minLength).toBe(role === "admin" ? 40 : 12);
      expect(reset?.valid).toBe(validatePasswordStrength(password, email, role).valid);
      expect(reset).not.toHaveProperty("email");
    }
  });

  test("expired and invalid tokens cannot fall back to client-provided policy", async () => {
    const { t } = await resetAccount("admin", Date.now() - 1000);
    for (const resetToken of ["test-token", "missing", ""]) {
      expect(await t.query(api.platform.passwordStrength.evaluate, { password: "orchid quartz lantern telescope meadow violin glacier", email: "", role: "user", resetToken })).toBeNull();
    }
  });

  test.each(["admin", "user"] as const)("the %s bar and validator agree at length boundaries", (role) => {
    const minLength = role === "admin" ? 40 : 12;
    for (const password of ["a".repeat(minLength), "orchid quartz lantern telescope meadow violin glacier".slice(0, minLength - 1), "orchid quartz lantern telescope meadow violin glacier"]) {
      const result = evaluatePasswordStrength(password, "person@example.com", role);
      expect(result.valid).toBe(validatePasswordStrength(password, "person@example.com", role).valid);
      if (result.tooShort) expect(result.score).toBeLessThanOrEqual(2);
    }
  });
});
