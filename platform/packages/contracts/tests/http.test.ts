// HTTP contracts: black-box checks of the platform behaviour each reference app serves, run
// against the app's own route handlers, proxy and config (so an app that replaces or reverts
// one fails here, not in production). Convex endpoint authorization is the other half:
// packages/backend/convex/platform/endpoint-authorization.test.ts.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_DIRS } from "@web-app-starter/app-config";
import { AUTH_COOKIE_PREFIX } from "@web-app-starter/auth/cookies";
import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

// The cookies the next request carries, for route handlers that read next/headers.
const jar = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => jar.names.map((name) => ({ name, value: "x" })) }),
}));

type AppContract = {
  app: "web" | "admin";
  protectedPath: string;
  signInPath: string;
  requiredEnv: readonly string[];
};

// The apps that serve Better Auth sessions. An adopted app that removed admin drops it here.
const APPS: readonly AppContract[] = [
  { app: "web", protectedPath: "/en/dashboard", signInPath: "/en/sign-in", requiredEnv: ["CONVEX_URL", "CONVEX_SITE_URL"] },
  { app: "admin", protectedPath: "/dashboard", signInPath: "/sign-in", requiredEnv: ["CONVEX_URL", "CONVEX_SITE_URL"] },
];

const OWN = `${AUTH_COOKIE_PREFIX}.session_token`;
// Another Better Auth app on the same host (localhost in development), a look-alike prefix, and
// an unrelated cookie: none of them is this app's session.
const FOREIGN = [`other-app.session_token`, `evil-${AUTH_COOKIE_PREFIX}.session_token`, `x${OWN}`, "theme"];
const OWN_ALL = [OWN, `__Secure-${OWN}`, `${AUTH_COOKIE_PREFIX}.session_data`, `${AUTH_COOKIE_PREFIX}.session_data.0`,
  `${AUTH_COOKIE_PREFIX}.convex_jwt`];

async function load<T>(file: string): Promise<T> {
  return (await import(pathToFileURL(path.join(root, file)).href)) as T;
}

function deletedCookies(response: Response): string[] {
  return response.headers.getSetCookie()
    .filter((cookie) => /expires=Thu, 01 Jan 1970|max-age=0/i.test(cookie))
    .map((cookie) => cookie.slice(0, cookie.indexOf("=")))
    .sort();
}

function request(url: string, cookies: readonly string[] = []): NextRequest {
  return new NextRequest(new URL(url, "http://localhost"), {
    headers: cookies.length > 0 ? { cookie: cookies.map((name) => `${name}=x`).join("; ") } : {},
  });
}

beforeEach(() => {
  jar.names = [];
});

describe.each(APPS)("$app", ({ app, protectedPath, signInPath, requiredEnv }) => {
  const dir = APP_DIRS[app];

  describe("session and cookie isolation", () => {
    test("clear-session deletes exactly this app's session cookies and redirects to sign-in", async () => {
      const { GET } = await load<{ GET: () => Promise<Response> }>(`${dir}/src/app/api/auth/clear-session/route.ts`);
      jar.names = [...OWN_ALL, ...FOREIGN];
      const response = await GET();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("/sign-in?session_cleared=1");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(deletedCookies(response)).toEqual([...OWN_ALL].sort());
    });

    test("a protected page redirects to sign-in unless this app's own session cookie is present", async () => {
      const { proxy } = await load<{ proxy: (req: NextRequest) => NextResponse }>(`${dir}/src/proxy.ts`);
      const anonymous = proxy(request(protectedPath, FOREIGN));
      expect(anonymous.status).toBe(307);
      expect(new URL(anonymous.headers.get("location") ?? "").pathname).toBe(signInPath);

      const signedIn = proxy(request(protectedPath, [OWN]));
      expect(new URL(signedIn.headers.get("location") ?? "http://localhost/").pathname).not.toBe(signInPath);
    });
  });

  describe("security headers", () => {
    test("pages get a nonce-based CSP that forbids framing and plugins", async () => {
      const { proxy } = await load<{ proxy: (req: NextRequest) => NextResponse }>(`${dir}/src/proxy.ts`);
      const csp = proxy(request(signInPath)).headers.get("content-security-policy") ?? "";
      expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    });

    test("next.config sends the standard security headers on every route", async () => {
      const config = (await load<{ default: { headers?: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> } }>(
        `${dir}/next.config.ts`)).default;
      const rules = (await config.headers?.()) ?? [];
      const all = rules.find((rule) => rule.source === "/(.*)" || rule.source === "/:path*");
      const headers = Object.fromEntries((all?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]));
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["strict-transport-security"]).toMatch(/max-age=\d{7,}/);
    });
  });

  describe("environment", () => {
    test("required runtime variables are declared where a promoted build reads them", () => {
      const example = readFileSync(path.join(root, dir, ".env.example"), "utf8");
      const turbo = readFileSync(path.join(root, "turbo.json"), "utf8");
      for (const name of requiredEnv) {
        expect(example, `${dir}/.env.example declares ${name}`).toMatch(new RegExp(`^${name}=`, "m"));
        expect(turbo, `turbo.json passes ${name} through at runtime`).toContain(`"${name}"`);
      }
    });

    test("the app reads its Convex URLs at request time, not as build-time NEXT_PUBLIC_ values", () => {
      const src = path.join(root, dir, "src");
      expect(existsSync(src)).toBe(true);
      const offenders = readFileSync(path.join(root, dir, "src/proxy.ts"), "utf8").match(/process\.env\.NEXT_PUBLIC_CONVEX_\w+/g);
      expect(offenders).toBeNull();
    });
  });
});
