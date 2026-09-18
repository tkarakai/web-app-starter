import type { MetadataRoute } from "next";
import { getRequestOrigin } from "@/lib/request-origin";

// Dynamic so the origin comes from the request rather than being baked in at
// build time — that is what lets one artifact serve any environment.
// See docs/claude/build-once-promote-plan.md
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const isProd = process.env.NODE_ENV === "production";
  const siteUrl = await getRequestOrigin();

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/*/sign-in", "/*/sign-up"],
        disallow: isProd ? ["/*/dashboard"] : ["/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
