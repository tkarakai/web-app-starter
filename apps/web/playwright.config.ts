import { defineConfig, devices } from "@playwright/test";
import { e2eOrigin } from "../../platform/tooling/e2e-ports";

// E2E_BASE_URL points the suite at an already-deployed app (e.g. the local AWS
// stack: E2E_BASE_URL=http://web.localhost:8080) instead of starting a dev server.
const deployedBaseUrl = process.env.E2E_BASE_URL || undefined;

const managedOrigin = process.env.E2E_BASE_URL ? undefined : e2eOrigin("web");

export default defineConfig({
  testDir: "./qa/e2e",
  outputDir: "./qa/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Sharded CI runs emit blob reports that a downstream job merges into one HTML
  // report; a local run still gets the HTML report directly.
  //
  // CI runs four shards (platform-ci-web.yml). Each shard runs whole spec files,
  // balanced by the per-file seconds in qa/e2e/shard-durations.json; refresh it
  // when you add or slow down specs (platform/docs/testing.md).
  reporter: process.env.CI
    ? [["github"], ["blob"]]
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
        command: "../../platform/tooling/dev-start.sh --ci --app=web",
        // Playwright defaults webServer stdout to "ignore". When the script fails to
        // boot in CI that leaves "Process from config.webServer was not able to
        // start. Exit code: 1" and nothing else — no way to tell what broke.
        stdout: "pipe",
        stderr: "pipe",
        url: managedOrigin,
        reuseExistingServer: false,
        timeout: 180 * 1000,
      },
});
