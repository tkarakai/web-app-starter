"use client";

import { AppWaitlistForm } from "@repo/onboarding";
import { PublicConfigProvider } from "@web-app-starter/design-system";

/** Static landing supplies build-time URLs; web supplies request-time URLs. */
export function WaitlistForm() {
  const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!convexSiteUrl) throw new Error("Missing required environment variable: NEXT_PUBLIC_CONVEX_SITE_URL");
  return (
    <PublicConfigProvider value={{ convexUrl: "", convexSiteUrl, landingUrl: process.env.NEXT_PUBLIC_SITE_URL }}>
      <AppWaitlistForm convexSiteUrl={convexSiteUrl} />
    </PublicConfigProvider>
  );
}
