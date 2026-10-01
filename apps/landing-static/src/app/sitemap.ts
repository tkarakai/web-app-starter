import type { MetadataRoute } from "next";
import { locales } from "@web-app-starter/i18n";
import { localizedPageUrl, type LandingPath } from "@/lib/metadata";

export const dynamic = "force-static";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
if (!SITE_URL) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_SITE_URL");
}

function generateAlternates(pathname: LandingPath) {
  return {
    languages: Object.fromEntries(
      locales.map((locale) => [
        locale,
        localizedPageUrl(SITE_URL!, locale, pathname),
      ])
    ),
  };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/about", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/privacy", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/terms", priority: 0.5, changeFrequency: "monthly" as const },
  ] satisfies { path: LandingPath; priority: number; changeFrequency: "weekly" | "monthly" }[];

  return routes.flatMap(({ path, priority, changeFrequency }) =>
    locales.map((locale) => ({
      url: localizedPageUrl(SITE_URL!, locale, path),
      lastModified: new Date(),
      changeFrequency,
      priority,
      alternates: generateAlternates(path),
    }))
  );
}
