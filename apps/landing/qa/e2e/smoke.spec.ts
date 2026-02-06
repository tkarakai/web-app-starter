import { test, expect, type ConsoleMessage } from "@playwright/test";

test.describe("Landing Homepage", () => {
  test("loads and displays the correct title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Launchpad Starter");
  });

  test("displays main heading", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
  });

  test("has no console errors on load", async ({ page }) => {
    const consoleErrors: ConsoleMessage[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(consoleErrors).toHaveLength(0);
  });

  test("page has proper heading hierarchy", async ({ page }) => {
    await page.goto("/");
    const h1Elements = page.getByRole("heading", { level: 1 });
    await expect(h1Elements).toHaveCount(1);
    const mainElement = page.locator("main");
    await expect(mainElement).toBeVisible();
  });
});
