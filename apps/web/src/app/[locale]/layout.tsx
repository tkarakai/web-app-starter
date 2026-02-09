import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Raleway } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { Toaster } from "@repo/design-system";
import { ConvexClientProvider } from "@repo/auth/provider";
import { getToken } from "@repo/auth/server";
import { getLocaleDirection, type Locale, locales, HreflangLinks } from "@repo/i18n";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
  const canonicalUrl = `${siteUrl}/${locale}`;

  return {
    title: {
      template: `%s | ${t("title")}`,
      default: t("title"),
    },
    description: t("description"),
    metadataBase: new URL(siteUrl),
    alternates: {
      canonical: canonicalUrl,
      languages: Object.fromEntries(locales.map((loc) => [loc, `/${loc}`])),
    },
    openGraph: {
      type: "website",
      locale: locale,
      url: canonicalUrl,
      siteName: t("title"),
      title: t("title"),
      description: t("description"),
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
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

  const [token, nonce, messages, headersList] = await Promise.all([
    getToken(),
    headers().then((h) => h.get("x-nonce") ?? undefined),
    getMessages(),
    headers(),
  ]);

  const pathname = headersList.get("x-pathname") ?? "/";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
  const dir = getLocaleDirection(locale);

  return (
    <html lang={locale} dir={dir} className={raleway.variable} suppressHydrationWarning>
      <head>
        <HreflangLinks locale={locale} pathname={pathname} siteUrl={siteUrl} />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          <NextIntlClientProvider messages={messages}>
            <ConvexClientProvider initialToken={token}>{children}</ConvexClientProvider>
            <Toaster richColors closeButton position="bottom-right" />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
