import type { MetadataRoute } from "next";
import { locales } from "@web-app-starter/i18n";
import { getRequestOrigin } from "@/lib/request-origin";

// Dynamic so the origin comes from the request rather than being baked in at
// build time — that is what lets one artifact serve any environment.
// See platform/docs/deployment-architecture.md
export const dynamic = "force-dynamic";

function generateAlternates(siteUrl: string, pathname: string) {
  return {
    languages: Object.fromEntries(
      locales.map((locale) => [
        locale,
        `${siteUrl}/${locale}${pathname === "/" ? "" : pathname}`,
      ])
    ),
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = await getRequestOrigin();

  const routes = [
    { path: "/sign-in", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/sign-up", priority: 0.7, changeFrequency: "monthly" as const },
    {
      path: "/dashboard",
      priority: 0.3,
      changeFrequency: "always" as const,
    },
  ];

  return routes.flatMap(({ path, priority, changeFrequency }) =>
    locales.map((locale) => ({
      url: `${siteUrl}/${locale}${path}`,
      lastModified: new Date(),
      changeFrequency,
      priority,
      alternates: generateAlternates(siteUrl, path),
    }))
  );
}
