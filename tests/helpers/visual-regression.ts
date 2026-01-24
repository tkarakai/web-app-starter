/**
 * Visual Regression Testing Helpers for Playwright
 *
 * This module provides utilities for visual regression testing with Playwright.
 * It enables screenshot comparison testing to catch unintended visual changes.
 *
 * @module tests/helpers/visual-regression
 */

import type { Page, Locator, PageScreenshotOptions } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Default screenshot options for consistency
 */
export const defaultScreenshotOptions: PageScreenshotOptions = {
  animations: "disabled",
  scale: "css",
};

/**
 * Configuration for visual regression tests
 */
export interface VisualRegressionConfig {
  /** Directory to store screenshots */
  screenshotsDir: string;
  /** Threshold for pixel difference (0-1) */
  threshold: number;
  /** Maximum allowed different pixels */
  maxDiffPixels?: number;
  /** Maximum allowed different pixel ratio */
  maxDiffPixelRatio?: number;
}

/**
 * Default configuration
 */
export const defaultConfig: VisualRegressionConfig = {
  screenshotsDir: "e2e/__screenshots__",
  threshold: 0.1,
  maxDiffPixelRatio: 0.01,
};

/**
 * Take a full page screenshot with visual comparison
 *
 * @example
 * ```ts
 * await expectPageSnapshot(page, "homepage");
 * ```
 */
export async function expectPageSnapshot(
  page: Page,
  name: string,
  options: Partial<PageScreenshotOptions> = {}
) {
  // Wait for fonts and images to load
  await page.waitForLoadState("networkidle");

  // Wait a bit for any CSS animations to settle
  await page.waitForTimeout(100);

  await expect(page).toHaveScreenshot(`${name}.png`, {
    ...defaultScreenshotOptions,
    ...options,
  });
}

/**
 * Take a screenshot of a specific element with visual comparison
 *
 * @example
 * ```ts
 * const button = page.getByRole("button", { name: "Submit" });
 * await expectElementSnapshot(button, "submit-button");
 * ```
 */
export async function expectElementSnapshot(
  locator: Locator,
  name: string,
  options: Partial<PageScreenshotOptions> = {}
) {
  await expect(locator).toHaveScreenshot(`${name}.png`, {
    ...defaultScreenshotOptions,
    ...options,
  });
}

/**
 * Take a screenshot with a specific viewport size
 *
 * @example
 * ```ts
 * await expectResponsiveSnapshot(page, "homepage", "mobile");
 * ```
 */
export async function expectResponsiveSnapshot(
  page: Page,
  name: string,
  viewport: "mobile" | "tablet" | "desktop",
  options: Partial<PageScreenshotOptions> = {}
) {
  const viewports = {
    mobile: { width: 375, height: 667 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1280, height: 720 },
  };

  await page.setViewportSize(viewports[viewport]);
  await page.waitForTimeout(100); // Wait for layout shift

  await expect(page).toHaveScreenshot(`${name}-${viewport}.png`, {
    ...defaultScreenshotOptions,
    ...options,
  });
}

/**
 * Mask dynamic content before taking screenshots
 * Useful for dates, times, or user-generated content
 *
 * @example
 * ```ts
 * await expectMaskedSnapshot(page, "dashboard", [
 *   page.locator(".timestamp"),
 *   page.locator(".random-id"),
 * ]);
 * ```
 */
export async function expectMaskedSnapshot(
  page: Page,
  name: string,
  elementsToMask: Locator[],
  options: Partial<PageScreenshotOptions> = {}
) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    ...defaultScreenshotOptions,
    mask: elementsToMask,
    ...options,
  });
}

/**
 * Compare screenshots of a component in different states
 *
 * @example
 * ```ts
 * await compareComponentStates(page, ".button", "button", [
 *   { name: "default", setup: async () => {} },
 *   { name: "hover", setup: async (el) => await el.hover() },
 *   { name: "focus", setup: async (el) => await el.focus() },
 * ]);
 * ```
 */
export async function compareComponentStates(
  page: Page,
  selector: string,
  baseName: string,
  states: Array<{
    name: string;
    setup: (element: Locator) => Promise<void>;
  }>
) {
  const element = page.locator(selector);

  for (const state of states) {
    await state.setup(element);
    await expect(element).toHaveScreenshot(`${baseName}-${state.name}.png`, {
      ...defaultScreenshotOptions,
    });
  }
}

/**
 * Test theme variations (light/dark mode)
 *
 * @example
 * ```ts
 * await expectThemeSnapshots(page, "homepage");
 * ```
 */
export async function expectThemeSnapshots(
  page: Page,
  name: string,
  options: Partial<PageScreenshotOptions> = {}
) {
  // Light mode
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(100);
  await expect(page).toHaveScreenshot(`${name}-light.png`, {
    ...defaultScreenshotOptions,
    ...options,
  });

  // Dark mode
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(100);
  await expect(page).toHaveScreenshot(`${name}-dark.png`, {
    ...defaultScreenshotOptions,
    ...options,
  });
}

/**
 * Full visual regression test setup for a page
 * Tests multiple viewports and themes
 *
 * @example
 * ```ts
 * test("visual regression: homepage", async ({ page }) => {
 *   await page.goto("/");
 *   await fullVisualTest(page, "homepage");
 * });
 * ```
 */
export async function fullVisualTest(
  page: Page,
  name: string,
  options: {
    viewports?: ("mobile" | "tablet" | "desktop")[];
    themes?: ("light" | "dark")[];
    mask?: Locator[];
  } = {}
) {
  const viewports = options.viewports ?? ["mobile", "desktop"];
  const themes = options.themes ?? ["light"];

  for (const viewport of viewports) {
    for (const theme of themes) {
      const viewportConfig = {
        mobile: { width: 375, height: 667 },
        tablet: { width: 768, height: 1024 },
        desktop: { width: 1280, height: 720 },
      };

      await page.setViewportSize(viewportConfig[viewport]);
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(100);

      await expect(page).toHaveScreenshot(
        `${name}-${viewport}-${theme}.png`,
        {
          ...defaultScreenshotOptions,
          mask: options.mask,
        }
      );
    }
  }
}
