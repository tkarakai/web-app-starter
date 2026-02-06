import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@repo/ui", "@repo/auth", "@repo/backend"],
};

export default nextConfig;
