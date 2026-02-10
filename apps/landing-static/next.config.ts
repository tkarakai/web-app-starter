import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: process.env.NODE_ENV === "production" ? "export" : undefined,
  trailingSlash: true,
  reactStrictMode: true,
  transpilePackages: ["@repo/design-system", "@repo/design-patterns", "@repo/i18n"],
  images: {
    unoptimized: true,
  },
};

export default withNextIntl(nextConfig);
