import { describe, expect, test } from "bun:test";
import { errorCode, safeCapabilityError } from "../src/errors";

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


describe("production error data", () => {
  test("structured codes survive a redacted message without leaking details", () => {
    const error = { message: "[Request ID: secret] Server Error", data: { code: "LAST_OWNER", message: "Private Org cookie=secret", trace: "private.ts" } };
    expect(errorCode(error)).toBe("LAST_OWNER");
    expect(safeCapabilityError(error)).toStartWith("LAST_OWNER: ");
    expect(safeCapabilityError(error)).not.toContain("secret");
    expect(safeCapabilityError(error)).not.toContain("Private");
    expect(safeCapabilityError({ ...error, data: { code: "UNRECOGNIZED_INTERNAL_FAILURE" } })).toStartWith("CAPABILITY_FAILED");
  });
  test("rate-limit kind has one canonical code", () => {
    expect(errorCode({ data: { kind: "RateLimited", retryAfter: 5000 } })).toBe("RATE_LIMITED");
    expect(safeCapabilityError({ data: { kind: "RateLimited" } })).toBe("RATE_LIMITED");
  });
  test("legacy fallback matches complete tokens, never substrings", () => {
    expect(errorCode(new Error("Uncaught Error: CTA_NAME_REQUIRED\n at handler"))).toBe("CTA_NAME_REQUIRED");
    expect(safeCapabilityError(new Error("CTA_NAME_REQUIRED"))).toStartWith("CTA_NAME_REQUIRED:");
    expect(safeCapabilityError(new Error("PREFIX_LAST_OWNER_SUFFIX"))).toStartWith("CAPABILITY_FAILED");
    expect(errorCode({ data: { code: "LAST_OWNER" }, message: "NOT_ADMIN" })).toBe("LAST_OWNER");
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode({ data: { code: 5 }, message: "Server Error" })).toBeUndefined();
  });
});
