// @vitest-environment node
/**
 * A non-default `runtime.authCookiePrefix` reaches every web consumer: the
 * proxy's session check, clear-session and session token parsing. The config
 * module is replaced for this file only (Vitest isolates each test file), the
 * same as editing app.config.ts, and the real modules are loaded on top of it.
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/app-config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@repo/app-config")>();
  return {
    ...original,
    appConfig: {
      ...original.appConfig,
      runtime: { ...original.appConfig.runtime, authCookiePrefix: "acme" },
    },
  };
});

// Locale routing is not under test, and next-intl's ESM build does not load in
// Vitest's Node environment. Auth redirects run before it in the proxy.
vi.mock("next-intl/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return { default: () => () => NextResponse.next() };
});

const { proxy } = await import("../../src/proxy");
const { GET: clearSession } = await import("../../src/app/api/auth/clear-session/route");
const { AUTH_COOKIE_PREFIX, sessionTokenFromCookieHeader } = await import("@repo/auth/cookies");

const cookieJar = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => cookieJar.names.map((name) => ({ name, value: "x" })) }),
}));

let ip = 0;
function request(path: string, cookies: Record<string, string>): NextRequest {
  ip += 1;
  const req = new NextRequest(`http://localhost${path}`, {
    headers: { "x-forwarded-for": `10.9.0.${ip}` },
  });
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

function redirectPath(response: Response): string | null {
  const location = response.headers.get("location");
  return location ? new URL(location, "http://localhost").pathname : null;
}

describe("cookie prefix from app.config.ts", () => {
  it("is the configured one", () => {
    expect(AUTH_COOKIE_PREFIX).toBe("acme");
  });

  it("proxy: the app's own session opens protected routes", () => {
    const response = proxy(request("/en/dashboard", { "acme.session_token": "t" }));
    expect(redirectPath(response)).not.toBe("/en/sign-in");
    const secure = proxy(request("/en/dashboard", { "__Secure-acme.session_token": "t" }));
    expect(redirectPath(secure)).not.toBe("/en/sign-in");
  });

  it("proxy: another app's default-prefixed session does not count", () => {
    const response = proxy(request("/en/dashboard", { "better-auth.session_token": "t" }));
    expect(response.status).toBe(307);
    expect(redirectPath(response)).toBe("/en/sign-in");
  });

  it("clear-session deletes only this app's session cookies", async () => {
    cookieJar.names = [
      "acme.session_token",
      "__Secure-acme.session_token",
      "acme.session_data.0",
      "acme.convex_jwt",
      "better-auth.session_token",
      "acme.theme",
      "NEXT_LOCALE",
    ];
    const response = await clearSession();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/sign-in?session_cleared=1");
    const deleted = response.cookies.getAll().map((cookie) => cookie.name).sort();
    expect(deleted).toEqual([
      "__Secure-acme.session_token",
      "acme.convex_jwt",
      "acme.session_data.0",
      "acme.session_token",
    ]);
  });

  it("session token parsing reads the prefixed cookie only", () => {
    expect(sessionTokenFromCookieHeader("better-auth.session_token=a; acme.session_token=b")).toBe("b");
    expect(sessionTokenFromCookieHeader("better-auth.session_token=a")).toBeNull();
  });
});
