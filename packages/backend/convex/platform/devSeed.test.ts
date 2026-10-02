import { describe, expect, test } from "vitest";

import { DEV_USERS } from "./devSeed";
import { evaluatePasswordStrength } from "./passwordStrength";

const password = (email: string): string => DEV_USERS.find((user) => user.email === email)!.password;

describe("dev seed accounts", () => {
  test("the planted admin password satisfies the active admin password policy", () => {
    const result = evaluatePasswordStrength(password("admin@admin.com"), "admin@admin.com", "admin");
    expect(result).toMatchObject({ valid: true, tooShort: false, score: 4, minLength: 40, warningKey: null, suggestionKeys: [] });
  });

  test("the planted passwords are the documented ones", () => {
    expect(password("admin@admin.com")).toBe("admin!admin.comadmin@admin.comadmin#admin.com");
    expect(password("user@user.com")).toBe("user@user.comuser@user.comuser@user.com");
  });
});
