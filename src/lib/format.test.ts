import { describe, expect, it } from "bun:test";

import { formatMessageLabel } from "./format";

describe("formatMessageLabel", () => {
  it("trims values and joins with a colon", () => {
    expect(formatMessageLabel(" Ada ", " Hello ")).toBe("Ada: Hello");
  });
});
