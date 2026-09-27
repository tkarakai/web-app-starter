import { afterEach, describe, expect, test } from "vitest";

import { buildIntegrationStatus } from "./integrations";

const RESEND_ENV = ["RESEND_API_KEY", "EMAIL_FROM"] as const;
const saved = Object.fromEntries(RESEND_ENV.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of RESEND_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function resend() {
  return buildIntegrationStatus().email.find((p) => p.value === "resend");
}

describe("buildIntegrationStatus", () => {
  test("Resend is connected when every required variable is set", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "noreply@example.com";

    expect(resend()?.status).toBe("connected");
  });

  test("Resend is not connected when a variable is missing or blank", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "   ";

    expect(resend()?.status).toBe("not_connected");
    expect(resend()?.summary).toContain("EMAIL_FROM");
  });

  test("providers without an adapter never report connected", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/1";
    const status = buildIntegrationStatus();

    const others = [...status.email, ...status.sms, ...status.observability].filter(
      (p) => p.value !== "resend",
    );
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((p) => p.status === "not_implemented")).toBe(true);
    delete process.env.SENTRY_DSN;
  });
});
