import { test, expect } from "./helpers/onboarding";
import en from "@web-app-starter/i18n/messages/en.json";
import hu from "@web-app-starter/i18n/messages/hu.json";
import { api } from "@repo/backend";
import { disposableEmail } from "./helpers/fixtures";

test("sign-in → sign-up accepts waitlist email inline in both locales, then respects mode changes", async ({ page, onboarding }) => {
  const { client, setMode } = onboarding;
  const emails: string[] = [];
  try {
    await setMode("publicWaitlist");
    for (const locale of ["en", "hu"]) {
      await page.goto(`/${locale}/sign-in`);
      await page.getByRole("button", { name: `${(locale === "en" ? en : hu).auth.signIn.switchPrompt} ${(locale === "en" ? en : hu).auth.signIn.switchLink}` }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-up`));
      await expect(page.locator("#waitlist-email")).toBeVisible();
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      const email = disposableEmail();
      emails.push(email);
      await page.locator("#waitlist-email").fill(email);
      await page.locator('form:has(#waitlist-email) button[type="submit"]').click();
      await expect(page.locator("#waitlist-email")).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-up`));
      const entries = await client.query(api.platform.waitlist.list, { paginationOpts: { numItems: 100, cursor: null } });
      expect(entries.page.some(entry => entry.email === email)).toBe(true);
    }
    await setMode("publicSignup");
    await page.goto("/en/sign-up");
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(page.locator("#waitlist-email")).toHaveCount(0);
    await setMode("inviteOnly");
    await page.goto("/hu/sign-up");
    await expect(page.locator("main a[href='/hu/sign-in']")).toBeVisible();
    await expect(page.locator("#waitlist-email")).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  } finally {
    const entries = await client.query(api.platform.waitlist.list, { paginationOpts: { numItems: 100, cursor: null } });
    for (const entry of entries.page.filter(entry => emails.includes(entry.email))) {
      await client.mutation(api.platform.waitlist.remove, { entryId: entry._id });
    }
  }
});
