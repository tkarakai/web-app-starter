import { describe, expect, it } from "bun:test";

import { normalizeText, toStatusLabel } from "../../src/lib/projects";

describe("normalizeText", () => {
  it("trims and normalizes whitespace", () => {
    expect(normalizeText("  My  project  ")).toBe("My project");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeText("   ")).toBe("");
  });
});

describe("toStatusLabel", () => {
  it("maps status to display label", () => {
    expect(toStatusLabel("todo")).toBe("To do");
    expect(toStatusLabel("in_progress")).toBe("In progress");
    expect(toStatusLabel("done")).toBe("Done");
  });
});
