import { expect, test } from "vitest";
import { organizationErrorMessage } from "../../src/components/organizations/organization-errors";

test("production refusal data gives the same support message without exposing its detail", () => {
  const result = organizationErrorMessage({ message: "[Request ID: private] Server Error", data: { code: "OWNER_SUCCESSOR_REQUIRED", message: "Private Org" } });
  expect(result).toContain("Make another member an owner");
  expect(result).not.toContain("Private Org");
});
test("unknown structured and legacy codes always produce the generic support message", () => {
  for (const error of [{ data: { code: "UNKNOWN_ERROR" } }, new Error("UNKNOWN_ERROR"), null]) {
    expect(organizationErrorMessage(error)).toBe("Action failed. Please try again.");
  }
});
