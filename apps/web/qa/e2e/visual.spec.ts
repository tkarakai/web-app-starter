/**
 * Visual Regression Tests
 *
 * These tests capture screenshots and compare them against baseline images
 * to detect unintended visual changes.
 *
 * BASELINE MANAGEMENT:
 * - First run: Baselines are auto-created (updateSnapshots: 'missing' in config)
 * - CI uploads generated snapshots as artifacts for review
 * - To update baselines: bunx playwright test qa/e2e/visual.spec.ts --update-snapshots
 * - Commit baseline images in qa/e2e/__screenshots__/ to the repo
 *
 * Run locally: bunx playwright test qa/e2e/visual.spec.ts
 * Run specific browser: bunx playwright test qa/e2e/visual.spec.ts --project=chromium
 *
 * @tags visual
 */

import { test, expect } from "@playwright/test";
import {
  expectPageSnapshot,
  expectResponsiveSnapshot,
  fullVisualTest,
} from "../tests/helpers/visual-regression";

test.describe("Visual Regression Tests @visual", () => {
  test.describe("Homepage", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      // Wait for page to fully load
      await page.waitForLoadState("networkidle");
    });

    test.skip("homepage - desktop view", async ({ page }) => {
      await expectPageSnapshot(page, "homepage-desktop");
    });

    test.skip("homepage - responsive views", async ({ page }) => {
      await expectResponsiveSnapshot(page, "homepage", "mobile");
      await expectResponsiveSnapshot(page, "homepage", "tablet");
      await expectResponsiveSnapshot(page, "homepage", "desktop");
    });

    test.skip("homepage - full visual test (viewports + themes)", async ({
      page,
    }) => {
      await fullVisualTest(page, "homepage-full", {
        viewports: ["mobile", "desktop"],
        themes: ["light", "dark"],
      });
    });

    test.skip("hero section", async ({ page }) => {
      const heroSection = page.locator("main").first();
      await expect(heroSection).toHaveScreenshot("hero-section.png", {
        animations: "disabled",
      });
    });
  });

  test.describe("Auth Pages", () => {
    test.skip("sign-in page", async ({ page }) => {
      await page.goto("/sign-in");
      await page.waitForLoadState("networkidle");
      await expectPageSnapshot(page, "sign-in-page");
    });

    test.skip("sign-up page", async ({ page }) => {
      await page.goto("/sign-up");
      await page.waitForLoadState("networkidle");
      await expectPageSnapshot(page, "sign-up-page");
    });

    test.skip("sign-in page - responsive", async ({ page }) => {
      await page.goto("/sign-in");
      await page.waitForLoadState("networkidle");
      await expectResponsiveSnapshot(page, "sign-in", "mobile");
      await expectResponsiveSnapshot(page, "sign-in", "desktop");
    });
  });

  test.describe("UI Components", () => {
    test.skip("navigation buttons", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Capture sign-up button
      const signUpButton = page.getByRole("link", { name: /sign up/i }).first();
      if (await signUpButton.isVisible()) {
        await expect(signUpButton).toHaveScreenshot("signup-button.png", {
          animations: "disabled",
        });
      }

      // Capture sign-in button
      const signInButton = page.getByRole("link", { name: /sign in/i }).first();
      if (await signInButton.isVisible()) {
        await expect(signInButton).toHaveScreenshot("signin-button.png", {
          animations: "disabled",
        });
      }
    });

    test.skip("feature cards", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Find feature card container
      const featureSection = page.locator('[class*="grid"]').first();
      if (await featureSection.isVisible()) {
        await expect(featureSection).toHaveScreenshot("feature-cards.png", {
          animations: "disabled",
        });
      }
    });
  });

  test.describe("Dark Mode", () => {
    test.skip("homepage - dark mode", async ({ page }) => {
      await page.goto("/");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForLoadState("networkidle");
      await expectPageSnapshot(page, "homepage-dark");
    });

    test.skip("sign-in - dark mode", async ({ page }) => {
      await page.goto("/sign-in");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForLoadState("networkidle");
      await expectPageSnapshot(page, "sign-in-dark");
    });
  });
});
