import { headers } from "next/headers";

/**
 * The origin this request was served on, e.g. `https://app.example.com`.
 *
 * Used for canonical URLs, the sitemap and robots.txt. Deriving the origin from
 * the request rather than from a SITE_URL variable keeps one more piece of
 * environment identity out of the build — a promoted artifact reports whichever
 * host actually served it, with no configuration to keep in sync.
 *
 * Reading headers opts the caller into dynamic rendering, which is required
 * anyway: a statically prerendered route would bake the origin in at build time.
 *
 * See docs/deployment-architecture.md
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
