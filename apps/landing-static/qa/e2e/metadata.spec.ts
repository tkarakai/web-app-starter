import { expect, test } from "@playwright/test";
import { localAppOrigin } from "@web-app-starter/app-config";
import { defaultLocale, locales } from "@web-app-starter/i18n";

for (const locale of locales) {
  for (const route of ["", "about/", "privacy/", "terms/"]) {
    test(`${locale} ${route || "home"} metadata identifies the page and its translations`, async ({ request, baseURL }) => {
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? baseURL ?? localAppOrigin("landing-static")).replace(/\/+$/, "");
      const response = await request.get(`/${locale}/${route}`);
      expect(response.ok()).toBe(true);
      // Inspect the response, before JavaScript can modify the head.
      const html = await response.text();
      const canonical = `${siteUrl}/${locale}/${route}`;
      expect(html.match(/<link rel="canonical"[^>]*>/g)).toEqual([`<link rel="canonical" href="${canonical}"/>`]);
      expect(html.match(/<meta property="og:url"[^>]*>/g)).toEqual([`<meta property="og:url" content="${canonical}"/>`]);
      const alternates = html.match(/<link rel="alternate"[^>]*>/g) ?? [];
      expect(alternates).toHaveLength(locales.length + 1);
      for (const alternate of [...locales, "x-default"]) {
        const target = alternate === "x-default" ? defaultLocale : alternate;
        expect(alternates).toContain(`<link rel="alternate" hrefLang="${alternate}" href="${siteUrl}/${target}/${route}"/>`);
      }
    });
  }
}

test("sitemap URLs match the canonical trailing-slash routes", async ({ request, baseURL }) => {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? baseURL ?? localAppOrigin("landing-static")).replace(/\/+$/, "");
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  const xml = await response.text();
  expect(xml.match(/<loc>/g)).toHaveLength(locales.length * 4);
  for (const locale of locales) {
    for (const route of ["", "about/", "privacy/", "terms/"]) {
      expect(xml).toContain(`<loc>${siteUrl}/${locale}/${route}</loc>`);
    }
  }
});
