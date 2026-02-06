import { describe, expect, it } from "bun:test";

import { formatBytes, formatDateTime } from "../../src/lib/format";

describe("formatBytes", () => {
  it("formats bytes into human readable output", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("handles invalid values", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("formatDateTime", () => {
  it("formats a numeric timestamp", () => {
    const output = formatDateTime(1700000000000);
    expect(output.length).toBeGreaterThan(0);
  });
});
