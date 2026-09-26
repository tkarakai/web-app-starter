// @vitest-environment node
/**
 * A non-default `runtime.authCookiePrefix` reaches the admin app's proxy and
 * clear-session route. The config module is replaced for this file only
 * (Vitest isolates each test file), the same as editing app.config.ts.
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/app-config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@repo/app-config")>();
  return {
    ...original,
    appConfig: {
      ...original.appConfig,
      runtime: { ...original.appConfig.runtime, authCookiePrefix: "acme-admin" },
    },
  };
});

const cookieJar = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => cookieJar.names.map((name) => ({ name, value: "x" })) }),
}));

const { proxy } = await import("../../src/proxy");
const { GET: clearSession } = await import("../../src/app/api/auth/clear-session/route");

let ip = 0;
function request(path: string, cookies: Record<string, string>): NextRequest {
  ip += 1;
  const req = new NextRequest(`http://localhost${path}`, {
    headers: { "x-forwarded-for": `10.8.0.${ip}` },
  });
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

describe("admin cookie prefix from app.config.ts", () => {
  it("proxy: the app's own session opens the dashboard", () => {
    const response = proxy(request("/dashboard", { "acme-admin.session_token": "t" }));
    expect(response.headers.get("location")).toBeNull();
  });

  it("proxy: a default-prefixed session from another app does not count", () => {
    const response = proxy(request("/dashboard", { "better-auth.session_token": "t" }));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/sign-in");
  });

  it("clear-session deletes only this app's session cookies", async () => {
    cookieJar.names = ["acme-admin.session_token", "acme-admin.dont_remember", "better-auth.session_token"];
    const response = await clearSession();
    const deleted = response.cookies.getAll().map((cookie) => cookie.name).sort();
    expect(deleted).toEqual(["acme-admin.dont_remember", "acme-admin.session_token"]);
  });
});
