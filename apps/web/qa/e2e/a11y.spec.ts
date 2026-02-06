/**
 * Accessibility (A11y) Tests
 *
 * These tests use axe-core to automatically detect accessibility violations.
 * They help ensure the application meets WCAG 2.1 AA standards.
 *
 * Run with: bunx playwright test qa/e2e/a11y.spec.ts
 *
 * @tags a11y accessibility
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Helper to run axe accessibility scan and generate report
 */
async function checkAccessibility(
  page: Parameters<Parameters<typeof test>[1]>[0]["page"],
  pageName: string
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();

  // Log violations for debugging
  if (results.violations.length > 0) {
    console.log(`\n🔴 Accessibility violations on ${pageName}:`);
    results.violations.forEach((violation) => {
      console.log(`\n  ${violation.id}: ${violation.description}`);
      console.log(`  Impact: ${violation.impact}`);
      console.log(`  Help: ${violation.helpUrl}`);
      violation.nodes.forEach((node) => {
        console.log(`    - ${node.html}`);
      });
    });
  }

  return results;
}

test.describe("Accessibility Tests @a11y", () => {
  test.describe("Homepage", () => {
    test.skip("homepage has no accessibility violations", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const results = await checkAccessibility(page, "Homepage");

      // Fail test if there are any violations
      expect(
        results.violations,
        `Found ${results.violations.length} accessibility violations`
      ).toHaveLength(0);
    });

    test.skip("homepage passes critical accessibility checks", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Check for specific critical rules
      const results = await new AxeBuilder({ page })
        .withRules([
          "document-title",
          "html-has-lang",
          "landmark-one-main",
          "page-has-heading-one",
          "color-contrast",
          "image-alt",
          "link-name",
          "button-name",
        ])
        .analyze();

      expect(results.violations).toHaveLength(0);
    });
  });

  test.describe("Auth Pages", () => {
    test.skip("sign-in page has no accessibility violations", async ({ page }) => {
      await page.goto("/sign-in");
      await page.waitForLoadState("networkidle");

      const results = await checkAccessibility(page, "Sign In");

      expect(
        results.violations,
        `Found ${results.violations.length} accessibility violations on sign-in`
      ).toHaveLength(0);
    });

    test.skip("sign-up page has no accessibility violations", async ({ page }) => {
      await page.goto("/sign-up");
      await page.waitForLoadState("networkidle");

      const results = await checkAccessibility(page, "Sign Up");

      expect(
        results.violations,
        `Found ${results.violations.length} accessibility violations on sign-up`
      ).toHaveLength(0);
    });

    test("form fields have proper labels", async ({ page }) => {
      await page.goto("/sign-in");
      await page.waitForLoadState("networkidle");

      // Check specifically for form-related accessibility
      const results = await new AxeBuilder({ page })
        .withRules(["label", "label-title-only", "autocomplete-valid"])
        .analyze();

      expect(results.violations).toHaveLength(0);
    });
  });

  test.describe("Keyboard Navigation", () => {
    test("homepage is keyboard navigable", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Tab through the page and verify focus is visible
      const body = page.locator("body");
      await body.press("Tab");

      // Check that something received focus
      const focusedElement = page.locator(":focus");
      await expect(focusedElement).toBeVisible();

      // Continue tabbing and verify focus moves
      await page.keyboard.press("Tab");
      const secondFocusedElement = page.locator(":focus");
      await expect(secondFocusedElement).toBeVisible();
    });

    test("skip to main content link works", async ({ page }) => {
      await page.goto("/");

      // Press Tab to focus skip link (if it exists)
      await page.keyboard.press("Tab");

      // Check if a skip link exists and is focusable
      const skipLink = page.locator('[href="#main"], [href="#content"]');
      const skipLinkCount = await skipLink.count();

      if (skipLinkCount > 0) {
        await expect(skipLink.first()).toBeFocused();
      }
    });
  });

  test.describe("Color Contrast", () => {
    test.skip("text has sufficient color contrast", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withRules(["color-contrast", "color-contrast-enhanced"])
        .analyze();

      // Log any contrast issues for fixing
      if (results.violations.length > 0) {
        console.log("\n🎨 Color contrast issues:");
        results.violations.forEach((v) => {
          v.nodes.forEach((n) => {
            console.log(`  - ${n.html}`);
            console.log(`    ${n.failureSummary}`);
          });
        });
      }

      expect(results.violations).toHaveLength(0);
    });
  });

  test.describe("Dark Mode Accessibility", () => {
    test.skip("dark mode maintains accessibility standards", async ({ page }) => {
      await page.goto("/");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForLoadState("networkidle");

      const results = await checkAccessibility(page, "Homepage (Dark Mode)");

      expect(
        results.violations,
        "Dark mode should maintain accessibility standards"
      ).toHaveLength(0);
    });
  });

  test.describe("Mobile Accessibility", () => {
    test.skip("mobile viewport maintains accessibility", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const results = await checkAccessibility(page, "Homepage (Mobile)");

      expect(
        results.violations,
        "Mobile view should maintain accessibility standards"
      ).toHaveLength(0);
    });
  });
});
