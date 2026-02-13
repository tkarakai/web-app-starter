import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// CSP is handled by proxy.ts (nonce-based)
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@repo/design-system", "@repo/design-patterns", "@repo/edge-rate-limit", "@repo/i18n"],
  headers: async () => [{ source: "/(.*)", headers: securityHeaders }],
  turbopack: {
    root: "../..",
  },
};

export default withNextIntl(nextConfig);
