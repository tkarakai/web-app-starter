import { defineConfig, devices } from "@playwright/test";
import { e2eOrigin } from "../../tooling/e2e-ports";

const managedOrigin = e2eOrigin("storybook");

export default defineConfig({
  testDir: "./qa/e2e",
  outputDir: "./qa/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "qa/playwright-report" }]]
    : [["html", { outputFolder: "qa/playwright-report" }]],
  use: {
    baseURL: managedOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "../../tooling/dev-start.sh --ci --app=storybook",
    // Playwright discards webServer stdout by default, which turns any CI
    // boot failure into a bare "Exit code: 1" with no diagnostics.
    stdout: "pipe",
    stderr: "pipe",
    wait: { stdout: /PLATFORM_E2E_READY/ },
    reuseExistingServer: false,
    timeout: 180 * 1000,
  },
});
