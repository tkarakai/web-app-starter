import { describe, expect, it } from "bun:test";

import { formatWelcomeMessage } from "@/lib/sample";

describe("formatWelcomeMessage", () => {
  it("includes the provided name", () => {
    expect(formatWelcomeMessage("Convex")).toBe("Welcome, Convex!");
  });
});
