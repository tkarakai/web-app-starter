import { beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";

import { proxy } from "../../src/proxy";
import { _resetStore } from "@repo/edge-rate-limit";

// Each test gets a fresh rate limit store to avoid cross-test contamination.
beforeEach(() => {
  _resetStore();
});

let ipCounter = 0;

/** Create a request with a unique IP per call (avoids rate limit collisions). */
function createRequest(
  path: string,
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {},
): NextRequest {
  ipCounter += 1;
  const url = `http://localhost:3001${path}`;
  const req = new NextRequest(url, {
    headers: { "x-forwarded-for": headers["x-forwarded-for"] ?? `10.0.0.${ipCounter}`, ...headers },
  });
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe("proxy", () => {
  describe("protected routes (unauthenticated)", () => {
    it("redirects /en/dashboard to /en/sign-in when no session cookie", () => {
      const response = proxy(createRequest("/en/dashboard"));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/en/sign-in");
    });

    it("redirects /en/dashboard/settings to /en/sign-in when no session cookie", () => {
      const response = proxy(createRequest("/en/dashboard/settings"));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/en/sign-in");
    });
  });

  describe("protected routes (authenticated)", () => {
    it("allows /en/dashboard with dev session cookie", () => {
      const response = proxy(
        createRequest("/en/dashboard", { "better-auth.session_token": "token-123" })
      );

      expect(response.status).toBe(200);
    });

    it("allows /en/dashboard with production session cookie (__Secure- prefix)", () => {
      const response = proxy(
        createRequest("/en/dashboard", {
          "__Secure-better-auth.session_token": "token-123",
        })
      );

      expect(response.status).toBe(200);
    });
  });

  describe("auth routes (unauthenticated)", () => {
    it("allows /en/sign-in when no session cookie", () => {
      const response = proxy(createRequest("/en/sign-in"));

      expect(response.status).toBe(200);
    });

    it("allows /en/sign-up when no session cookie", () => {
      const response = proxy(createRequest("/en/sign-up"));

      expect(response.status).toBe(200);
    });
  });

  describe("auth routes (authenticated)", () => {
    it("redirects /en/sign-in to /en/dashboard when session cookie exists", () => {
      const response = proxy(
        createRequest("/en/sign-in", { "better-auth.session_token": "token-123" })
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/en/dashboard");
    });

    it("redirects /en/sign-up to /en/dashboard when session cookie exists", () => {
      const response = proxy(
        createRequest("/en/sign-up", { "better-auth.session_token": "token-123" })
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/en/dashboard");
    });
  });

  describe("rate limiting", () => {
    it("includes rate limit headers on successful responses", () => {
      const response = proxy(createRequest("/"));

      expect(response.headers.get("X-RateLimit-Limit")).toBe("200");
      expect(response.headers.get("X-RateLimit-Remaining")).toBeDefined();
      expect(response.headers.get("X-RateLimit-Reset")).toBeDefined();
    });

    it("returns 429 when rate limit is exceeded", () => {
      const ip = "rate-limit-test-ip";

      // Send 200 requests (the default limit)
      for (let i = 0; i < 200; i++) {
        proxy(createRequest("/", {}, { "x-forwarded-for": ip }));
      }

      // 201st request should be blocked
      const response = proxy(createRequest("/", {}, { "x-forwarded-for": ip }));

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBeDefined();
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    });
  });
});
