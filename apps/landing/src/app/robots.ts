import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  const isProd = process.env.NODE_ENV === "production";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: isProd ? [] : ["/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
