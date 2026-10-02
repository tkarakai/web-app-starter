import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { getGitBranch } from "@web-app-starter/design-system/build-utils";

const appDir = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = join(appDir, "../..");

const gitBranch = getGitBranch();

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: process.env.NODE_ENV === "production" ? "export" : undefined,
  trailingSlash: true,
  reactStrictMode: true,
  // Locale and entry routes have separate root layouts, so the shared static 404 is
  // global-not-found.tsx. An app that kept one root layout and its own not-found.tsx stays on that 404.
  experimental: { globalNotFound: existsSync(join(appDir, "src/app/global-not-found.tsx")) },
  env: {
    ...(gitBranch ? { NEXT_PUBLIC_GIT_BRANCH: gitBranch } : {}),
  },
  transpilePackages: ["@web-app-starter/app-config", "@web-app-starter/design-system", "@web-app-starter/design-patterns", "@web-app-starter/i18n", "@repo/messages"],
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

export default withNextIntl(nextConfig);
