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
 * See platform/docs/deployment-architecture.md
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
