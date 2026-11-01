import { describe, expect, test } from "bun:test";
import { safeCapabilityError } from "../src/errors";

describe("agent-facing errors", () => {
  test("organization refusals keep their code and a fixed recovery step, never the backend message", () => {
    const cases: [string, string][] = [
      ["Uncaught Error: OWNER_SUCCESSOR_REQUIRED: make another member an owner of Acme Secret Corp before banning this user\n    at handler (convex/platform/agentUsers.ts:70)", "OWNER_SUCCESSOR_REQUIRED"],
      ["ORGANIZATION_OWNER_REQUIRED", "ORGANIZATION_OWNER_REQUIRED"],
      ["LAST_OWNER", "LAST_OWNER"],
      ["MEMBER_BANNED", "MEMBER_BANNED"],
      ["MEMBER_IS_ADMINISTRATOR", "MEMBER_IS_ADMINISTRATOR"],
      ["ORGANIZATION_NOT_FOUND", "ORGANIZATION_NOT_FOUND"],
      ["INVITATION_NOT_PENDING", "INVITATION_NOT_PENDING"],
      ["INVITATION_NOT_FOUND", "INVITATION_NOT_FOUND"],
      ["INVALID_SUCCESSOR", "INVALID_SUCCESSOR"],
    ];
    for (const [message, code] of cases) {
      const result = safeCapabilityError(new Error(message));
      expect(result.startsWith(`${code}: `)).toBe(true);
      expect(result).not.toContain("Acme");
      expect(result).not.toContain("agentUsers.ts");
    }
    expect(safeCapabilityError(new Error("OWNER_SUCCESSOR_REQUIRED: x"))).toContain("organizations_forUser");
  });

  test("unknown failures stay generic", () => {
    expect(safeCapabilityError(new Error("sensitive credential trace"))).toStartWith("CAPABILITY_FAILED");
    expect(safeCapabilityError("not an error")).toStartWith("CAPABILITY_FAILED");
  });
});
