import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3001";

export default function robots(): MetadataRoute.Robots {
  const isProd = process.env.NODE_ENV === "production";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/*/sign-in", "/*/sign-up"],
        disallow: isProd ? ["/*/dashboard"] : ["/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
