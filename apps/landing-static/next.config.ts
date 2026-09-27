import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { getGitBranch } from "@web-app-starter/design-system/build-utils";

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const gitBranch = getGitBranch();

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: process.env.NODE_ENV === "production" ? "export" : undefined,
  trailingSlash: true,
  reactStrictMode: true,
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
