/**
 * Visual Regression Tests
 *
 * These tests capture screenshots and compare them against baseline images
 * to detect unintended visual changes. On first run, baselines are created.
 *
 * Run with: bunx playwright test e2e/visual.spec.ts
 * Update baselines: bunx playwright test e2e/visual.spec.ts --update-snapshots
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

    test("homepage - desktop view", async ({ page }) => {
      await expectPageSnapshot(page, "homepage-desktop");
    });

    test("homepage - responsive views", async ({ page }) => {
      await expectResponsiveSnapshot(page, "homepage", "mobile");
      await expectResponsiveSnapshot(page, "homepage", "tablet");
      await expectResponsiveSnapshot(page, "homepage", "desktop");
    });

    test("homepage - full visual test (viewports + themes)", async ({
      page,
    }) => {
      await fullVisualTest(page, "homepage-full", {
        viewports: ["mobile", "desktop"],
        themes: ["light", "dark"],
      });
    });

    test("hero section", async ({ page }) => {
      const heroSection = page.locator("main").first();
      await expect(heroSection).toHaveScreenshot("hero-section.png", {
        animations: "disabled",
      });
    });
  });

  test.describe("Auth Pages", () => {
    test("sign-in page", async ({ page }) => {
      await page.goto("/sign-in");
      await page.waitForLoadState("networkidle");
      await expectPageSnapshot(page, "sign-in-page");
    });

    test("sign-up page", async ({ page }) => {
      await page.goto("/sign-up");
      await page.waitForLoadState("networkidle");
      await expectPageSnapshot(page, "sign-up-page");
    });

    test("sign-in page - responsive", async ({ page }) => {
      await page.goto("/sign-in");
      await page.waitForLoadState("networkidle");
      await expectResponsiveSnapshot(page, "sign-in", "mobile");
      await expectResponsiveSnapshot(page, "sign-in", "desktop");
    });
  });

  test.describe("UI Components", () => {
    test("navigation buttons", async ({ page }) => {
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

    test("feature cards", async ({ page }) => {
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
    test("homepage - dark mode", async ({ page }) => {
      await page.goto("/");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForLoadState("networkidle");
      await expectPageSnapshot(page, "homepage-dark");
    });

    test("sign-in - dark mode", async ({ page }) => {
      await page.goto("/sign-in");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForLoadState("networkidle");
      await expectPageSnapshot(page, "sign-in-dark");
    });
  });
});
