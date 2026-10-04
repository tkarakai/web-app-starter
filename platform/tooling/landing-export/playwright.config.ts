import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".", outputDir: "../qa/test-results/export", workers: 1,
  forbidOnly: !!process.env.CI, retries: 0, reporter: "list",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
