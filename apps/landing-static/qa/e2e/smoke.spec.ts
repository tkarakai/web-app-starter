import { test, expect } from "@playwright/test";
import { appConfig } from "@web-app-starter/app-config";

const { productName } = appConfig.identity;

import { defaultLocale } from "@web-app-starter/i18n";

test.describe("Landing Static Homepage", () => {
  test("loads and displays the correct title", async ({ page }) => {
    await page.goto("/en/");
    await expect(page).toHaveTitle(`${productName}`);
  });

  test("displays main heading", async ({ page }) => {
    await page.goto("/en/");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
  });

  test("has no console errors on load", async ({ page }) => {
    // Strings, not ConsoleMessage objects: a failure on the object array
    // prints an unreadable dump of Playwright internals, which makes a CI
    // failure impossible to diagnose without re-running locally.
    const consoleErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(`${message.text()} @ ${message.location().url}`);
      }
    });

    await page.goto("/en/");
    await page.waitForLoadState("networkidle");
    expect(consoleErrors).toHaveLength(0);
  });

  test("page has proper heading hierarchy", async ({ page }) => {
    await page.goto("/en/");
    const h1Elements = page.getByRole("heading", { level: 1 });
    await expect(h1Elements).toHaveCount(1);
    const mainElement = page.locator("main");
    await expect(mainElement).toBeVisible();
  });
});

test.describe("Footer", () => {
  test("displays footer with legal links", async ({ page }) => {
    await page.goto("/en/");
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
    await expect(footer.getByRole("link", { name: "About" })).toBeVisible();
    await expect(
      footer.getByRole("link", { name: "Privacy Policy" }),
    ).toBeVisible();
    await expect(
      footer.getByRole("link", { name: "Terms of Service" }),
    ).toBeVisible();
  });
});

test.describe("Legal Pages", () => {
  test("about page loads with correct heading", async ({ page }) => {
    await page.goto("/en/about/");
    await expect(page).toHaveTitle(`About | ${productName}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About");
  });

  test("privacy page loads with correct heading", async ({ page }) => {
    await page.goto("/en/privacy/");
    await expect(page).toHaveTitle(`Privacy Policy | ${productName}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Privacy Policy",
    );
  });

  test("terms page loads with correct heading", async ({ page }) => {
    await page.goto("/en/terms/");
    await expect(page).toHaveTitle(`Terms of Service | ${productName}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Terms of Service",
    );
  });

  test("legal pages have back-to-home navigation", async ({ page }) => {
    await page.goto("/en/about/");
    const backLink = page.getByRole("link", { name: /back to home/i });
    await expect(backLink).toBeVisible();
    await backLink.click();
    // Home is the locale root, not the bare origin.
    await expect(page).toHaveURL(/\/en\/?$/);
  });
});

test("bare root is a page and falls back to the configured locale", async ({ page, request }) => {
  expect((await request.get("/")).status()).toBe(200);
  await page.addInitScript(() => Object.defineProperty(globalThis.navigator, "languages", { get: () => ["zz-ZZ"] }));
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/${defaultLocale}/$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
