import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_DIRS } from "@web-app-starter/app-config";
import { NextRequest, type NextResponse } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const variants: Record<string, string>[] = [
  {},
  { "next-router-prefetch": "1" },
  { purpose: "prefetch" },
  { "next-router-prefetch": "1", purpose: "prefetch" },
];
type ProxyModule = {
  config: Parameters<typeof unstable_doesMiddlewareMatch>[0]["config"];
  proxy: (request: NextRequest) => NextResponse;
};

describe.each([
  { app: "web" as const, signIn: "/en/sign-in", protectedPath: "/en/dashboard" },
  { app: "admin" as const, signIn: "/sign-in", protectedPath: "/dashboard" },
])("$app prefetch security", ({ app, signIn, protectedPath }) => {
  async function load(): Promise<ProxyModule> {
    return import(pathToFileURL(path.join(root, APP_DIRS[app], "src/proxy.ts")).href);
  }

  test("all page requests reach the proxy regardless of prefetch headers", async () => {
    const { config } = await load();
    for (const url of ["/", signIn, protectedPath]) {
      for (const headers of variants) {
        expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url, headers })).toBe(true);
      }
    }
  });

  test("prefetch and ordinary requests consume one shared budget and receive security headers", async () => {
    const { config, proxy } = await load();
    const ip = app === "web" ? "192.0.2.201" : "192.0.2.202";
    const send = (headers: Record<string, string>) => {
      // Simulate dispatch as well as the handler: a matcher exemption must fail this contract.
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: signIn, headers })).toBe(true);
      return proxy(new NextRequest(new URL(signIn, "http://localhost"), {
        headers: { ...headers, "x-forwarded-for": ip },
      }));
    };
    const first = send({});
    const limit = Number(first.headers.get("x-ratelimit-limit"));
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(1000);
    for (let used = 1; used < limit; used++) {
      const response = send(variants[used % variants.length]!);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-ratelimit-remaining")).toBe(String(limit - used - 1));
      expect(response.headers.get("content-security-policy")).toContain("'nonce-");
    }
    for (const headers of variants) {
      const denied = send(headers);
      expect(denied.status).toBe(429);
      expect(denied.headers.get("x-ratelimit-remaining")).toBe("0");
      expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
    }
  });
});
