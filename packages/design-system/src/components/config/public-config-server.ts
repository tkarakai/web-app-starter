import { headers } from "next/headers";
import type { PublicConfig } from "./public-config";

/**
 * Read runtime config from `process.env` in a server component.
 *
 * Call this in a root layout and hand the result to `PublicConfigProvider`.
 * Throws on a missing required variable so a misconfigured deployment fails
 * loudly on the first request rather than serving a client with undefined URLs.
 *
 * The variables are deliberately unprefixed: a `NEXT_PUBLIC_*` read would be
 * inlined at build time and pin the artifact to one environment.
 * See docs/claude/build-once-promote-plan.md
 */
export function readPublicConfigFromEnv(
  options: { landingUrl?: boolean; webAppUrl?: boolean } = {}
): PublicConfig {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };

  return {
    convexUrl: required("CONVEX_URL"),
    convexSiteUrl: required("CONVEX_SITE_URL"),
    ...(options.landingUrl ? { landingUrl: required("LANDING_URL") } : {}),
    ...(options.webAppUrl ? { webAppUrl: required("WEB_APP_URL") } : {}),
    appEnvironment: process.env.APP_ENVIRONMENT as PublicConfig["appEnvironment"],
  };
}

/**
 * The origin this request was served on, e.g. `https://app.example.com`.
 *
 * Used for canonical URLs, sitemaps and robots.txt. Deriving the origin from the
 * request rather than from a `SITE_URL` variable removes one more piece of
 * environment identity from the build — a promoted artifact reports whichever
 * host actually served it, with no configuration to keep in sync.
 *
 * Reading headers opts the caller into dynamic rendering, which is required
 * anyway: a statically prerendered route would bake the origin in at build time.
 */
export async function getRequestOrigin(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  if (!host) {
    throw new Error("Cannot determine request origin: no Host header present");
  }
  const protocol =
    headersList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
