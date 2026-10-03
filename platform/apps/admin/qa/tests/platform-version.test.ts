import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformVersion } from "@web-app-starter/design-system/build-utils";

describe("platform version build metadata", () => {
  it("reads the requested checkout version and follows upgrades", () => {
    const root = mkdtempSync(join(tmpdir(), "banner-version-"));
    try {
      mkdirSync(join(root, "platform"));
      const file = join(root, "platform/VERSION");
      writeFileSync(file, "3.1.0\n");
      expect(getPlatformVersion(root)).toBe("3.1.0");
      writeFileSync(file, "3.2.0-beta.1\n");
      expect(getPlatformVersion(root)).toBe("3.2.0-beta.1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
