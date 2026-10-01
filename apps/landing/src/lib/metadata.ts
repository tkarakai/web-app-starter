import type { Metadata } from "next";
import { appConfig } from "@web-app-starter/app-config";
import { defaultLocale, locales } from "@web-app-starter/i18n";

export type LandingPath = "/" | "/about" | "/privacy" | "/terms";

/** Match the trailing-slash routes emitted by the static export, including a site URL path prefix. */
export function localizedPageUrl(siteUrl: string, locale: string, pathname: LandingPath): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/${locale}${pathname === "/" ? "/" : `${pathname}/`}`;
}

/** Page-owned metadata: a layout cannot know which descendant route is being rendered. */
export function pageMetadata({ locale, pathname, title, description }: {
  locale: string;
  pathname: LandingPath;
  title: string;
  description: string;
}): Metadata {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error("Missing required environment variable: NEXT_PUBLIC_SITE_URL");
  const canonical = localizedPageUrl(siteUrl, locale, pathname);

  return {
    title: pathname === "/" ? { absolute: title } : title,
    description,
    alternates: {
      canonical,
      languages: {
        ...Object.fromEntries(locales.map((target) => [target, localizedPageUrl(siteUrl, target, pathname)])),
        "x-default": localizedPageUrl(siteUrl, defaultLocale, pathname),
      },
    },
    openGraph: {
      type: "website",
      locale,
      url: canonical,
      siteName: appConfig.identity.productName,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
