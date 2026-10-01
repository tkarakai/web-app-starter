import { expect, test } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createTranslator } from "next-intl";
import { defaultLocale, getLocaleDirection, locales, mergeMessages, type Messages } from "@web-app-starter/i18n";

// Read JSON directly: Playwright runs in Node, outside the app bundler.
function loadMessages(locale: string): Messages {
  const read = (file: string): Messages => JSON.parse(readFileSync(resolve(__dirname, "../../../..", file), "utf8")) as Messages;
  const appFile = `packages/messages/${locale}.json`;
  const overrides = read("packages/messages/overrides.json")[locale];
  return mergeMessages(
    read(`platform/packages/i18n/messages/${locale}.json`),
    read(existsSync(resolve(__dirname, "../../../..", appFile)) ? appFile : `packages/messages/${defaultLocale}.json`),
    typeof overrides === "object" ? overrides : {},
  );
}

for (const locale of locales) {
  test(`${locale} sign-in renders the multi-step messages rather than missing keys`, async ({ page }) => {
    const t = createTranslator({ locale, messages: loadMessages(locale) });
    await page.goto(`/${locale}/sign-in`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("button", { name: t("auth.multiStep.emailStep.continue"), exact: true })).toBeVisible();
    await expect(page.getByText(t("auth.multiStep.emailStep.title"), { exact: true }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("auth.multiStep.");
  });

  test(`${locale} reset-password labels remain localized when toggling password visibility`, async ({ page }) => {
    const t = createTranslator({ locale, messages: loadMessages(locale) });
    await page.goto(`/${locale}/reset-password?token=localization-check`);
    await expect(page.locator("html")).toHaveAttribute("dir", getLocaleDirection(locale));
    const password = page.locator("#new-password");
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: t("common.showPassword") }).first().click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: t("common.hidePassword") })).toBeVisible();
  });
}
