import { describe, expect, test } from "vitest";

import { REQUIRED_PASSWORD_SCORE } from "@web-app-starter/auth/password-policy";
import english from "@web-app-starter/i18n/messages/en.json";
import { evaluatePasswordStrength } from "./passwordStrength";

/**
 * Pins what the password-strength library decides for us: the score, the accept/reject outcome, the
 * feedback keys and the crack-time estimate. It guards a change of scoring library or version, which
 * can silently accept or reject passwords differently; a failure here is a security-relevant change
 * that needs a decision, not a snapshot refresh.
 */
type Role = "user" | "admin";
type Expected = { valid: boolean; score: number; warningKey: string | null; suggestionKeys: string[]; crackMagnitude: number };

const PERSON = "person@example.com";
const cases: Array<{ password: string; role: Role; email: string; expected: Expected }> = [
  // Weak passwords are rejected, with the feedback the meter shows.
  { password: "password", role: "user", email: PERSON, expected: { valid: false, score: 0, warningKey: "warnings.topTen", suggestionKeys: ["suggestions.anotherWord"], crackMagnitude: -4 } },
  { password: "password1234", role: "user", email: PERSON, expected: { valid: false, score: 1, warningKey: "warnings.similarToCommon", suggestionKeys: ["suggestions.anotherWord"], crackMagnitude: 0 } },
  { password: "qwertyuiop12", role: "user", email: PERSON, expected: { valid: false, score: 1, warningKey: "warnings.similarToCommon", suggestionKeys: ["suggestions.anotherWord"], crackMagnitude: 0 } },
  { password: "aaaaaaaaaaaa", role: "user", email: PERSON, expected: { valid: false, score: 0, warningKey: "warnings.simpleRepeat", suggestionKeys: ["suggestions.anotherWord", "suggestions.repeated"], crackMagnitude: -2 } },
  { password: "123456789012", role: "user", email: PERSON, expected: { valid: false, score: 1, warningKey: "warnings.common", suggestionKeys: ["suggestions.anotherWord"], crackMagnitude: 0 } },
  { password: "user@user.comuser@user.comuser@user.com", role: "user", email: "user@user.com", expected: { valid: false, score: 0, warningKey: "warnings.extendedRepeat", suggestionKeys: ["suggestions.anotherWord", "suggestions.repeated"], crackMagnitude: -3 } },
  // A near-miss: score 3 is not enough, so the threshold sits between 3 and 4.
  { password: "Summer2024!!xx", role: "user", email: PERSON, expected: { valid: false, score: 3, warningKey: null, suggestionKeys: [], crackMagnitude: 5 } },
  // Passwords derived from the account email are rejected.
  { password: "orchidquartz12", role: "user", email: "orchidquartz@example.com", expected: { valid: false, score: 1, warningKey: "warnings.userInputs", suggestionKeys: ["suggestions.anotherWord"], crackMagnitude: 0 } },
  // A repeated form of the account's own email or name must stay rejected: the library has to apply
  // the per-call user inputs inside its repeat matching too. zxcvbn-ts 4.2.0 scores these 4 (10^11
  // guesses) instead of 2 (10^6), so it would accept a password anyone who knows the email can guess.
  { password: "orchidquartz-orchidquartz-orchidquartz", role: "user", email: "orchidquartz@example.com", expected: { valid: false, score: 2, warningKey: "warnings.extendedRepeat", suggestionKeys: ["suggestions.anotherWord", "suggestions.repeated"], crackMagnitude: 2 } },
  { password: "jane.smith@example.comjane.smith@example.comjane.smith@example.com", role: "admin", email: "jane.smith@example.com", expected: { valid: false, score: 0, warningKey: "warnings.extendedRepeat", suggestionKeys: ["suggestions.anotherWord", "suggestions.repeated"], crackMagnitude: -3 } },
  { password: "jsmith@example.comjsmith@example.comjsmith@example.comjsmith@example.com", role: "admin", email: "jsmith@example.com", expected: { valid: false, score: 0, warningKey: "warnings.extendedRepeat", suggestionKeys: ["suggestions.anotherWord", "suggestions.repeated"], crackMagnitude: -3 } },
  // Strong passwords are accepted.
  { password: "Tr0ub4dor&3xyz", role: "user", email: PERSON, expected: { valid: true, score: 4, warningKey: null, suggestionKeys: [], crackMagnitude: 9 } },
  { password: "correct horse battery staple", role: "user", email: PERSON, expected: { valid: true, score: 4, warningKey: null, suggestionKeys: [], crackMagnitude: 16 } },
  { password: "orchid-quartz-river-lantern", role: "user", email: PERSON, expected: { valid: true, score: 4, warningKey: null, suggestionKeys: [], crackMagnitude: 16 } },
  { password: "xk7#Qm2$vR9pLw4!", role: "user", email: PERSON, expected: { valid: true, score: 4, warningKey: null, suggestionKeys: [], crackMagnitude: 12 } },
  // Admins: a 40-character minimum on top of the same score.
  { password: "a".repeat(40), role: "admin", email: "boss@example.com", expected: { valid: false, score: 0, warningKey: "warnings.simpleRepeat", suggestionKeys: ["suggestions.anotherWord", "suggestions.repeated"], crackMagnitude: -1 } },
  { password: "admin@admin.comadmin@admin.comadmin@admin.com", role: "admin", email: "admin@admin.com", expected: { valid: false, score: 0, warningKey: "warnings.extendedRepeat", suggestionKeys: ["suggestions.anotherWord", "suggestions.repeated"], crackMagnitude: -3 } },
  { password: "xk7#Qm2$vR9pLw4!xk7#Qm2$vR9pLw4!zz81&", role: "admin", email: "boss@example.com", expected: { valid: false, score: 2, warningKey: null, suggestionKeys: [], crackMagnitude: 18 } },
  { password: "orchid quartz lantern telescope meadow violin glacier", role: "admin", email: "boss@example.com", expected: { valid: true, score: 4, warningKey: null, suggestionKeys: [], crackMagnitude: 37 } },
  { password: "correct horse battery staple correct horse battery staple", role: "admin", email: "boss@example.com", expected: { valid: true, score: 4, warningKey: null, suggestionKeys: [], crackMagnitude: 41 } },
  { password: "admin!admin.comadmin@admin.comadmin#admin.com", role: "admin", email: "admin@admin.com", expected: { valid: true, score: 4, warningKey: null, suggestionKeys: [], crackMagnitude: 22 } },
];

