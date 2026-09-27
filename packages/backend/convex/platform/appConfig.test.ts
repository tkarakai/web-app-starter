/**
 * The backend follows app.config.ts: a non-default cookie prefix reaches Better
 * Auth's cookie names and the /api/sessions token parsing, the product name
 * reaches the TOTP issuer, and the email brand reaches the email templates.
 * The config module is replaced for this file only (Vitest isolates each test
 * file), the same as editing app.config.ts.
 */
import { getCookies } from "better-auth/cookies";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@web-app-starter/app-config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@web-app-starter/app-config")>();
  return {
    ...original,
    appConfig: {
      ...original.appConfig,
      identity: { ...original.appConfig.identity, productName: "Acme Cloud" },
      runtime: { ...original.appConfig.runtime, authCookiePrefix: "acme" },
      brand: {
        ...original.appConfig.brand,
        email: {
          lang: "de",
          palette: { ...original.appConfig.brand.email.palette, accent: "#123456" },
          footerText: "Acme GmbH & Co. KG, Musterstraße 1",
        },
      },
    },
  };
});

const { createAuthOptions, getTotpIssuer } = await import("./auth");
const { getSessionToken } = await import("./sessions");
const { DEFAULT_EMAIL_TEMPLATE, DEFAULT_VERIFICATION_EMAIL_TEMPLATE } = await import("./emailTemplates");

type AuthCtx = Parameters<typeof createAuthOptions>[0];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("app.config.ts in the backend", () => {
  test("Better Auth names its cookies with the configured prefix", () => {
    const options = createAuthOptions({} as AuthCtx);
    expect(options.advanced.cookiePrefix).toBe("acme");
    const cookies = getCookies({ ...options, baseURL: "http://localhost" });
    expect(cookies.sessionToken.name).toBe("acme.session_token");
    expect(cookies.sessionData.name).toBe("acme.session_data");
    expect(getCookies({ ...options, baseURL: "https://app.example.com" }).sessionToken.name).toBe(
      "__Secure-acme.session_token",
    );
  });

  test("/api/sessions reads the prefixed session cookie and ignores other apps'", () => {
    const request = (cookie: string) =>
      new Request("http://127.0.0.1:3211/api/sessions", { headers: { cookie } });
    expect(getSessionToken(request("better-auth.session_token=theirs; acme.session_token=ours"))).toBe(
      "ours",
    );
    expect(getSessionToken(request("__Secure-acme.session_token=secure"))).toBe("secure");
    expect(getSessionToken(request("better-auth.session_token=theirs"))).toBeNull();
  });

  test("email templates use the configured palette, language and footer", () => {
    for (const template of [DEFAULT_EMAIL_TEMPLATE, DEFAULT_VERIFICATION_EMAIL_TEMPLATE]) {
      expect(template.html).toContain('<html lang="de">');
      expect(template.html).toContain("background-color: #123456");
      expect(template.html).toContain("Acme GmbH &amp; Co. KG, Musterstraße 1");
      expect(template.text.endsWith("\n\nAcme GmbH & Co. KG, Musterstraße 1")).toBe(true);
    }
  });

  test("the TOTP issuer is the product name", () => {
    vi.stubEnv("DEV_SEED_ENABLED", "false");
    vi.stubEnv("APP_ENVIRONMENT", "production");
    expect(getTotpIssuer("https://app.example.com")).toBe("Acme Cloud");
    vi.stubEnv("APP_ENVIRONMENT", "staging");
    expect(getTotpIssuer("https://staging.example.com")).toBe("Acme Cloud (STAGING)");
  });
});
