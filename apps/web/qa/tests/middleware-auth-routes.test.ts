import { beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { appConfig, localAppOrigin } from "@web-app-starter/app-config";
import { sessionCookieNames } from "@web-app-starter/auth/cookies";
import { _resetStore } from "@web-app-starter/edge-rate-limit";

import { proxy } from "../../src/proxy";

const [SESSION, SECURE_SESSION] = sessionCookieNames();
const authPages = ["forgot-password", "reset-password", "verify-email"] as const;

beforeEach(() => {
  _resetStore();
});

let ipCounter = 0;

/** Create a request with a unique IP per call (avoids rate limit collisions). */
function createRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  ipCounter += 1;
  const request = new NextRequest(`${localAppOrigin("web")}${path}`, {
    headers: { "x-forwarded-for": `10.0.0.${ipCounter}` },
  });
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

describe("proxy — new auth guest routes", () => {
  for (const locale of appConfig.i18n.locales) {
    describe(locale, () => {
      for (const route of authPages) {
        const path = `/${locale}/${route}`;

        it(`allows ${path} when unauthenticated`, () => {
          expect(proxy(createRequest(path)).status).toBe(200);
        });

        it(`sets CSP and rate limit headers on ${path}`, () => {
          const response = proxy(createRequest(path));
          const csp = response.headers.get("Content-Security-Policy");
          expect(csp).toContain("script-src");
          expect(csp).toContain("frame-ancestors 'none'");
          expect(response.headers.get("X-RateLimit-Limit")).toBe("200");
          expect(response.headers.get("X-RateLimit-Remaining")).not.toBeNull();
        });

        for (const cookie of [SESSION, SECURE_SESSION]) {
          it(`${path} handles authenticated requests with ${cookie}`, () => {
            const response = proxy(createRequest(path, { [cookie]: "token-123" }));
            if (route === "verify-email") {
              expect(response.status).toBe(200);
            } else {
              expect(response.status).toBe(307);
              expect(new URL(response.headers.get("location")!).pathname).toBe(`/${locale}/dashboard`);
            }
          });
        }

        it(`allows ${path} with session_cleared even when authenticated`, () => {
          const response = proxy(createRequest(`${path}?session_cleared=1`, { [SESSION]: "token-123" }));
          expect(response.status).toBe(200);
        });
      }

      it("allows reset-password with a token when unauthenticated", () => {
        expect(proxy(createRequest(`/${locale}/reset-password?token=abc123`)).status).toBe(200);
      });
    });
  }

  describe("configured default locale", () => {
    for (const route of authPages) {
      it(`prefixes /${route} with the configured default`, () => {
        const response = proxy(createRequest(`/${route}`));
        expect(response.status).toBe(307);
        expect(new URL(response.headers.get("location")!).pathname).toBe(`/${appConfig.i18n.defaultLocale}/${route}`);
      });
    }

    it("uses the configured default for an authenticated unprefixed guest route", () => {
      const response = proxy(createRequest("/forgot-password", { [SESSION]: "token-123" }));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe(`/${appConfig.i18n.defaultLocale}/dashboard`);
    });
  });
});
