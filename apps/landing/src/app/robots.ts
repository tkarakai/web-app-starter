import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

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
