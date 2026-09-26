"use client";

import { createContext, useContext, type PropsWithChildren } from "react";

/**
 * Environment-specific values that client components need at runtime.
 *
 * These deliberately do NOT use `NEXT_PUBLIC_*`. Next.js inlines every
 * `NEXT_PUBLIC_*` variable into the client bundle at build time, which pins the
 * build to one environment and makes it impossible to promote a staging
 * artifact to production. Instead, a root server layout reads the unprefixed
 * variables at request time and passes them here as props; React serializes
 * them into the RSC payload, so client components get real runtime values from
 * an environment-agnostic build.
 *
 * Values that identify the *build* rather than the environment
 * (`NEXT_PUBLIC_GIT_SHA`, `NEXT_PUBLIC_BUILD_ID`, ...) are unaffected — they
 * are identical across a promote, so inlining them is correct.
 *
 * See docs/deployment-architecture.md
 */
export type PublicConfig = {
  /** Convex deployment URL (`CONVEX_URL`). */
  convexUrl: string;
  /** Convex HTTP actions URL (`CONVEX_SITE_URL`). */
  convexSiteUrl: string;
  /** Marketing site URL (`LANDING_URL`), when the app links to it. */
  landingUrl?: string;
  /** Web app URL (`WEB_APP_URL`), when the app links to it. */
  webAppUrl?: string;
  /** Deployment environment (`APP_ENVIRONMENT`). */
  appEnvironment?: "development" | "staging" | "production";
};

const PublicConfigContext = createContext<PublicConfig | null>(null);

export function PublicConfigProvider({
  value,
  children,
}: PropsWithChildren<{ value: PublicConfig }>) {
  return (
    <PublicConfigContext.Provider value={value}>{children}</PublicConfigContext.Provider>
  );
}

/**
 * Read runtime config in a client component.
 *
 * Throws when used outside the provider — that means a root layout is missing
 * its `PublicConfigProvider`, which would otherwise surface much later as an
 * undefined URL at the point of use.
 */
export function usePublicConfig(): PublicConfig {
  const config = useContext(PublicConfigContext);
  if (!config) {
    throw new Error(
      "usePublicConfig must be used within a PublicConfigProvider. " +
        "Add it to the app's root layout and populate it from process.env at request time."
    );
  }
  return config;
}
