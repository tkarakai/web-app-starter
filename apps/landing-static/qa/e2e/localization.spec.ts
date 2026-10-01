import { expect, test } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createTranslator } from "next-intl";
import { appConfig } from "@web-app-starter/app-config";
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
  test(`${locale} legal pages render translated content and footer`, async ({ page }) => {
    const t = createTranslator({ locale, messages: loadMessages(locale) });
    for (const route of ["privacy", "terms"] as const) {
      await page.goto(`/${locale}/${route}/`);
      await expect(page.getByRole("heading", { name: t(`legal.${route}.heading`), exact: true })).toBeVisible();
      await expect(page.getByText(t(`legal.${route}.description`), { exact: true })).toBeVisible();
      await expect(page.locator("footer")).toContainText(appConfig.identity.legalEntity);
      await expect(page.getByText(t(`legal.${route}.notice`), { exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", getLocaleDirection(locale));
    }
  });

  test(`the shared static 404 resolves ${locale} from the requested URL`, async ({ page }) => {
    const t = createTranslator({ locale, messages: loadMessages(locale) });
    await page.goto(`/${locale}/does-not-exist/`);
    await expect(page.getByRole("heading", { name: t("common.notFound") })).toBeVisible();
    await expect(page.locator(`div[lang="${locale}"][dir="${getLocaleDirection(locale)}"]`)).toBeVisible();
  });
}
