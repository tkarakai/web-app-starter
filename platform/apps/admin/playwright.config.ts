import { defineConfig, devices } from "@playwright/test";
import { e2eOrigin } from "../../tooling/e2e-ports";

// E2E_BASE_URL points the suite at an already-deployed app (e.g. the local AWS
// stack: E2E_BASE_URL=http://admin.localhost:8080) instead of starting a dev server.
const deployedBaseUrl = process.env.E2E_BASE_URL || undefined;

const managedOrigin = process.env.E2E_BASE_URL ? undefined : e2eOrigin("admin");

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
  updateSnapshots: "missing",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: deployedBaseUrl ?? managedOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: deployedBaseUrl
    ? undefined
    : {
        command: "../../tooling/dev-start.sh --ci --app=admin",
        // Playwright discards webServer stdout by default, which turns any CI
        // boot failure into a bare "Exit code: 1" with no diagnostics.
        stdout: "pipe",
        stderr: "pipe",
        url: managedOrigin,
        reuseExistingServer: false,
        timeout: 180 * 1000,
      },
});
