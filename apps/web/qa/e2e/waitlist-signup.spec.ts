import { appConfig } from "@web-app-starter/app-config";
import { defaultLocale, locales } from "@web-app-starter/i18n";
import { api } from "@repo/backend";
import { createTranslator } from "next-intl";

import { test, expect } from "./helpers/onboarding";
import { disposableEmail } from "./helpers/fixtures";
import { loadE2EMessages } from "./helpers/locale-messages";

// Keep real submissions within the backend's shared IP budget: the configured
// default plus one shipped alternate retain the original two-locale breadth.
const waitlistLocales = [defaultLocale, ...locales.filter(locale => locale !== defaultLocale).slice(0, 1)];

for (const locale of waitlistLocales) {
  test.describe(`configured waitlist sign-up: ${locale}`, () => {
    if (appConfig.features.waitlist) {
      test("sign-in → sign-up accepts waitlist email inline", async ({ page, onboarding }) => {
        const { client, setMode } = onboarding;
        const email = disposableEmail();
        const t = createTranslator({ locale, messages: loadE2EMessages(locale), namespace: "auth.signIn" });
        try {
          await setMode("publicWaitlist");
          await page.goto(`/${locale}/sign-in`);
          await page.getByRole("button", { name: `${t("switchPrompt")} ${t("switchLink")}` }).click();
          await expect(page).toHaveURL(new RegExp(`/${locale}/sign-up$`));
          await expect(page.locator("#waitlist-email")).toBeVisible();
          await expect(page.locator('input[type="password"]')).toHaveCount(0);
          await page.locator("#waitlist-email").fill(email);
          await page.locator('form:has(#waitlist-email) button[type="submit"]').click();
          await expect(page.locator("#waitlist-email")).toHaveCount(0);
          await expect(page).toHaveURL(new RegExp(`/${locale}/sign-up$`));
          const entries = await client.query(api.platform.waitlist.list, { paginationOpts: { numItems: 100, cursor: null } });
          expect(entries.page.some(entry => entry.email === email)).toBe(true);
        } finally {
          const entries = await client.query(api.platform.waitlist.list, { paginationOpts: { numItems: 100, cursor: null } });
          for (const entry of entries.page.filter(entry => entry.email === email)) {
            await client.mutation(api.platform.waitlist.remove, { entryId: entry._id });
          }
        }
      });
    } else {
      test("disabled waitlist stays closed under publicWaitlist policy", async ({ page, onboarding }) => {
        // An enabling backend policy must not override the app's feature switch.
        await onboarding.setMode("publicWaitlist");
        await page.goto(`/${locale}/sign-up`);
        const t = createTranslator({ locale, messages: loadE2EMessages(locale), namespace: "auth.invitation" });
        await expect(page).toHaveURL(new RegExp(`/${locale}/sign-up$`));
        await expect(page.getByText(t("signupBlocked"), { exact: true })).toBeVisible();
        await expect(page.locator(`main a[href='/${locale}/sign-in']`)).toBeVisible();
        await expect(page.locator("#waitlist-email")).toHaveCount(0);
        await expect(page.locator('input[type="password"]')).toHaveCount(0);
      });
    }

    test("sign-up respects publicSignup and inviteOnly mode changes", async ({ page, onboarding }) => {
      await onboarding.setMode("publicSignup");
      await page.goto(`/${locale}/sign-up`);
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-up$`));
      await expect(page.locator('input[type="password"]').first()).toBeVisible();
      await expect(page.locator("#waitlist-email")).toHaveCount(0);

      await onboarding.setMode("inviteOnly");
      await page.goto(`/${locale}/sign-up`);
      await expect(page.locator(`main a[href='/${locale}/sign-in']`)).toBeVisible();
      await expect(page.locator("#waitlist-email")).toHaveCount(0);
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
    });
  });
}
