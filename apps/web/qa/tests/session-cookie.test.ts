import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";

import {
  AUTH_COOKIE_PREFIX,
  isSessionCookie,
  sessionCookieNames,
  sessionTokenFromCookieHeader,
} from "@web-app-starter/auth/cookies";
import { appConfig } from "@web-app-starter/app-config";
import { hasSessionCookie } from "@web-app-starter/edge-rate-limit";

const [SESSION, SECURE_SESSION] = sessionCookieNames();

function requestWithCookie(name: string): NextRequest {
  const req = new NextRequest("http://localhost/en/dashboard");
  req.cookies.set(name, "token-123");
  return req;
}

describe("session cookie names", () => {
  it("follow the cookie prefix in app.config.ts", () => {
    expect(AUTH_COOKIE_PREFIX).toBe(appConfig.runtime.authCookiePrefix);
    expect(SESSION).toBe(`${appConfig.runtime.authCookiePrefix}.session_token`);
    expect(SECURE_SESSION).toBe(`__Secure-${appConfig.runtime.authCookiePrefix}.session_token`);
  });

  it("are built for any prefix", () => {
    expect(sessionCookieNames("acme")).toEqual(["acme.session_token", "__Secure-acme.session_token"]);
  });
});

describe("hasSessionCookie", () => {
  it("accepts the HTTP session cookie", () => {
    expect(hasSessionCookie(requestWithCookie(SESSION), sessionCookieNames())).toBe(true);
  });

  it("accepts the HTTPS (__Secure-) session cookie", () => {
    expect(hasSessionCookie(requestWithCookie(SECURE_SESSION), sessionCookieNames())).toBe(true);
  });

  it("rejects look-alike cookie names", () => {
    for (const name of [
      `evil-${SESSION}`,
      `${SESSION}_x`,
      `x${SESSION}`,
      `__Host-${SESSION}`,
      "session_token",
    ]) {
      expect(hasSessionCookie(requestWithCookie(name), sessionCookieNames())).toBe(false);
    }
  });

  it("rejects a request without cookies", () => {
    expect(hasSessionCookie(new NextRequest("http://localhost/en/dashboard"), sessionCookieNames())).toBe(false);
  });

  it("with a non-default prefix, ignores another app's Better Auth session on the same host", () => {
    const names = sessionCookieNames("acme");
    expect(hasSessionCookie(requestWithCookie("acme.session_token"), names)).toBe(true);
    expect(hasSessionCookie(requestWithCookie("__Secure-acme.session_token"), names)).toBe(true);
    expect(hasSessionCookie(requestWithCookie("better-auth.session_token"), names)).toBe(false);
    expect(hasSessionCookie(requestWithCookie("evil-acme.session_token"), names)).toBe(false);
  });
});

describe("isSessionCookie (what clear-session deletes)", () => {
  it("matches every session cookie of the prefix, over HTTP and HTTPS, with chunks", () => {
    for (const name of [
      "acme.session_token",
      "__Secure-acme.session_token",
      "acme.session_data",
      "acme.session_data.0",
      "__Secure-acme.session_data.12",
      "acme.account_data",
      "acme.dont_remember",
      "acme.convex_jwt",
      "acme.convex_jwt.1",
    ]) {
      expect(isSessionCookie(name, "acme")).toBe(true);
    }
  });

  it("never matches another app's cookies or look-alikes", () => {
    for (const name of [
      "better-auth.session_token",
      "evil-acme.session_token",
      "acme.session_token_x",
      "acme.session_data.x",
      "acme.session_data.",
      "__Host-acme.session_token",
      "acme.theme",
      "acme",
    ]) {
      expect(isSessionCookie(name, "acme")).toBe(false);
    }
  });
});

describe("sessionTokenFromCookieHeader", () => {
  it("returns the token of the exact session cookie, not a look-alike before it", () => {
    expect(sessionTokenFromCookieHeader("evil-acme.session_token=forged; acme.session_token=real", "acme")).toBe("real");
    expect(sessionTokenFromCookieHeader("__Secure-acme.session_token=secure", "acme")).toBe("secure");
  });

  it("ignores another app's Better Auth session", () => {
    expect(sessionTokenFromCookieHeader("better-auth.session_token=theirs", "acme")).toBeNull();
    expect(sessionTokenFromCookieHeader(null, "acme")).toBeNull();
  });
});
