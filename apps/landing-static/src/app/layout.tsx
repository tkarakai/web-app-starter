import "./globals.css";
import { BrandTokenStyle, EnvironmentBannerWrapper } from "@repo/design-system";
import { appConfig, tokenOverrideCss } from "@repo/app-config";

/**
 * Root layout — provides the required html/body shell for Next.js 16 static export.
 * Locale-specific lang and dir attributes are applied by [locale]/layout.tsx
 * via an inline script that runs synchronously before paint.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {appConfig.features.environmentBanner && <EnvironmentBannerWrapper appName="landing-static" />}
        <BrandTokenStyle css={tokenOverrideCss(appConfig)} />
        {children}
      </body>
    </html>
  );
}
