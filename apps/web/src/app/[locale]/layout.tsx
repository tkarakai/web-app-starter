import type { Metadata } from "next";
import { appConfig, tokenOverrideCss } from "@repo/app-config";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Raleway } from "next/font/google";
import { Cairo, Heebo } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import {
  Toaster,
  BrandTokenStyle,
  EnvironmentBannerWrapper,
  OfflineBanner,
  PublicConfigProvider,
} from "@repo/design-system";
import { readPublicConfigFromEnv } from "@repo/design-system/server";
import { getRequestOrigin } from "@/lib/request-origin";
import { ConvexClientProvider } from "@repo/auth/provider";
import { getToken } from "@repo/auth/server";
import { getLocaleDirection, type Locale, locales, HreflangLinks } from "@repo/i18n";
import { AnnouncementBannerHost } from "@/components/announcement-banner-host";
import { ConvexErrorToast } from "@/components/convex-error-toast";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const cairo = Cairo({
  subsets: ["arabic"],
  variable: "--font-sans",
  display: "swap",
});

const heebo = Heebo({
  subsets: ["hebrew"],
  variable: "--font-sans",
  display: "swap",
});

const fontsByLocale: Record<string, { variable: string }> = {
  ar: cairo,
  he: heebo,
};

// Titles use the product name from app.config.ts; it is not a translation.
const { productName } = appConfig.identity;

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const [t, siteUrl] = await Promise.all([
    getTranslations({ locale, namespace: "metadata" }),
    getRequestOrigin(),
  ]);

  const canonicalUrl = `${siteUrl}/${locale}`;

  return {
    title: {
      template: `%s | ${productName}`,
      default: productName,
    },
    description: t("description"),
    metadataBase: new URL(siteUrl),
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/favicon.ico", sizes: "32x32" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    },
    alternates: {
      canonical: canonicalUrl,
      languages: Object.fromEntries(locales.map((loc) => [loc, `/${loc}`])),
    },
    openGraph: {
      type: "website",
      locale: locale,
      url: canonicalUrl,
      siteName: productName,
      title: productName,
      description: t("description"),
    },
    twitter: {
      card: "summary_large_image",
      title: productName,
      description: t("description"),
    },
  };
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  const [token, nonce, messages, headersList, tOffline, siteUrl] = await Promise.all([
    getToken(),
    headers().then((h) => h.get("x-nonce") ?? undefined),
    getMessages(),
    headers(),
    getTranslations({ locale, namespace: "offline" }),
    getRequestOrigin(),
  ]);

  // Read at request time, not build time, so one artifact can serve any
  // environment. See platform/docs/deployment-architecture.md
  const publicConfig = readPublicConfigFromEnv({ landingUrl: true });

  const pathname = headersList.get("x-pathname") ?? "/";
  const dir = getLocaleDirection(locale);

  const font = fontsByLocale[locale] || raleway;

  return (
    <html lang={locale} dir={dir} className={font.variable} suppressHydrationWarning>
      <head>
        <HreflangLinks locale={locale} pathname={pathname} siteUrl={siteUrl} />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          {appConfig.features.environmentBanner && <EnvironmentBannerWrapper appName="web" />}
          <BrandTokenStyle css={tokenOverrideCss(appConfig)} />
          <OfflineBanner label={tOffline("message")} />
          <NextIntlClientProvider messages={messages}>
            <PublicConfigProvider value={publicConfig}>
              <ConvexClientProvider initialToken={token} convexUrl={publicConfig.convexUrl}>
                <ConvexErrorToast />
                <AnnouncementBannerHost hideOnDashboard fixed />
                {children}
              </ConvexClientProvider>
            </PublicConfigProvider>
            <Toaster richColors closeButton position="bottom-right" />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
