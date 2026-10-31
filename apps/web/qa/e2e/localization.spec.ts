import { expect, test } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createTranslator } from "next-intl";
import { defaultLocale, getLocaleDirection, locales, localeMetadata, mergeMessages, type Messages } from "@web-app-starter/i18n";
import { signIn } from "./helpers/auth";
import { createDisposableUser } from "./helpers/fixtures";

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

test("changing the language in Settings applies immediately without an unsaved-changes prompt", async ({ page }) => {
  const alternate = locales.find(locale => locale === "de") ?? locales.find(locale => locale !== "en");
  test.skip(!alternate, "The app ships only English");
  if (!alternate) return;
  const user = await createDisposableUser();
  await signIn(page, user.email, user.password);
  await page.goto("/en/dashboard/settings?tab=profile");
  const dialogs: string[] = [];
  page.on("dialog", async dialog => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: `${localeMetadata[alternate].flag} ${localeMetadata[alternate].nativeName}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${alternate}/dashboard/settings\\?tab=profile$`));
  await expect(page.locator("html")).toHaveAttribute("lang", alternate);
  const t = createTranslator({ locale: alternate, messages: loadMessages(alternate) });
  await expect(page.getByText(t("dashboard.profile.description"), { exact: true }).first()).toBeVisible();
  expect(dialogs).toEqual([]);
});

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
