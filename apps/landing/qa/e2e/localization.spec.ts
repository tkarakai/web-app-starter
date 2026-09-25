import { expect, test } from "@playwright/test";
import french from "@repo/i18n/messages/fr.json";
import arabic from "@repo/i18n/messages/ar.json";

for (const [locale, messages] of [["fr", french], ["ar", arabic]] as const) {
  test(`${locale} legal pages render translated content and footer`, async ({ page }) => {
    for (const route of ["privacy", "terms"] as const) {
      await page.goto(`/${locale}/${route}`);
      await expect(page.getByRole("heading", { name: messages.legal[route].heading, exact: true })).toBeVisible();
      await expect(page.getByText(messages.legal[route].description, { exact: true })).toBeVisible();
      await expect(page.locator("footer")).toContainText(messages.common.appName);
      await expect(page.locator("body")).not.toContainText("This is a template");
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    }
  });
}
