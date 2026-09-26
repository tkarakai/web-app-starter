import { expect, test } from "@playwright/test";
import french from "@repo/i18n/messages/fr.json";
import arabic from "@repo/i18n/messages/ar.json";
import { appConfig } from "@repo/app-config";

for (const [locale, messages] of [["fr", french], ["ar", arabic]] as const) {
  test(`${locale} legal pages render translated content and footer`, async ({ page }) => {
    for (const route of ["privacy", "terms"] as const) {
      await page.goto(`/${locale}/${route}`);
      await expect(page.getByRole("heading", { name: messages.legal[route].heading, exact: true })).toBeVisible();
      await expect(page.getByText(messages.legal[route].description, { exact: true })).toBeVisible();
      await expect(page.locator("footer")).toContainText(appConfig.identity.legalEntity);
      await expect(page.locator("body")).not.toContainText("This is a template");
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    }
  });
}
