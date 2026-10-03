import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { getGitBranch, getPlatformVersion } from "@web-app-starter/design-system/build-utils";

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const gitBranch = getGitBranch();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_PLATFORM_VERSION: getPlatformVersion(monorepoRoot),
    ...(gitBranch ? { NEXT_PUBLIC_GIT_BRANCH: gitBranch } : {}),
  },
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
