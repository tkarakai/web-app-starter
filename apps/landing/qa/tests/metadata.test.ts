import { afterEach, describe, expect, it } from "bun:test";
import { appConfig } from "@web-app-starter/app-config";
import { defaultLocale, locales } from "@web-app-starter/i18n";
import { localizedPageUrl, pageMetadata } from "../../src/lib/metadata";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe("landing page metadata", () => {
  it("normalizes a site URL trailing slash without losing its path prefix", () => {
    expect(localizedPageUrl("https://example.test/marketing/", "ar", "/privacy")).toBe("https://example.test/marketing/ar/privacy/");
    expect(localizedPageUrl("https://example.test/marketing", "he", "/")).toBe("https://example.test/marketing/he/");
  });

  it("uses the page's translated title and description in social metadata", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test/";
    const metadata = pageMetadata({ locale: "ar", pathname: "/about", title: "حول", description: "وصف" });
    expect(metadata.title).toBe("حول");
    expect(metadata.description).toBe("وصف");
    expect(metadata.openGraph).toMatchObject({ url: "https://example.test/ar/about/", title: "حول", description: "وصف", locale: "ar", siteName: appConfig.identity.productName, type: "website" });
    expect(metadata.twitter).toMatchObject({ title: "حول", description: "وصف", card: "summary_large_image" });
  });

  it("keeps the home title absolute and advertises only configured locales plus the configured fallback", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
    const metadata = pageMetadata({ locale: defaultLocale, pathname: "/", title: appConfig.identity.productName, description: "Home" });
    expect(metadata.title).toEqual({ absolute: appConfig.identity.productName });
    expect(Object.keys(metadata.alternates?.languages ?? {})).toEqual([...locales, "x-default"]);
    expect(metadata.alternates?.languages?.["x-default"]).toBe(`https://example.test/${defaultLocale}/`);
  });

  it("refuses to generate deployment metadata without the site URL", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(() => pageMetadata({ locale: defaultLocale, pathname: "/terms", title: "Terms", description: "Terms" })).toThrow("Missing required environment variable: NEXT_PUBLIC_SITE_URL");
  });
});
