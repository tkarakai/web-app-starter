import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";

import { hasSessionCookie } from "@repo/edge-rate-limit";

function requestWithCookie(name: string): NextRequest {
  const req = new NextRequest("http://localhost:3001/en/dashboard");
  req.cookies.set(name, "token-123");
  return req;
}

describe("hasSessionCookie", () => {
  it("accepts the HTTP session cookie", () => {
    expect(hasSessionCookie(requestWithCookie("better-auth.session_token"))).toBe(true);
  });

  it("accepts the HTTPS (__Secure-) session cookie", () => {
    expect(hasSessionCookie(requestWithCookie("__Secure-better-auth.session_token"))).toBe(true);
  });

  it("rejects look-alike cookie names", () => {
    for (const name of [
      "evil-better-auth.session_token",
      "better-auth.session_token_x",
      "xbetter-auth.session_token",
      "__Host-better-auth.session_token",
      "session_token",
    ]) {
      expect(hasSessionCookie(requestWithCookie(name))).toBe(false);
    }
  });

  it("rejects a request without cookies", () => {
    expect(hasSessionCookie(new NextRequest("http://localhost:3001/en/dashboard"))).toBe(false);
  });
});
