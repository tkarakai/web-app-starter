import { expect, test } from "@playwright/test";
import { defaultLocale, getLocaleDirection, localeMetadata, locales } from "@web-app-starter/i18n";

for (const locale of locales) {
  test(`${locale} document attributes are present in the response HTML`, async ({ request }) => {
    for (const route of ["", "about/", "privacy/", "terms/"]) {
      const response = await request.get(`/${locale}/${route}`);
      expect(response.ok()).toBe(true);
      const html = (await response.text()).match(/<html\b[^>]*>/)?.[0];
      expect(html).toMatch(new RegExp(`\\blang="${locale}"`));
      expect(html).toMatch(new RegExp(`\\bdir="${getLocaleDirection(locale)}"`));
    }
  });
}

test("entry document uses the configured default locale", async ({ request }) => {
  const response = await request.get("/");
  const html = (await response.text()).match(/<html\b[^>]*>/)?.[0];
  expect(html).toMatch(new RegExp(`\\blang="${defaultLocale}"`));
  expect(html).toMatch(new RegExp(`\\bdir="${getLocaleDirection(defaultLocale)}"`));
});

for (const locale of locales.filter((value) => value === defaultLocale || getLocaleDirection(value) === "rtl")) {
  test(`${locale} home and about work with JavaScript disabled`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    try {
      for (const route of ["", "about/"]) {
        await page.goto(`/${locale}/${route}`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute("dir", getLocaleDirection(locale));
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
}

test("locale switching preserves the page and updates document attributes without hydration errors", async ({ page }) => {
  const rtlLocale = locales.find((locale) => getLocaleDirection(locale) === "rtl");
  const ltrLocale = locales.find((locale) => getLocaleDirection(locale) === "ltr");
  test.skip(!rtlLocale || !ltrLocale, "Requires configured LTR and RTL locales");
  if (!rtlLocale || !ltrLocale) return;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|didn't match|does not match/i.test(message.text())) errors.push(message.text());
  });
  await page.goto(`/${ltrLocale}/about/?source=locale-test`);
  // A window marker distinguishes client navigation from a full document reload.
  await page.evaluate(() => { Reflect.set(window, "localeNavigationMarker", true); });
  for (const locale of [rtlLocale, ltrLocale]) {
    await page.locator('header button[aria-haspopup="menu"]').click();
    await page.getByRole("menuitem", { name: new RegExp(localeMetadata[locale].nativeName) }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/about/\\?source=locale-test$`));
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", getLocaleDirection(locale));
    expect(await page.evaluate(() => Reflect.get(window, "localeNavigationMarker"))).toBe(true);
  }
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
