import { defineConfig, devices } from "@playwright/test";
import { localAppOrigin } from "@web-app-starter/app-config";
import * as fs from "fs";
import * as path from "path";
import { assertSecretSafeRunner } from "../../platform/tooling/e2e/secret-safe-config";

// Auth tests display TOTP/recovery secrets. Playwright's automatic AI error
// snapshot is independent of trace/screenshot settings and must remain disabled.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
assertSecretSafeRunner();

/**
 * Read a value from .env.local (updated by dev-start.sh with actual ports)
 */
function getEnvValue(name: string, fallback: string): string {
  // Check app-level .env.local first, then root
  for (const envPath of [
    path.join(__dirname, ".env.local"),
    path.join(__dirname, "../../.env.local"),
  ]) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(new RegExp(`^${name}=(.*)`, "m"));
      if (match) return match[1].trim();
    }
  }
  return fallback;
}

// E2E_BASE_URL points the suite at an already-deployed app (e.g. the local AWS
// stack: E2E_BASE_URL=http://web.localhost:8080) instead of starting a dev server.
const deployedBaseUrl = process.env.E2E_BASE_URL || undefined;

export default defineConfig({
  testDir: "./qa/e2e",
  outputDir: "./qa/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // CI runs four shards (platform-ci-web.yml). Each shard runs whole spec files,
  // balanced by the per-file seconds in qa/e2e/shard-durations.json; refresh it
  // when you add or slow down specs (platform/docs/testing.md).
  reporter: [["../../platform/tooling/e2e/secret-safe-reporter.ts"]],
  updateSnapshots: "missing",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: deployedBaseUrl ?? getEnvValue("APP_ORIGIN", localAppOrigin("web")),
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        trace: "off",
        screenshot: "off",
        video: "off",
      },
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
        url: getEnvValue("APP_ORIGIN", localAppOrigin("web")),
        reuseExistingServer: !process.env.CI,
        timeout: 180 * 1000,
      },
});
