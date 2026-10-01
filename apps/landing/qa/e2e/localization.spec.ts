import { expect, test } from "@playwright/test";
import { createTranslator } from "next-intl";
import { appConfig } from "@web-app-starter/app-config";
import { getLocaleDirection, locales } from "@web-app-starter/i18n";
import { loadMessages } from "@web-app-starter/i18n/messages";

for (const locale of locales) {
  test(`${locale} legal pages render translated content and footer`, async ({ page }) => {
    const t = createTranslator({ locale, messages: await loadMessages(locale) });
    for (const route of ["privacy", "terms"] as const) {
      await page.goto(`/${locale}/${route}`);
      await expect(page.getByRole("heading", { name: t(`legal.${route}.heading`), exact: true })).toBeVisible();
      await expect(page.getByText(t(`legal.${route}.description`), { exact: true })).toBeVisible();
      await expect(page.locator("footer")).toContainText(appConfig.identity.legalEntity);
      await expect(page.locator("body")).not.toContainText("This is a template");
      await expect(page.locator("html")).toHaveAttribute("dir", getLocaleDirection(locale));
    }
  });
}
