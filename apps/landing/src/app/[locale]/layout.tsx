import type { Metadata } from "next";
import { appConfig } from "@web-app-starter/app-config";
import { notFound } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";

import { getLocaleDirection, type Locale, locales } from "@web-app-starter/i18n";
import DocumentShell from "@/components/document-shell";
import { DocumentLocale } from "@/components/document-locale";
import { AnnouncementBannerHost } from "@/components/announcement-banner-host";
import { Footer } from "@/components/footer";

// Titles use the product name from app.config.ts; it is not a translation.
const { productName } = appConfig.identity;

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SITE_URL");
  }

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
  };
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const dynamicParams = false;

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

  setRequestLocale(locale);

  const messages = await getMessages();
  const dir = getLocaleDirection(locale);

  return (
    <DocumentShell locale={locale}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <NextIntlClientProvider messages={messages}>
          <DocumentLocale lang={locale} dir={dir} />
          <AnnouncementBannerHost />
          <div className="flex-1">{children}</div>
          <Footer />
        </NextIntlClientProvider>
      </ThemeProvider>
    </DocumentShell>
  );
}
