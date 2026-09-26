import { expect, test } from "@playwright/test";
import platformFrench from "@web-app-starter/i18n/messages/fr.json";
import appFrench from "@repo/messages/fr.json";
import platformArabic from "@web-app-starter/i18n/messages/ar.json";
import appArabic from "@repo/messages/ar.json";
import { appConfig } from "@web-app-starter/app-config";

// Platform and app namespaces, as the app loads them.
const french = { ...platformFrench, ...appFrench };
const arabic = { ...platformArabic, ...appArabic };

for (const [locale, messages] of [["fr", french], ["ar", arabic]] as const) {
  test(`${locale} legal pages render translated content and footer`, async ({ page }) => {
    for (const route of ["privacy", "terms"] as const) {
      await page.goto(`/${locale}/${route}/`);
      await expect(page.getByRole("heading", { name: messages.legal[route].heading, exact: true })).toBeVisible();
      await expect(page.getByText(messages.legal[route].description, { exact: true })).toBeVisible();
      await expect(page.locator("footer")).toContainText(appConfig.identity.legalEntity);
      await expect(page.locator("body")).not.toContainText("This is a template");
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    }
  });
}

test("the shared static 404 resolves the locale from the requested URL", async ({ page }) => {
  await page.goto("/ar/does-not-exist/");
  await expect(page.getByRole("heading", { name: arabic.common.notFound })).toBeVisible();
  await expect(page.locator('[lang="ar"][dir="rtl"]')).toBeVisible();
});
