import { describe, expect, it } from "bun:test";

import { formatTaskStatus } from "@/lib/formatters";

describe("formatTaskStatus", () => {
  it("capitalizes a simple status", () => {
    expect(formatTaskStatus("open")).toBe("Open");
  });

  it("handles whitespace and title casing", () => {
    expect(formatTaskStatus(" in progress ")).toBe("In Progress");
  });

  it("returns a friendly fallback", () => {
    expect(formatTaskStatus("  ")).toBe("Unspecified");
  });
});
