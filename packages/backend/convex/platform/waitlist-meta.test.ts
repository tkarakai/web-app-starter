import { describe, expect, test } from "vitest";
import { validateMeta } from "./waitlist";

const sample = { superpowers: ["coffee-to-code"], excitement: ["cautiously-optimistic"], role: "founder", company: "Acme", useCase: "Internal tools" };
const limit = 16_384;

describe("app-owned waitlist metadata", () => {
  test.each([
    "{}",
    JSON.stringify(sample),
    JSON.stringify({ teamSize: 7, newsletter: true, details: { tools: ["a", null, 42] } }),
    JSON.stringify({ superpowers: null, excitement: "custom", role: "ceo", company: 42 }),
  ])("accepts an object without prescribing questions: %s", (meta) => {
    expect(() => validateMeta(meta)).not.toThrow();
  });

  test.each(["", "{", "null", "[]", "42", "true", '"text"'])("rejects malformed JSON and nonobjects: %s", (meta) => {
    expect(() => validateMeta(meta)).toThrow("INVALID_META");
  });

  test("enforces an inclusive UTF-8 byte cap before parsing", () => {
    const atLimit = JSON.stringify({ x: "x".repeat(limit - 8) });
    expect(new globalThis.TextEncoder().encode(atLimit)).toHaveLength(limit);
    expect(() => validateMeta(atLimit)).not.toThrow();
    expect(() => validateMeta(atLimit + " ")).toThrow("INVALID_META");
    const unicodeAtLimit = JSON.stringify({ x: "é".repeat((limit - 8) / 2) });
    expect(() => validateMeta(unicodeAtLimit)).not.toThrow();
    expect(() => validateMeta(unicodeAtLimit + " ")).toThrow("INVALID_META");
    expect(() => validateMeta(" ".repeat(limit + 1))).toThrow("INVALID_META");
  });

  test.each(["__proto__", "constructor", "prototype"])('rejects dangerous key "%s" at any depth', (key) => {
    // Include valid sample fields so a sample-only validator cannot mask this check.
    for (const meta of [`{${JSON.stringify(sample).slice(1, -1)},"${key}":{}}`, `{"answers":[{"nested":{"${key}":true}}]}`]) {
      expect(() => validateMeta(meta)).toThrow("INVALID_META");
    }
  });

  test("checks decoded keys and permits dangerous-looking string values", () => {
    expect(() => validateMeta('{"\\u005f_proto__":{}}')).toThrow("INVALID_META");
    expect(() => validateMeta('{"answer":"__proto__ constructor prototype"}')).not.toThrow();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  test("handles deeply nested and wide objects within the byte cap without recursion", () => {
    expect(() => validateMeta('{"x":' + "[".repeat(7000) + "0" + "]".repeat(7000) + "}")).not.toThrow();
    expect(() => validateMeta(JSON.stringify({ answers: Array(3000).fill(0) }))).not.toThrow();
  });
});
