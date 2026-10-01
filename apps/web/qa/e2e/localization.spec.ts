import { expect, test } from "@playwright/test";
import { createTranslator } from "next-intl";
import { getLocaleDirection, locales } from "@web-app-starter/i18n";
import { loadMessages } from "@web-app-starter/i18n/messages";

for (const locale of locales) {
  test(`${locale} sign-in renders the multi-step messages rather than missing keys`, async ({ page }) => {
    const t = createTranslator({ locale, messages: await loadMessages(locale) });
    await page.goto(`/${locale}/sign-in`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("button", { name: t("auth.multiStep.emailStep.continue"), exact: true })).toBeVisible();
    await expect(page.getByText(t("auth.multiStep.emailStep.title"), { exact: true }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("auth.multiStep.");
  });

  test(`${locale} reset-password labels remain localized when toggling password visibility`, async ({ page }) => {
    const t = createTranslator({ locale, messages: await loadMessages(locale) });
    await page.goto(`/${locale}/reset-password?token=localization-check`);
    await expect(page.locator("html")).toHaveAttribute("dir", getLocaleDirection(locale));
    const password = page.locator("#new-password");
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: t("common.showPassword") }).first().click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: t("common.hidePassword") })).toBeVisible();
  });
}
