import { test, expect, type ConsoleMessage } from "@playwright/test";

test.describe("Admin Homepage", () => {
  test("loads and displays the correct title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Admin - Launchpad Starter");
  });

  test("displays the admin dashboard heading", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "Admin Dashboard", level: 1 });
    await expect(heading).toBeVisible();
  });

  test("has no console errors on load", async ({ page }) => {
    const consoleErrors: ConsoleMessage[] = [];

    const isExpectedError = (text: string, locationUrl: string): boolean => {
      // Auth session 400 errors are expected when auth is not fully configured
      const isAuthSessionUrl = /\/api\/auth\/get-session/.test(locationUrl);
      const is400Error = /400|Bad Request/.test(text);
      const isFailedToLoad = /Failed to load resource/.test(text);

      if (isAuthSessionUrl && (is400Error || isFailedToLoad)) {
        return true;
      }

      if (/\/api\/auth\/get-session.*400/.test(text)) {
        return true;
      }

      return false;
    };

    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        const locationUrl = message.location().url;
        if (!isExpectedError(text, locationUrl)) {
          consoleErrors.push(message);
        }
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
