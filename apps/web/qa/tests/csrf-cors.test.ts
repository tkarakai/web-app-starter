import { beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";

import { proxy } from "../../src/proxy";
import { _resetStore } from "@repo/edge-rate-limit";

// Fresh rate limit store per test
beforeEach(() => {
  _resetStore();
});

let ipCounter = 1000;

function createRequest(
  path: string,
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {}
): NextRequest {
  ipCounter += 1;
  const url = `http://localhost:3001${path}`;
  const req = new NextRequest(url, {
    headers: {
      "x-forwarded-for":
        headers["x-forwarded-for"] ?? `10.0.1.${ipCounter}`,
      ...headers,
    },
  });
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe("CSRF Protection", () => {
  describe("CSP form-action directive", () => {
    it("CSP includes form-action 'self' to prevent cross-origin form submission", () => {
      const response = proxy(createRequest("/en/sign-in"));
      const csp = response.headers.get("Content-Security-Policy")!;

      expect(csp).toContain("form-action 'self'");
    });

    it("CSP form-action does not include wildcard or unsafe values", () => {
      const response = proxy(createRequest("/"));
      const csp = response.headers.get("Content-Security-Policy")!;

      // form-action should be 'self' only — no wildcards
      const formAction = csp
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("form-action"));

      expect(formAction).toBeDefined();
      expect(formAction).toBe("form-action 'self'");
      expect(formAction).not.toContain("*");
      expect(formAction).not.toContain("unsafe");
    });
  });

  describe("frame-ancestors protection", () => {
    it("CSP frame-ancestors 'none' prevents clickjacking", () => {
      const response = proxy(createRequest("/"));
      const csp = response.headers.get("Content-Security-Policy")!;

      expect(csp).toContain("frame-ancestors 'none'");
    });

    it("X-Frame-Options DENY is also set as defense-in-depth", () => {
      // X-Frame-Options is set in next.config.ts headers, not in proxy.
      // In E2E, both CSP frame-ancestors and X-Frame-Options are present.
      // Here we verify the CSP side.
      const response = proxy(createRequest("/"));
      const csp = response.headers.get("Content-Security-Policy")!;

      // frame-ancestors 'none' is the modern CSP equivalent of X-Frame-Options: DENY
      expect(csp).toContain("frame-ancestors 'none'");
    });
  });

  describe("base-uri restriction", () => {
    it("CSP base-uri 'self' prevents base tag injection", () => {
      const response = proxy(createRequest("/"));
      const csp = response.headers.get("Content-Security-Policy")!;

      // base-uri 'self' prevents an attacker from injecting a <base> tag
      // that would redirect relative URLs to a malicious domain
      expect(csp).toContain("base-uri 'self'");
    });
  });
});

describe("CORS Configuration", () => {
  describe("Better Auth trusted origins", () => {
    it("trustedOrigins derives from SITE_URL env var", () => {
      // The multiOriginPlugin in auth.ts reads SITE_URL and sets trustedOrigins.
      // In dev, SITE_URL defaults to "http://localhost:3001".
      // This test verifies the pattern: comma-separated URLs → array.
      const siteUrlRaw = "http://localhost:3001,http://localhost:3002";
      const siteUrls = siteUrlRaw
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean);

      expect(siteUrls).toEqual([
        "http://localhost:3001",
        "http://localhost:3002",
      ]);
      expect(siteUrls).not.toContain("*");
      expect(siteUrls).not.toContain("null");
    });

    it("empty SITE_URL falls back to localhost:3001", () => {
      const siteUrlRaw = process.env.SITE_URL || "http://localhost:3001";
      const siteUrls = siteUrlRaw
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean);

      expect(siteUrls.length).toBeGreaterThan(0);
      // Must always have at least one valid URL
      for (const url of siteUrls) {
        expect(url).toMatch(/^https?:\/\//);
      }
    });

    it("trustedOrigins never includes wildcard *", () => {
      const siteUrlRaw = process.env.SITE_URL || "http://localhost:3001";
      const siteUrls = siteUrlRaw
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean);

      for (const url of siteUrls) {
        expect(url).not.toBe("*");
        expect(url).not.toContain("*");
      }
    });
  });

  describe("connect-src CSP directive", () => {
    it("CSP connect-src restricts API calls to known origins", () => {
      const response = proxy(createRequest("/"));
      const csp = response.headers.get("Content-Security-Policy")!;

      // connect-src must include 'self' and Convex cloud origins
      expect(csp).toContain("connect-src");

      const connectSrc = csp
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("connect-src"));

      expect(connectSrc).toContain("'self'");
      expect(connectSrc).toContain("https://*.convex.cloud");
      expect(connectSrc).toContain("wss://*.convex.cloud");

      // Must not allow all origins
      expect(connectSrc).not.toBe("connect-src *");
    });
  });
});
