import { defineConfig, devices } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Read a value from .env.local (updated by dev-start.sh with actual ports)
 */
function getEnvValue(name: string, fallback: string): string {
  const envPath = path.join(__dirname, ".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.match(new RegExp(`^${name}=(.*)`, "m"));
    if (match) return match[1].trim();
  }
  return fallback;
}

/**
 * Playwright configuration for E2E testing.
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Directory containing E2E test files
  testDir: "./e2e",

  // Run tests in parallel for faster execution
  fullyParallel: true,

  // Fail the build on CI if test.only is accidentally left in
  forbidOnly: !!process.env.CI,

  // Retry failed tests on CI only
  retries: process.env.CI ? 2 : 0,

  // Limit parallel workers on CI for stability
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: process.env.CI ? "github" : "html",

  // Snapshot configuration for visual regression tests
  // 'missing' creates new baselines but fails on actual differences
  updateSnapshots: "missing",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",

  // Expect configuration for visual comparisons
  expect: {
    toHaveScreenshot: {
      // Allow small differences due to anti-aliasing
      maxDiffPixelRatio: 0.01,
      // Threshold for color difference (0-1)
      threshold: 0.2,
    },
  },

  // Shared settings for all projects
  use: {
    // Base URL for navigation actions (read from .env.local for dynamic ports)
    baseURL: getEnvValue("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),

    // Collect trace on first retry for debugging failures
    trace: "on-first-retry",

    // Take screenshot on failure
    screenshot: "only-on-failure",
  },

  // Configure browser projects
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  // Run full dev environment (Convex + Next.js) before starting tests
  // Uses dev:ci which runs in foreground mode with verbose logging
  // Ports are read from .env.local which dev-start.sh updates with actual values
  webServer: {
    command: "bun run dev:ci",
    url: getEnvValue("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000, // longer timeout for both services to start
  },
});
