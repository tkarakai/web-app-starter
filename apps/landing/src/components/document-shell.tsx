import "@/app/globals.css";
import { defaultLocale, getLocaleDirection } from "@web-app-starter/i18n";

import { Raleway, Cairo, Heebo } from "next/font/google";
import { BrandTokenStyle, EnvironmentBannerWrapper } from "@web-app-starter/design-system";
import { appConfig, tokenOverrideCss } from "@web-app-starter/app-config";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const cairo = Cairo({
  subsets: ["arabic"],
  variable: "--font-arabic",
  display: "swap",
});

const heebo = Heebo({
  subsets: ["hebrew"],
  variable: "--font-hebrew",
  display: "swap",
});

/** Server-rendered document attributes; shared by locale routes and the entry page. */
export default function DocumentShell({
  children,
  locale = defaultLocale,
}: {
  children: React.ReactNode;
  locale?: string;
}) {
  return (
    <html
      lang={locale}
      dir={getLocaleDirection(locale)}
      suppressHydrationWarning
      className={`${raleway.variable} ${cairo.variable} ${heebo.variable} ${locale === "ar" ? "font-arabic" : locale === "he" ? "font-hebrew" : ""}`}
    >
      <body className="flex min-h-screen flex-col">
        {appConfig.features.environmentBanner && <EnvironmentBannerWrapper appName="landing" />}
        <BrandTokenStyle css={tokenOverrideCss(appConfig)} />
        {children}
      </body>
    </html>
  );
}
