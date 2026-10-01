import "@/app/globals.css";
import { defaultLocale, getLocaleDirection } from "@web-app-starter/i18n";
import { BrandTokenStyle, EnvironmentBannerWrapper } from "@web-app-starter/design-system";
import { appConfig, tokenOverrideCss } from "@web-app-starter/app-config";

/** Server-rendered document attributes; shared by locale routes and the entry page. */
export default function DocumentShell({
  children,
  locale = defaultLocale,
}: {
  children: React.ReactNode;
  locale?: string;
}) {
  return (
    <html lang={locale} dir={getLocaleDirection(locale)} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {appConfig.features.environmentBanner && <EnvironmentBannerWrapper appName="landing-static" />}
        <BrandTokenStyle css={tokenOverrideCss(appConfig)} />
        {children}
      </body>
    </html>
  );
}
