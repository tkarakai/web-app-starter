import "./globals.css";

import { Raleway, Cairo, Heebo } from "next/font/google";
import { BrandTokenStyle, EnvironmentBannerWrapper } from "@repo/design-system";
import { appConfig, tokenOverrideCss } from "@repo/app-config";

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

/**
 * Root layout — provides the required html/body shell for Next.js static export.
 * Locale-specific lang, dir, and font attributes are applied client-side
 * by DocumentLocale in [locale]/layout.tsx.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      suppressHydrationWarning
      className={`${raleway.variable} ${cairo.variable} ${heebo.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        {appConfig.features.environmentBanner && <EnvironmentBannerWrapper appName="landing" />}
        <BrandTokenStyle css={tokenOverrideCss(appConfig)} />
        {children}
      </body>
    </html>
  );
}
