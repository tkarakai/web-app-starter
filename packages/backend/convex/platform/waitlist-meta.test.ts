import { describe, expect, test } from "vitest";

import { validateMeta } from "./waitlist";

const base = { superpowers: ["coffee-to-code"], excitement: ["cautiously-optimistic"] };
const meta = (extra: Record<string, unknown> = {}) => JSON.stringify({ ...base, ...extra });

describe("validateMeta profile fields", () => {
  test("accepts meta without the optional fields (older clients)", () => {
    expect(() => validateMeta(meta())).not.toThrow();
  });

  test("accepts well-formed role, company and use case", () => {
    expect(() =>
      validateMeta(meta({ role: "founder", company: "Acme", useCase: "Internal tools" })),
    ).not.toThrow();
  });

  test("rejects an unknown role", () => {
    expect(() => validateMeta(meta({ role: "ceo" }))).toThrow("INVALID_META: invalid role value");
  });

  test("rejects a non-string or overlong company", () => {
    expect(() => validateMeta(meta({ company: 42 }))).toThrow("INVALID_META: company");
    expect(() => validateMeta(meta({ company: "x".repeat(121) }))).toThrow("INVALID_META: company");
  });

  test("rejects an overlong use case", () => {
    expect(() => validateMeta(meta({ useCase: "x".repeat(501) }))).toThrow("INVALID_META: useCase");
  });
});
