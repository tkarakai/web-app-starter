import { test, expect, type ConsoleMessage } from "@playwright/test";

/**
 * Example Playwright E2E tests demonstrating common testing patterns.
 * These tests verify the homepage loads correctly and basic navigation works.
 */

test.describe("Homepage", () => {
  test("loads and displays the correct title", async ({ page }) => {
    await page.goto("/");

    // Verify the page title
    await expect(page).toHaveTitle("Launchpad Starter");
  });

  test("displays main heading and hero content", async ({ page }) => {
    await page.goto("/");

    // Check the main heading is visible
    const heading = page.getByRole("heading", {
      name: "A bold baseline for your next web app build.",
      level: 1,
    });
    await expect(heading).toBeVisible();

    // Verify the "Launchpad starter" badge is present
    await expect(page.getByText("Launchpad starter")).toBeVisible();
  });

  test("renders navigation buttons", async ({ page }) => {
    await page.goto("/");

    // Check for the "Start a workspace" button
    const startButton = page.getByRole("link", { name: /Start a workspace/i });
    await expect(startButton).toBeVisible();
    await expect(startButton).toHaveAttribute("href", "/sign-up");

    // Check for the "View dashboard" button
    const dashboardButton = page.getByRole("link", { name: /View dashboard/i }).first();
    await expect(dashboardButton).toBeVisible();
    await expect(dashboardButton).toHaveAttribute("href", "/dashboard");
  });

  test("displays all four feature pillars", async ({ page }) => {
    await page.goto("/");

    // Verify all four pillar cards are present
    await expect(page.getByText("Next.js 16 + React 19")).toBeVisible();
    await expect(page.getByText("Convex as the backend")).toBeVisible();
    await expect(page.getByText("Better Auth")).toBeVisible();
    await expect(page.getByText("Bun-first workflow")).toBeVisible();
  });

  test("has no console errors on load", async ({ page }) => {
    const consoleErrors: ConsoleMessage[] = [];

    // Listen for console errors
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message);
      }
    });

    await page.goto("/");

    // Wait for page to be fully loaded
    await page.waitForLoadState("networkidle");

    // Assert no console errors occurred
    expect(consoleErrors).toHaveLength(0);
  });
});

test.describe("Navigation", () => {
  test("sign-up link navigates to sign-up page", async ({ page }) => {
    await page.goto("/");

    // Click the sign-up button
    await page.getByRole("link", { name: /Start a workspace/i }).click();

    // Verify navigation to sign-up page
    await expect(page).toHaveURL("/sign-up");
  });

  test("dashboard link navigates to dashboard page", async ({ page }) => {
    await page.goto("/");

    // Click the first dashboard link
    await page.getByRole("link", { name: /View dashboard/i }).first().click();

    // Verify navigation to dashboard page
    await expect(page).toHaveURL("/dashboard");
  });
});

test.describe("Accessibility", () => {
  test("page has proper heading hierarchy", async ({ page }) => {
    await page.goto("/");

    // Verify h1 exists and is unique
    const h1Elements = page.getByRole("heading", { level: 1 });
    await expect(h1Elements).toHaveCount(1);

    // Verify page has semantic structure with main element
    const mainElement = page.locator("main");
    await expect(mainElement).toBeVisible();
  });

  test("interactive elements are keyboard accessible", async ({ page }) => {
    await page.goto("/");

    // Focus the first button using keyboard navigation
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    // Verify a link is focused
    const focusedElement = page.locator(":focus");
    await expect(focusedElement).toBeVisible();
  });
});
