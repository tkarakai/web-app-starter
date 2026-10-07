"use client";
import { usePathname } from "next/navigation";
import { EnvironmentBannerWrapper, OfflineBanner } from "@web-app-starter/design-system";
import { appConfig } from "@web-app-starter/app-config";

/** The isolated authorization screen exposes only the authentication/consent flow. */
export function AdminStatusBanners({ authOnly = false }: { authOnly?: boolean }) {
  const pathname = usePathname();
  if (authOnly || pathname === "/settings/agent-access") return null;
  return <>
    {appConfig.features.environmentBanner && <EnvironmentBannerWrapper appName="admin" />}
    <OfflineBanner />
  </>;
}
