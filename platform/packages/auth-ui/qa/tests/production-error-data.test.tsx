import { expect, test } from "vitest";
import { billingErrorKey } from "../../src/lib/billing";
import { extractErrorInfo } from "@web-app-starter/auth/error-handler";

test("billing maps production refusal data, without matching substrings", () => {
  expect(billingErrorKey({ message: "Server Error", data: { code: "BILLING_ORGANIZATION_IN_USE" } })).toBe("inUse");
  expect(billingErrorKey({ message: "Server Error", data: { code: "PAYMENT_METHOD_REQUIRED" } })).toBe("paymentMethodRequired");
  expect(billingErrorKey(new Error("PREFIX_PAYMENT_METHOD_REQUIRED_SUFFIX"))).toBe("generic");
});
test("global handler uses structured codes for translated toasts without returning backend details", () => {
  expect(extractErrorInfo({ message: "Server Error", data: { code: "NO_ORGANIZATION", message: "Private Org" } })).toEqual({ code: "NO_ORGANIZATION", message: "NO_ORGANIZATION" });
});

test("rate limits are parsed across Error prototypes with their retry interval", () => {
  expect(extractErrorInfo({ data: { kind: "RateLimited", retryAfter: 1200 } })).toMatchObject({ code: "RATE_LIMITED", params: { seconds: 2 } });
});

test("legacy envelopes handle long blank messages without ambiguous regex matching", () => {
  expect(extractErrorInfo(new Error(`[CONVEX M(example:run)] ${" ".repeat(100_000)}\n`))).toBeNull();
  expect(extractErrorInfo(new Error("[CONVEX M(example:run)] \n  readable refusal\n  Called by client"))).toEqual({
    code: "readable refusal", message: "readable refusal",
  });
  expect(extractErrorInfo(new Error("[CONVEX M(example:run] readable refusal"))).toBeNull();
});