describe("password strength decisions", () => {
  test("the required score is 4", () => {
    expect(REQUIRED_PASSWORD_SCORE).toBe(4);
  });

  describe.each(cases)("$role: $password", ({ password, role, email, expected }) => {
    const result = evaluatePasswordStrength(password, email, role);

    test("score, accept/reject and feedback", () => {
      expect({ valid: result.valid, score: result.score, warningKey: result.warningKey, suggestionKeys: result.suggestionKeys }).toEqual({
        valid: expected.valid,
        score: expected.score,
        warningKey: expected.warningKey,
        suggestionKeys: expected.suggestionKeys,
      });
    });

    test("crack-time estimate keeps its order of magnitude", () => {
      expect(Number.isFinite(result.crackTimeSeconds)).toBe(true);
      expect(Math.round(Math.log10(result.crackTimeSeconds))).toBe(expected.crackMagnitude);
    });
  });

  test("every feedback key it returns is a message the meter can show", () => {
    const messages = english.passwordStrength as unknown as Record<string, Record<string, string>>;
    const keys = cases.flatMap(({ password, role, email }) => {
      const result = evaluatePasswordStrength(password, email, role);
      return [...(result.warningKey ? [result.warningKey] : []), ...result.suggestionKeys];
    });
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const [group, name] = key.split(".");
      expect(messages[group]?.[name], `passwordStrength.${key} must be a message`).toEqual(expect.any(String));
    }
  });

  test("the length gate caps the score and rejects before the score is considered", () => {
    const short = evaluatePasswordStrength("xk7#Qm2$vR9", PERSON, "user");
    expect(short).toMatchObject({ valid: false, tooShort: true, minLength: 12 });
    expect(short.score).toBeLessThanOrEqual(2);
    const adminShort = evaluatePasswordStrength("correct horse battery staple", "boss@example.com", "admin");
    expect(adminShort).toMatchObject({ valid: false, tooShort: true, minLength: 40 });
    expect(adminShort.score).toBeLessThanOrEqual(2);
  });
});
