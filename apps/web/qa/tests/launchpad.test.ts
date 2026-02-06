import { describe, expect, it } from "bun:test";

import { normalizeTitle, toPriorityLabel, toStatusCopy } from "../../src/lib/launchpad";

describe("normalizeTitle", () => {
  it("trims and normalizes whitespace", () => {
    expect(normalizeTitle("  Launch   item  ")).toBe("Launch item");
  });
});

describe("toPriorityLabel", () => {
  it("maps numeric priorities to labels", () => {
    expect(toPriorityLabel(4)).toBe("Must");
    expect(toPriorityLabel(3)).toBe("Should");
    expect(toPriorityLabel(2)).toBe("Could");
    expect(toPriorityLabel(1)).toBe("Nice");
  });
});

describe("toStatusCopy", () => {
  it("returns a human-friendly label", () => {
    expect(toStatusCopy("idea")).toBe("Idea pool");
  });
});
