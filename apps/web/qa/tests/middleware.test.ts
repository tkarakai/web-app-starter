import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";

import { middleware } from "../../src/middleware";

function createRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  const url = `http://localhost:3001${path}`;
  const req = new NextRequest(url);
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe("middleware", () => {
  describe("protected routes (unauthenticated)", () => {
    it("redirects /dashboard to /sign-in when no session cookie", () => {
      const response = middleware(createRequest("/dashboard"));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/sign-in");
    });

    it("redirects /dashboard/settings to /sign-in when no session cookie", () => {
      const response = middleware(createRequest("/dashboard/settings"));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/sign-in");
    });
  });

  describe("protected routes (authenticated)", () => {
    it("allows /dashboard with dev session cookie", () => {
      const response = middleware(
        createRequest("/dashboard", { "better-auth.session_token": "token-123" })
      );

      expect(response.status).toBe(200);
    });

    it("allows /dashboard with production session cookie (__Secure- prefix)", () => {
      const response = middleware(
        createRequest("/dashboard", {
          "__Secure-better-auth.session_token": "token-123",
        })
      );

      expect(response.status).toBe(200);
    });
  });

  describe("auth routes (unauthenticated)", () => {
    it("allows /sign-in when no session cookie", () => {
      const response = middleware(createRequest("/sign-in"));

      expect(response.status).toBe(200);
    });

    it("allows /sign-up when no session cookie", () => {
      const response = middleware(createRequest("/sign-up"));

      expect(response.status).toBe(200);
    });
  });

  describe("auth routes (authenticated)", () => {
    it("redirects /sign-in to /dashboard when session cookie exists", () => {
      const response = middleware(
        createRequest("/sign-in", { "better-auth.session_token": "token-123" })
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard");
    });

    it("redirects /sign-up to /dashboard when session cookie exists", () => {
      const response = middleware(
        createRequest("/sign-up", { "better-auth.session_token": "token-123" })
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard");
    });
  });
});
