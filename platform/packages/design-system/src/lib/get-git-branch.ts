import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/**
 * Detect the current git branch at build time.
 * Respects NEXT_PUBLIC_GIT_BRANCH if already set (e.g. by CI),
 * otherwise falls back to `git rev-parse`.
 *
 * Returns an empty string when git is unavailable.
 */
export function getGitBranch(): string {
  const fromEnv = process.env.NEXT_PUBLIC_GIT_BRANCH ?? "";
  if (fromEnv) return fromEnv;

  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

/** Read the installed starter version for build-time banner metadata. */
export function getPlatformVersion(monorepoRoot: string): string {
  return readFileSync(join(monorepoRoot, "platform/VERSION"), "utf8").trim();
}
