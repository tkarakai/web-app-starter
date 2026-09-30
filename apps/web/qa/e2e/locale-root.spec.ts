import { expect, test } from "@playwright/test";
import { defaultLocale, locales } from "@web-app-starter/i18n";

const cases = [defaultLocale, locales.find((locale) => locale !== defaultLocale)].filter(
  (locale): locale is typeof defaultLocale => locale !== undefined,
);

for (const locale of cases) {
  test(`locale root preserves ${locale} through the signed-out redirect`, async ({ request, baseURL }) => {
    const root = await request.get(`/${locale}`, { maxRedirects: 0 });
    expect(root.status()).toBe(307);
    expect(new URL(root.headers().location, baseURL).pathname).toBe(`/${locale}/dashboard`);

    // The first-hop assertion above prevents NEXT_LOCALE from masking a lost
    // prefix; the next request verifies the resulting auth redirect.
    const dashboard = await request.get(`/${locale}/dashboard`, { maxRedirects: 0 });
    expect(dashboard.status()).toBe(307);
    expect(new URL(dashboard.headers().location, baseURL).pathname).toBe(`/${locale}/sign-in`);
  });
}
